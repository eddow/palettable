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
import {
	dragOver,
	dragStart,
	type LayoutPruneVictim,
	PaletteLayoutTree,
	type SerializedLayout,
	type ToolbarItem,
} from './layout.js'

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

	it('catalog grabs create a pending creation (no origin until placement)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const item = { tool: 'fresh' } as ToolbarItem
		const session = tree.createDrag({ kind: 'catalog', item })
		expect(session.layout).toBe(tree)
		session.end()
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

describe('slide geometry home (Phase 4)', () => {
	function wholeToolbarLayout(): SerializedLayout {
		return {
			version: 1,
			borders: {
				top: [
					{ space: 0.2, toolbar: [{ tool: 'a' }] },
					{ space: 0.3, toolbar: [{ tool: 'b' }] },
				],
				right: [],
				bottom: [],
				left: [],
			},
			parking: [],
		}
	}

	it('clampSlideDelta clamps the pointer into the free span, from resting', async () => {
		const { clampSlideDelta } = await import('./drag.js')
		const frame = { axis: 'horizontal' as const, start: 100, available: 200, resting: 40, grab: 0 }
		expect(clampSlideDelta(frame, 180)).toBe(40)
		expect(clampSlideDelta(frame, -1000)).toBe(-40)
		expect(clampSlideDelta(frame, 10000)).toBe(160)
		const grabbed = { ...frame, grab: 10 }
		expect(clampSlideDelta(grabbed, 190)).toBe(40)
	})

	it('emits slide for a whole-toolbar drag with a frame, clearSlide on disarm', () => {
		const tree = new PaletteLayoutTree(wholeToolbarLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		// Lone tool in its toolbar: whole-toolbar slide from the start.
		session.measure({ axis: 'horizontal', start: 0, available: 100, resting: 10, grab: 5 })
		session.over({ kind: 'tool', toolbar, item }, { clientX: 60, clientY: 0 })
		const slides = events.filter((event) => event.type === 'slide')
		expect(slides).toHaveLength(1)
		expect(slides[0]).toMatchObject({ toolbar, delta: 45 })
		session.measure(undefined)
		expect(events.some((event) => event.type === 'clearSlide')).toBe(true)
		session.end()
	})

	it('available: 0 stays armed (no slide) and is distinct from disarm', () => {
		const tree = new PaletteLayoutTree(wholeToolbarLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.measure({ axis: 'horizontal', start: 0, available: 0, resting: 0, grab: 0 })
		session.over({ kind: 'tool', toolbar, item }, { clientX: 50, clientY: 0 })
		expect(events.some((event) => event.type === 'slide')).toBe(false)
		expect(events.some((event) => event.type === 'clearSlide')).toBe(false)
		session.end()
	})

	it('a gesture with no slide emits no resize (resting position)', () => {
		const tree = new PaletteLayoutTree(wholeToolbarLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		// Pointer exactly at resting (start 0 + grab 5 + resting 10 = 15):
		// delta 0, no slide, and end() commits nothing.
		session.measure({ axis: 'horizontal', start: 0, available: 100, resting: 10, grab: 5 })
		session.over({ kind: 'tool', toolbar, item }, { clientX: 15, clientY: 0 })
		expect(events.some((event) => event.type === 'slide')).toBe(false)
		session.end()
		expect(events.some((event) => event.type === 'resize')).toBe(false)
	})

	it('end() commits the cached split as resize, then clearSlide, then off', () => {
		const tree = new PaletteLayoutTree(wholeToolbarLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.measure({ axis: 'horizontal', start: 0, available: 100, resting: 10, grab: 5 })
		session.over({ kind: 'tool', toolbar, item }, { clientX: 60, clientY: 0 })
		session.end()
		const types = events.map((event) => event.type)
		const resizeAt = types.lastIndexOf('resize')
		const clearAt = types.lastIndexOf('clearSlide')
		expect(resizeAt).toBeGreaterThan(-1)
		expect(clearAt).toBeGreaterThan(resizeAt)
		const resize = events[resizeAt]
		if (resize?.type !== 'resize') throw new Error('expected resize')
		// (resting 10 + delta 45) / available 100 = 0.55.
		expect(resize.split).toBeCloseTo(0.55)
		expect(resize.index).toBe(0)
		// The model moved: the single-toolbar track's leading space now
		// holds 55% of the whole span (0.2 + trailing 0.8 merged, then split).
		const track = live.borders.top[0] ?? []
		expect(track[0]?.space).toBeCloseTo(0.55)
	})

	it('a subset drag never slides (no frame effect)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.measure({ axis: 'horizontal', start: 0, available: 100, resting: 10, grab: 5 })
		session.over({ kind: 'tool', toolbar, item }, sample)
		expect(events.some((event) => event.type === 'slide')).toBe(false)
		session.end()
		expect(events.some((event) => event.type === 'resize')).toBe(false)
	})

	it('stays armed across a structure event (adapter re-measures)', () => {
		const tree = new PaletteLayoutTree(wholeToolbarLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		const frame = { axis: 'horizontal' as const, start: 0, available: 100, resting: 10, grab: 5 }
		session.measure(frame)
		session.over({ kind: 'tool', toolbar, item }, { clientX: 60, clientY: 0 })
		expect(events.filter((event) => event.type === 'slide')).toHaveLength(1)
		// A slide relocation commits a structure but keeps the toolbar identity —
		// the follow stays armed, and the re-measured frame slides again.
		const target = live.borders.top[1] ?? []
		session.over({ kind: 'track-gap', track: target, gap: 0 }, { clientX: 60, clientY: 0 })
		expect(events.some((event) => event.type === 'structure')).toBe(true)
		session.measure(frame)
		session.over({ kind: 'tool', toolbar, item }, { clientX: 70, clientY: 0 })
		expect(events.filter((event) => event.type === 'slide')).toHaveLength(3)
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

	it('an in-track hover paints the two FLANKING stack gaps, not one', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		// Hovering a tool inside track 0 paints the active-item fallback
		// plus the track's two flanking stacks (0 and 1).
		session.over({ kind: 'tool', toolbar, item: other }, sample)
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

	it('an inline item-gap commit raises a move-toolbar op (not replace)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const a = live.borders.top[0]?.[0]?.toolbar ?? []
		const c = live.borders.top[1]?.[0]?.toolbar ?? []
		const item = a[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar: a, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'item-gap', toolbar: c, gap: 1 }, sample)
		const structure = events.find(
			(e): e is DragEvent & { type: 'structure' } => e.type === 'structure'
		)
		expect(structure).toBeDefined()
		if (structure?.op.kind !== 'move-toolbar') throw new Error('expected move-toolbar op')
		expect(structure.op.toolbar).toBe(c)
		// Restructure: `from` is the pre-mutation origin (where the tools
		// came from), `to` is where they landed — one event covers both.
		expect(structure.op.from).toEqual({
			container: 'border',
			region: 'top',
			trackIndex: 0,
			toolbarIndex: 0,
		})
		expect(structure.op.to).toBeDefined()
		session.end()
	})

	it('a track-gap commit raises a move-toolbar op', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const a = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = a[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar: a, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'track-gap', track: live.borders.top[1] ?? [], gap: 1 }, sample)
		const structure = events.find(
			(e): e is DragEvent & { type: 'structure' } => e.type === 'structure'
		)
		expect(structure).toBeDefined()
		if (structure?.op.kind !== 'move-toolbar') throw new Error('expected move-toolbar op')
		session.end()
	})

	it('a dwell stack-gap commit raises a move-toolbar op', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const a = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = a[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar: a, item })
		const { events } = collectEvents(session)
		// Hover a stack gap to arm the dwell.
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 1 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs)
		const structure = events.find(
			(e): e is DragEvent & { type: 'structure' } => e.type === 'structure'
		)
		expect(structure).toBeDefined()
		if (structure?.op.kind !== 'move-toolbar') throw new Error('expected move-toolbar op')
		session.end()
		vi.useRealTimers()
	})

	it('a restructure commit carries pruned origin toolbar when emptied', () => {
		// Use a layout where the origin toolbar has exactly one item, so
		// dragging it out empties and prunes the toolbar.
		const singleItemLayout: SerializedLayout = {
			version: 1,
			borders: {
				top: [
					{ space: 1, toolbar: [{ tool: 'x' }] },
					{ space: 1, toolbar: [{ tool: 'y' }] },
				],
				right: [],
				bottom: [],
				left: [],
			},
			parking: [],
		}
		const tree = new PaletteLayoutTree(singleItemLayout)
		const live = tree.getLayout()
		const x = live.borders.top[0]?.[0]?.toolbar ?? []
		const y = live.borders.top[1]?.[0]?.toolbar ?? []
		const item = x[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar: x, item })
		const { events } = collectEvents(session)
		// Move the only tool from `x` into `y` — `x` should be pruned.
		session.over({ kind: 'item-gap', toolbar: y, gap: 1 }, sample)
		const structure = events.find(
			(e): e is DragEvent & { type: 'structure' } => e.type === 'structure'
		)
		expect(structure).toBeDefined()
		if (structure?.op.kind !== 'move-toolbar') throw new Error('expected move-toolbar op')
		// The origin toolbar `x` should be in pruned.
		expect(structure.op.pruned.length).toBeGreaterThan(0)
		expect(structure.op.pruned.some((v: LayoutPruneVictim) => v.toolbar === x)).toBe(true)
		session.end()
	})

	it('a slide release raises a move-toolbar op', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const session = tree.createDrag({ kind: 'toolbar', toolbar })
		const { events } = collectEvents(session)
		// Arm slide follow.
		session.measure({ axis: 'horizontal', start: 0, available: 100, resting: 50, grab: 25 })
		// Pass a null hover with a pointer that produces a non-zero delta
		// (raw = 100-25-0 = 75, clamped = 75, delta = 75-50 = 25).
		session.over(null, { clientX: 100, clientY: 0 })
		session.end()
		const structure = events.find(
			(e): e is DragEvent & { type: 'structure' } => e.type === 'structure'
		)
		expect(structure).toBeDefined()
		if (structure?.op.kind !== 'move-toolbar') throw new Error('expected move-toolbar op')
		// Slide: same toolbar identity, from and to both defined.
		expect(structure.op.from).toBeDefined()
		expect(structure.op.to).toBeDefined()
	})
})

