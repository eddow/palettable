/**
 * `@palettable/core` — drag session tests (Phases 2+3: highlight diff events
 * + session dwell).
 *
 * Pins the session contract: creation resolves the grab target against the
 * live tree (drawer children refuse), `over` emits `highlight` diffs (only
 * on change; `off` on leave/`end`), directly-hovered stack/parking gaps arm
 * the dwell that fires the commit as a `structure` event, and the session
 * exposes the live tree (no layout param per method).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configuration } from './configuration.js'
import type { DragEvent, GrabTarget, Hoverable } from './drag.js'
import { dragOver, dragStart, PaletteLayoutTree, type SerializedLayout } from './layout.js'

afterEach(() => {
	vi.useRealTimers()
})

function twoItemLayout(): SerializedLayout {
	return {
		version: 1,
		borders: {
			top: [
				{ space: 1, toolbar: [{ tool: 'a' }, { tool: 'b' }] },
				{ space: 1, toolbar: [{ tool: 'c' }] },
			],
			right: [],
			bottom: [],
			left: [],
		},
		parking: [[{ tool: 'p' }]],
	}
}

function fourItemLayout(): SerializedLayout {
	return {
		version: 1,
		borders: {
			top: [{ space: 1, toolbar: [{ tool: 'a' }, { tool: 'b' }, { tool: 'c' }, { tool: 'd' }] }],
			right: [],
			bottom: [],
			left: [],
		},
		parking: [],
	}
}

const sample = { clientX: 0, clientY: 0 }

describe('createDrag session shell', () => {
	it('creates a session holding the live tree', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		expect(session.layout).toBe(tree)
		session.end()
	})

	it('refuses a toolbar outside the tree (drawer child)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		expect(() => tree.createDrag({ kind: 'toolbar', toolbar: [] })).toThrow(
			/dragStart: toolbar not found/
		)
	})

	it('refuses a gap grab', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		expect(() => tree.createDrag({ kind: 'tool', toolbar: [], item: toolbar[0]! })).toThrow()
	})

	it('catalog grabs wait for Phase 6', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		expect(() => tree.createDrag({ kind: 'catalog', item })).toThrow(/Phase 6/)
	})

	it('over(tool) paints the active-item fallback without committing', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const target: GrabTarget = { kind: 'tool', toolbar, item }
		const session = tree.createDrag(target)
		const hover: Hoverable = { kind: 'tool', toolbar, item: other }
		session.over(hover, sample)
		expect(toolbar).toHaveLength(2)
		session.end()
	})

	it('over(item-gap) commits the reorder (forward lands between)', () => {
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[1]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		session.over({ kind: 'item-gap', toolbar, gap: 3 }, sample)
		expect(toolbar.map((entry) => (entry as { tool?: unknown }).tool)).toEqual(['a', 'c', 'b', 'd'])
		session.end()
	})

	it('over(toolbar) with activeItem paints without committing', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		session.over({ kind: 'toolbar', toolbar, activeItem: 1 }, sample)
		expect(toolbar).toHaveLength(2)
		session.end()
	})

	it('over(track-gap) extracts a singleton', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const track = live.borders.top[1] ?? []
		session.over({ kind: 'track-gap', track, gap: 1 }, sample)
		// Subset extraction inserts a singleton into the target track —
		// the border still holds 2 tracks, the target now holds 2 toolbars.
		expect(live.borders.top).toHaveLength(2)
		expect(track).toHaveLength(2)
		session.end()
	})

	it('over(stack-gap) paints without committing (dwell lands Phase 3)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const before = live.borders.top.length
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		expect(live.borders.top).toHaveLength(before)
		session.end()
	})

	it('over(parking-gap) paints without committing (dwell lands Phase 3)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const before = live.parking.length
		session.over({ kind: 'parking-gap', parking: live.parking, gap: 1 }, sample)
		expect(live.parking).toHaveLength(before)
		session.end()
	})

	it('over(null) and over after end() are safe no-ops', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		session.over(null, sample)
		session.end()
		session.over({ kind: 'tool', toolbar, item }, sample)
		session.measure(undefined)
		session.end()
		expect(toolbar).toHaveLength(2)
	})

	it('measure(frame) is accepted and stored (geometry lands Phase 4)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		session.measure({ axis: 'horizontal', start: 0, available: 100, resting: 10, grab: 5 })
		session.measure(undefined)
		session.end()
	})
})

/**
 * Regression guards for the Phase 1 review findings. Each one failed before
 * the fix; they exist so the mapping cannot silently regress again. They
 * assert the observable event stream (or the live mutation) — never a
 * return-value shim, which no longer exists.
 */
