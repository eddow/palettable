/**
 * `@palettable/core` — drag session tests (Phase 1: session shell on the
 * existing stream).
 *
 * Pins the session contract: creation resolves the grab target against the
 * live tree (drawer children refuse), `over` delegates to the legacy engine
 * (same paint + commit as `dragOver`), `measure`/`end` are safe no-ops for
 * now, and the session exposes the live tree (no layout param per method).
 */
import { describe, expect, it } from 'vitest'
import type { GrabTarget, Hoverable } from './drag.js'
// Side-effect import: wires `PaletteLayoutTree.prototype.createDrag`
// (the factory lives in `drag.ts` to keep the import one-way).
import './drag.js'
import { PaletteLayoutTree, type SerializedLayout } from './layout.js'

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