/**
 * Phase 5 vocabulary conformance at the session level: the dry-side
 * track-gap fallback, the whole-toolbar neighbour-TB-edges rule, and the
 * shared sliding-flank veto — all observed through the `highlight` event
 * stream (never the legacy return-value form).
 */
describe('vocabulary cleanup (Phase 5)', () => {
	function stackGapEvents(events: DragEvent[]): Array<{ gap: number; state: string }> {
		return events
			.filter(
				(event): event is Extract<DragEvent, { type: 'highlight' }> =>
					event.type === 'highlight' && event.dz.kind === 'stack-gap'
			)
			.map((event) => ({
				gap: event.dz.kind === 'stack-gap' ? event.dz.gap : -1,
				state: event.state,
			}))
	}

	function trackGapEvents(events: DragEvent[]): Array<{ gap: number; state: string }> {
		return events
			.filter(
				(event): event is Extract<DragEvent, { type: 'highlight' }> =>
					event.type === 'highlight' && event.dz.kind === 'track-gap'
			)
			.map((event) => ({
				gap: event.dz.kind === 'track-gap' ? event.dz.gap : -1,
				state: event.state,
			}))
	}

	function itemGapEvents(events: DragEvent[]): Array<{ gap: number; state: string }> {
		return events
			.filter(
				(event): event is Extract<DragEvent, { type: 'highlight' }> =>
					event.type === 'highlight' && event.dz.kind === 'item-gap'
			)
			.map((event) => ({
				gap: event.dz.kind === 'item-gap' ? event.dz.gap : -1,
				state: event.state,
			}))
	}

	it('ABCD with D dragged: hovering D paints the flanking track gap, dragged gaps stay dark', () => {
		// Session-level anchor for the `edge-stay` e2e: the before side
		// still has free gap 2, the after side runs dry (gap 4 touches
		// the dragged tool) so the candidate moves out to the track gap
		// after the toolbar — while the flanking stacks still paint via
		// the containing track.
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const dragged = toolbar[3]
		if (!dragged) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item: dragged })
		const { events } = collectEvents(session)
		session.over({ kind: 'tool', toolbar, item: dragged }, sample)
		// Free gap 2 paints; gaps touching D (3, 4) stay dark …
		expect(itemGapEvents(events).map((entry) => entry.gap)).toEqual([2])
		// … but the flanking track gap does (gap 1 = after the sole slot) …
		expect(trackGapEvents(events).map((entry) => entry.gap)).toEqual([1])
		// … and the containing track's stacks paint too.
		expect(
			stackGapEvents(events)
				.map((entry) => entry.gap)
				.sort()
		).toEqual([0, 1])
		session.end()
	})

	it('same-toolbar forward hover paints the free flanks, dragged gaps stay dark', () => {
		// Session-level anchor for the `reorder-forward` e2e: hovering C
		// paints the nearest free gaps flanking it (0 and 3 — gaps 1
		// and 2 touch the dragged B); the commit then lands between, not
		// after.
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const dragged = toolbar[1]
		const anchor = toolbar[2]
		if (!dragged || !anchor) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item: dragged })
		const { events } = collectEvents(session)
		session.over({ kind: 'tool', toolbar, item: anchor }, sample)
		// Nearest free gaps flanking C are 0 and 3 (gaps 1–2 touch B) —
		// never the dragged-touching gaps.
		expect(
			itemGapEvents(events)
				.map((entry) => entry.gap)
				.sort()
		).toEqual([0, 3])
		session.end()
	})

	it('whole-toolbar hover paints neighbour TB edges, never neighbour track gaps', () => {
		// Session-level anchor for the `whole-toolbar` e2e: while a whole
		// toolbar is dragged, hovering its own tool paints the neighbour
		// TB edges (item-gaps on the adjacent toolbars) and no track gaps.
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const dragged = toolbar[0]
		if (!dragged) throw new Error('expected item')
		// Extract one tool into a second slot so the track holds two
		// toolbars (a whole-TB slide onto its own flank is vetoed).
		const setup = tree.createDrag({ kind: 'tool', toolbar, item: dragged })
		setup.over({ kind: 'track-gap', track: live.borders.top[0] ?? [], gap: 1 }, sample)
		setup.end()
		const track = live.borders.top[0] ?? []
		expect(track).toHaveLength(2)
		const second = track[1]?.toolbar ?? []
		const secondItem = second[0]
		if (!secondItem) throw new Error('expected item')
		// Drag the whole fresh singleton and hover its own tool.
		const session = tree.createDrag({ kind: 'toolbar', toolbar: second })
		const { events } = collectEvents(session)
		session.over({ kind: 'tool', toolbar: second, item: secondItem }, sample)
		// Neighbour TB edge paints (last gap of the previous toolbar) …
		const itemGaps = itemGapEvents(events).map((entry) => entry.gap)
		expect(itemGaps).toContain(3)
		// … and no track gap paints.
		expect(trackGapEvents(events)).toHaveLength(0)
		session.end()
	})

	it('sliding flanks veto paint and commit through one shared predicate', () => {
		// Direct hover on a flank of the sliding toolbar: dark (no paint)
		// and no commit — the same veto gates both.
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const dragged = toolbar[0]
		if (!dragged) throw new Error('expected item')
		const setup = tree.createDrag({ kind: 'tool', toolbar, item: dragged })
		setup.over({ kind: 'track-gap', track: live.borders.top[0] ?? [], gap: 1 }, sample)
		setup.end()
		const track = live.borders.top[0] ?? []
		const second = track[1]?.toolbar ?? []
		if (second.length === 0) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'toolbar', toolbar: second })
		const { events } = collectEvents(session)
		// Gap 1 flanks the sliding toolbar (slot 1 of a 2-slot track).
		session.over({ kind: 'track-gap', track, gap: 1 }, sample)
		expect(trackGapEvents(events)).toHaveLength(0)
		expect(events.some((event) => event.type === 'structure')).toBe(false)
		session.end()
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
		// Move to a stack gap: item paint flips off, stack paint flips on —
		// as `double` (the directly-hovered dwell target).
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		const states = events.filter((event) => event.type === 'highlight').map((event) => event.state)
		expect(states).toContain('off')
		expect(states).toContain('double')
		session.end()
	})

	it('a directly-hovered stack gap paints double, flanks stay on', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		// In-track hover first: the two flanking stack gaps paint `on`.
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		const flanked = events.filter(
			(event): event is Extract<DragEvent, { type: 'highlight' }> =>
				event.type === 'highlight' && event.dz.kind === 'stack-gap'
		)
		expect(flanked.length).toBe(2)
		expect(flanked.every((event) => event.state === 'on')).toBe(true)
		// Step onto gap 0 directly: gap 0 flips `on` → `double`, gap 1
		// flips `off` (only the hovered gap paints now).
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		const after = events.slice(flanked.length)
		const doubled = after.filter(
			(event): event is Extract<DragEvent, { type: 'highlight' }> =>
				event.type === 'highlight' && event.state === 'double'
		)
		expect(doubled).toHaveLength(1)
		expect(doubled[0]?.dz).toMatchObject({ kind: 'stack-gap', gap: 0 })
		expect(
			after.some(
				(event) =>
					event.type === 'highlight' &&
					event.state === 'off' &&
					event.dz.kind === 'stack-gap' &&
					event.dz.gap === 1
			)
		).toBe(true)
		session.end()
	})

	it('leaving the doubled gap for an in-track hover drops back to on', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		const other = toolbar[1]
		if (!item || !other) throw new Error('expected items')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		const doubled = events.filter((event) => event.type === 'highlight')
		expect(doubled.some((event) => event.state === 'double')).toBe(true)
		// Back to an in-track hover: the same gap flips `double` → `on`
		// (re-emitted with the new state), the flank repaints `on`.
		session.over({ kind: 'tool', toolbar, item: other }, sample)
		const after = events.slice(doubled.length)
		const flipped = after.filter(
			(event): event is Extract<DragEvent, { type: 'highlight' }> =>
				event.type === 'highlight' &&
				event.dz.kind === 'stack-gap' &&
				event.dz.gap === 0 &&
				event.state === 'on'
		)
		expect(flipped).toHaveLength(1)
		session.end()
	})

	it('a directly-hovered parking gap paints double', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'parking-gap', parking: live.parking, gap: 1 }, sample)
		const doubled = events.filter(
			(event): event is Extract<DragEvent, { type: 'highlight' }> =>
				event.type === 'highlight' && event.state === 'double'
		)
		expect(doubled).toHaveLength(1)
		expect(doubled[0]?.dz).toMatchObject({ kind: 'parking-gap', gap: 1 })
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

	it('re-paints the live gap after a dwell commit (no stale UI)', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		// Parking: after the row is created the armed gap stays valid (two
		// rows, no emptied veto), so the re-paint lands on the live gap.
		session.over({ kind: 'parking-gap', parking: live.parking, gap: 1 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.parking).toHaveLength(2)
		const structureAt = events.findIndex((event) => event.type === 'structure')
		expect(structureAt).toBeGreaterThan(-1)
		const after = events.slice(structureAt + 1)
		// The still-hovered gap keeps its `double` state (dwell target);
		// anything else re-paints `on`. Either way the live gap repaints.
		const repainted = after.filter(
			(event) => event.type === 'highlight' && (event.state === 'on' || event.state === 'double')
		)
		expect(repainted.length).toBeGreaterThan(0)
		// Never a diff against nodes a re-render destroyed: no `off` after
		// the structure event (the baseline was cleared, not diffed).
		expect(after.some((event) => event.type === 'highlight' && event.state === 'off')).toBe(false)
		session.end()
	})

	it('a stack dwell leaves vetoed gaps dark after the commit', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		// The dwell extracted the tool into a new track holding it wholly —
		// the armed gap is now veto-adjacent, so nothing re-paints (and no
		// `off` for the destroyed node either).
		const structureAt = events.findIndex((event) => event.type === 'structure')
		expect(structureAt).toBeGreaterThan(-1)
		expect(events.slice(structureAt + 1)).toHaveLength(0)
		session.end()
	})
})