describe('createDrag hover mapping (review regressions)', () => {
	it('item-gap on a PARKING row commits into parking (ownership transfer)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const borderToolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = borderToolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar: borderToolbar, item })
		const row = live.parking[0] ?? []
		const before = row.length
		session.over({ kind: 'item-gap', toolbar: row, gap: 1 }, sample)
		// The dragged tool left the border toolbar and landed in the row.
		expect(row).toHaveLength(before + 1)
		expect(borderToolbar).toHaveLength(1)
		session.end()
	})

	it('track background paints the two FLANKING stack gaps, not one', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		// Track 0 of the top border: flanking stacks are 0 and 1.
		session.over({ kind: 'track', border: live.borders.top, trackIndex: 0 }, sample)
		const lit = events
			.filter(
				(event): event is Extract<DragEvent, { type: 'highlight' }> => event.type === 'highlight'
			)
			.filter((event) => event.dz.kind === 'stack-gap')
			.map((event) => (event.dz.kind === 'stack-gap' ? event.dz.gap : -1))
			.sort((a, b) => a - b)
		expect(lit).toEqual([0, 1])
		session.end()
	})

	it('a hover that maps to nothing clears the previous paint', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		// A real hover paints …
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		const lit = events.filter((event) => event.type === 'highlight' && event.state === 'on').length
		expect(lit).toBeGreaterThan(0)
		// … an unmappable hover (item-gap on a toolbar outside the tree) clears.
		session.over({ kind: 'item-gap', toolbar: [], gap: 0 }, sample)
		const off = events.filter((event) => event.type === 'highlight' && event.state === 'off')
		expect(off).toHaveLength(lit)
		session.end()
	})

	it('over(null) clears the previous paint', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		const lit = events.filter((event) => event.type === 'highlight' && event.state === 'on').length
		expect(lit).toBeGreaterThan(0)
		session.over(null, sample)
		const off = events.filter((event) => event.type === 'highlight' && event.state === 'off')
		expect(off).toHaveLength(lit)
		session.end()
	})

	it('toolbar hover with activeItem paints the active-item fallback', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'toolbar', toolbar, activeItem: 1 }, sample)
		// Item 0 is dragged, so gaps 0 and 1 touch it and stay dark; the only
		// free candidate is the trailing gap 2.
		const itemGaps = events
			.filter(
				(event): event is Extract<DragEvent, { type: 'highlight' }> =>
					event.type === 'highlight' && event.dz.kind === 'item-gap'
			)
			.map((event) => (event.dz.kind === 'item-gap' ? event.dz.gap : -1))
		expect(itemGaps).toEqual([2])
		session.end()
	})

	it('end() clears every lit DZ', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		const lit = events.filter((event) => event.type === 'highlight' && event.state === 'on').length
		session.end()
		const off = events.filter((event) => event.type === 'highlight' && event.state === 'off')
		expect(off).toHaveLength(lit)
	})
})

/** Collect every event a session emits (in emission order). */
function collectEvents(session: { subscribe(fn: (event: DragEvent) => void): () => void }) {
	const events: DragEvent[] = []
	const stop = session.subscribe((event) => events.push(event))
	return { events, stop }
}

/**
 * The wire contract: every model→UI transition is carried by an event.
 * A commit must raise `structure` (the adapter re-reads the live layout from
 * it); a paint change must raise `highlight`. The adapter is allowed to hold
 * painted/decorative state only — it never reconciles a return value and
 * never diffs state the session did not tell it about.
 */
describe('event completeness (every transition is an event)', () => {
	it('an inline item-gap commit raises exactly one structure event', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const a = live.borders.top[0]?.[0]?.toolbar ?? []
		const c = live.borders.top[1]?.[0]?.toolbar ?? []
		const item = a[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar: a, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'item-gap', toolbar: c, gap: 1 }, sample)
		const structures = events.filter((event) => event.type === 'structure')
		expect(structures).toHaveLength(1)
		session.end()
	})

	it('a track-gap commit raises a structure event', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const a = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = a[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar: a, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'track-gap', track: live.borders.top[1] ?? [], gap: 1 }, sample)
		expect(events.some((event) => event.type === 'structure')).toBe(true)
		session.end()
	})

	it('a dark (vetoed) gap raises no structure event', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const a = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = a[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar: a, item })
		const { events } = collectEvents(session)
		// Gap 0 touches the dragged tool: dark, never commits.
		session.over({ kind: 'item-gap', toolbar: a, gap: 0 }, sample)
		expect(events.some((event) => event.type === 'structure')).toBe(false)
		session.end()
	})

	it('a no-op hover (same gap twice) raises no second structure event', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const a = live.borders.top[0]?.[0]?.toolbar ?? []
		const c = live.borders.top[1]?.[0]?.toolbar ?? []
		const item = a[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar: a, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'item-gap', toolbar: c, gap: 1 }, sample)
		const first = events.filter((event) => event.type === 'structure').length
		session.over({ kind: 'item-gap', toolbar: c, gap: 1 }, sample)
		expect(events.filter((event) => event.type === 'structure')).toHaveLength(first)
		session.end()
	})

	it('no layout op escapes on the tree stream during a drag (single writer)', () => {
		// The session is the only writer during a drag: the tree op stream must
		// stay silent, so the adapter can never double-apply a commit. Discrete
		// `moveItem` / `moveToolbar` / `insertItem` / `removeItem` are the
		// console paths and are not called from a drag session.
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const a = live.borders.top[0]?.[0]?.toolbar ?? []
		const c = live.borders.top[1]?.[0]?.toolbar ?? []
		const item = a[0]
		if (!item) throw new Error('expected item')
		const ops: string[] = []
		tree.subscribeOps((op) => ops.push(op.kind))
		const session = tree.createDrag({ kind: 'tool', toolbar: a, item })
		session.over({ kind: 'item-gap', toolbar: c, gap: 1 }, sample)
		session.over({ kind: 'track-gap', track: live.borders.top[1] ?? [], gap: 1 }, sample)
		session.end()
		expect(ops).toEqual([])
	})
})