/**
 * Phase 6 creation + outside conformance at the session level: `outside`
 * paints/dwells like `stack-gap` (one index space), and a `catalog` grab
 * inserts on the first placement then moves like a normal drag.
 */
describe('outside + catalog (Phase 6)', () => {
	it('outside paints double on direct hover, like stack-gap', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'outside', border: live.borders.top, gap: 0 }, sample)
		const doubled = events.filter(
			(event): event is Extract<DragEvent, { type: 'highlight' }> =>
				event.type === 'highlight' && event.state === 'double'
		)
		expect(doubled).toHaveLength(1)
		// One index space: the beside-border pointer paints the same node
		// as the in-border gap, so the event carries the `stack-gap` DZ.
		expect(doubled[0]?.dz).toMatchObject({ kind: 'stack-gap', gap: 0 })
		session.end()
	})

	it('outside → stack-gap on the same gap keeps double (one index space)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		session.over({ kind: 'outside', border: live.borders.top, gap: 0 }, sample)
		const first = events.filter((event) => event.type === 'highlight').length
		// Same gap, in-border hover: still directly hovered, still `double`
		// — no `off`, no re-emit (the diff is unchanged).
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		const after = events.slice(first)
		expect(after).toHaveLength(0)
		session.end()
	})

	it('outside dwells into a new track', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const session = tree.createDrag({ kind: 'tool', toolbar, item })
		const { events } = collectEvents(session)
		const before = live.borders.top.length
		session.over({ kind: 'outside', border: live.borders.top, gap: 0 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.borders.top).toHaveLength(before + 1)
		expect(events.some((event) => event.type === 'structure')).toBe(true)
		session.end()
	})

	it('catalog first placement merges into an item-gap (from absent)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const target = live.borders.top[1]?.[0]?.toolbar ?? []
		const item = { tool: 'fresh' } as ToolbarItem
		const session = tree.createDrag({ kind: 'catalog', item })
		const { events } = collectEvents(session)
		const before = target.length
		session.over({ kind: 'item-gap', toolbar: target, gap: 1 }, sample)
		expect(target).toHaveLength(before + 1)
		expect(target.includes(item)).toBe(true)
		const structure = events.find(
			(event): event is DragEvent & { type: 'structure' } => event.type === 'structure'
		)
		expect(structure).toBeDefined()
		if (structure?.op.kind !== 'move-toolbar') throw new Error('expected move-toolbar op')
		// Creation: no origin, so `from` is absent and `to` is the placed toolbar.
		expect(structure.op.from).toBeUndefined()
		expect(structure.op.to).toBeDefined()
		session.end()
	})

	it('catalog first placement extracts a singleton into a track-gap', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const track = live.borders.top[1] ?? []
		const before = track.length
		const item = { tool: 'fresh' } as ToolbarItem
		const session = tree.createDrag({ kind: 'catalog', item })
		session.over({ kind: 'track-gap', track, gap: 1 }, sample)
		expect(track).toHaveLength(before + 1)
		expect(track[1]?.toolbar).toEqual([item])
		session.end()
	})

	it('catalog dwell creates a track at a stack gap', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const item = { tool: 'fresh' } as ToolbarItem
		const session = tree.createDrag({ kind: 'catalog', item })
		const before = live.borders.top.length
		session.over({ kind: 'stack-gap', border: live.borders.top, gap: 0 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.borders.top).toHaveLength(before + 1)
		session.end()
	})

	it('catalog dwell creates a row at a parking gap', () => {
		vi.useFakeTimers()
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const item = { tool: 'fresh' } as ToolbarItem
		const session = tree.createDrag({ kind: 'catalog', item })
		const before = live.parking.length
		session.over({ kind: 'parking-gap', parking: live.parking, gap: 1 }, sample)
		vi.advanceTimersByTime(configuration.stackDzHoverMs + 10)
		expect(live.parking).toHaveLength(before + 1)
		session.end()
	})

	it('catalog second hover moves the placed toolbar (no duplicate insert)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const first = live.borders.top[0]?.[0]?.toolbar ?? []
		const second = live.borders.top[1]?.[0]?.toolbar ?? []
		const item = { tool: 'fresh' } as ToolbarItem
		const session = tree.createDrag({ kind: 'catalog', item })
		session.over({ kind: 'item-gap', toolbar: first, gap: 1 }, sample)
		const placedLength = first.length
		// The placed item now moves like a normal drag — merging into the
		// second toolbar prunes nothing and inserts exactly once.
		session.over({ kind: 'item-gap', toolbar: second, gap: 1 }, sample)
		expect(second.includes(item)).toBe(true)
		expect(first.includes(item)).toBe(false)
		expect(first).toHaveLength(placedLength - 1)
		session.end()
	})
})