describe('highlight diff events (Phase 2)', () => {
	it('emits on for fresh paint, nothing when the paint is unchanged', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		const first = events.filter((event) => event.type === 'highlight')
		expect(first.length).toBeGreaterThan(0)
		expect(first.every((event) => event.state === 'on')).toBe(true)
		// Same hover again: no new events (diff against the baseline).
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		expect(events.filter((event) => event.type === 'highlight')).toHaveLength(first.length)
		session.end()
	})

	it('emits off for gaps that stop painting, on for new ones', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		const painted = events.filter((event) => event.type === 'highlight')
		expect(painted.length).toBeGreaterThan(0)
		// Move to a stack gap: item paint flips off, stack paint flips on.
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		const states = events.filter((event) => event.type === 'highlight').map((event) => event.state)
		expect(states).toContain('off')
		expect(states).toContain('on')
		session.end()
	})

	it('over(null) flips every lit DZ off', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		const lit = events.filter((event) => event.type === 'highlight' && event.state === 'on')
		expect(lit.length).toBeGreaterThan(0)
		session.over(null, sample)
		const off = events.filter((event) => event.type === 'highlight' && event.state === 'off')
		expect(off).toHaveLength(lit.length)
		session.end()
	})

	it('end() flips every lit DZ off', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		session.end()
		const off = events.filter((event) => event.type === 'highlight' && event.state === 'off')
		expect(off.length).toBeGreaterThan(0)
		// No lit DZ survives: every `on` has a matching `off`.
		const on = events.filter((event) => event.type === 'highlight' && event.state === 'on')
		expect(off).toHaveLength(on.length)
	})

	it('the emitted `on` set matches the engine decision (dual-run)', () => {
		// The engine decision is still the oracle for *what* paints. It is
		// computed on an independent tree because `dragOver` commits to the
		// layout it is given — using the session's own tree would mutate it
		// before the session ran and turn the commit into a no-op.
		const oracleTree = new PaletteLayoutTree(fourItemLayout())
		const oracleLive = oracleTree.getLayout()
		const oracleToolbar = oracleLive.borders.top[0]?.[0]?.toolbar ?? []
		const oracleItem = oracleToolbar[1]
		if (!oracleItem) throw new Error('expected item')
		const oracle = dragStart(oracleLive, { kind: 'tool', toolbar: oracleToolbar, item: oracleItem })
		const expected = new Set<string>()
		const decision = dragOver(
			oracle,
			oracleLive,
			{
				kind: 'item-gap',
				toolbar: oracleToolbar,
				track: oracleLive.borders.top[0] ?? [],
				border: oracleLive.borders.top,
				gap: 3,
			},
			{},
			true
		)
		for (const paint of decision.itemHighlights) {
			for (const gap of paint.gaps) expected.add(`item-gap:${gap}`)
		}
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[1]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'item-gap', toolbar, gap: 3 }, sample)
		const emitted = new Set(
			events
				.filter(
					(event): event is Extract<DragEvent, { type: 'highlight' }> =>
						event.type === 'highlight' && event.state === 'on' && event.dz.kind === 'item-gap'
				)
				.map((event) => `item-gap:${event.dz.gap}`)
		)
		expect(emitted).toEqual(expected)
		session.end()
	})

	it('unsubscribe stops events', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events, stop } = collectEvents(session)
		stop()
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		expect(events).toHaveLength(0)
		session.end()
	})
})

describe('session dwell (Phase 3)', () => {
	it('fires the stack commit after the dwell (fake timers)', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		const before = live.borders.top.length
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		// Armed but not yet fired.
		expect(live.borders.top).toHaveLength(before)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.borders.top).toHaveLength(before + 1)
		expect(events.some((event) => event.type === 'structure')).toBe(true)
		session.end()
	})

	it('gap change cancels the pending fire', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const before = live.borders.top.length
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 1 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		// Only the second gap fired (gap 1 is veto-adjacent to nothing here —
		// both gaps are valid, so exactly one track was created).
		expect(live.borders.top).toHaveLength(before + 1)
		session.end()
	})

	it('null hover cancels the pending fire', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const before = live.borders.top.length
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		session.over(null, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.borders.top).toHaveLength(before)
		session.end()
	})

	it('end() cancels the pending fire (no timer leak)', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const before = live.borders.top.length
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		session.end()
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.borders.top).toHaveLength(before)
	})

	it('one-shot latch: no re-fire while the pointer stays put', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const before = live.borders.top.length
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.borders.top).toHaveLength(before + 1)
		// Same hover again: latch suppresses the second fire.
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.borders.top).toHaveLength(before + 1)
		session.end()
	})

	it('fires the parking commit after the dwell', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		const before = live.parking.length
		session.over({ kind: 'parking-gap', parking: live.parking, gap: 1 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.parking).toHaveLength(before + 1)
		expect(events.some((event) => event.type === 'structure')).toBe(true)
		session.end()
	})

	it('dark (vetoed) gaps never fire', () => {
		vi.useFakeTimers()
		// Whole-toolbar drag of a sole-track toolbar: the two stacks touching
		// the emptied track are vetoed (dark) — dwelling there must not fire.
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[1]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const before = live.borders.top.length
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 1 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.borders.top).toHaveLength(before)
		session.end()
	})
})
