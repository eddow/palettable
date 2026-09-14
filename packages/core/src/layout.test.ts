import { describe, expect, it, vi } from 'vitest'
import * as schedule from './globals.js'
import {
	defaultLayoutFromPoints,
	type ItemLocation,
	isDrawerItem,
	type PaletteLayout,
	PaletteLayoutTree,
	type SerializedLayout,
} from './layout.js'

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

const topFirst = (itemIndex: number): ItemLocation => ({
	container: 'border',
	region: 'top',
	trackIndex: 0,
	toolbarIndex: 0,
	itemIndex,
})

describe('defaultLayoutFromPoints', () => {
	it('puts every point in one top toolbar', () => {
		expect(defaultLayoutFromPoints(['a', 'b'])).toEqual({
			version: 1,
			borders: {
				top: [{ space: 1, toolbar: [{ tool: 'a' }, { tool: 'b' }] }],
				right: [],
				bottom: [],
				left: [],
			},
			parking: [],
		})
	})

	it('produces an empty layout for no points', () => {
		const layout = defaultLayoutFromPoints([])
		expect(layout.borders.top).toEqual([])
		expect(layout.parking).toEqual([])
	})
})

describe('PaletteLayoutTree construction', () => {
	it('starts empty with no initial layout', () => {
		const tree = new PaletteLayoutTree()
		expect(tree.getSnapshot()).toEqual({
			version: 1,
			borders: { top: [], right: [], bottom: [], left: [] },
			parking: [],
		})
	})

	it('hydrates a serialized layout (each slot in its own track)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		expect(live.borders.top).toHaveLength(2)
		expect(live.borders.top[0]).toHaveLength(1)
		expect(live.borders.top[0]?.[0]?.toolbar).toEqual([{ tool: 'a' }, { tool: 'b' }])
		expect(live.parking).toEqual([[{ tool: 'p' }]])
	})

	it('accepts a live layout without double-wrapping (regression)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const reopened = new PaletteLayoutTree(live)
		expect(reopened.getSnapshot()).toEqual(tree.getSnapshot())
		expect(() => reopened.getLayout()).not.toThrow()
	})

	it('getLayout returns a deep clone (mutating it never touches the tree)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		live.borders.top[0]?.[0]?.toolbar.push({ tool: 'injected' })
		live.parking.push([{ tool: 'injected' }])
		expect(tree.getSnapshot().borders.top[0]?.toolbar).toHaveLength(2)
		expect(tree.getSnapshot().parking).toHaveLength(1)
	})

	it('clones item configs (shallow per item)', () => {
		const tree = new PaletteLayoutTree({
			version: 1,
			borders: {
				top: [{ space: 1, toolbar: [{ tool: 'a', config: { label: 'A' } }] }],
				right: [],
				bottom: [],
				left: [],
			},
		})
		const live = tree.getLayout()
		;(live.borders.top[0]?.[0]?.toolbar[0]?.config as Record<string, unknown>).label = 'mutated'
		expect(tree.getSnapshot().borders.top[0]?.toolbar[0]?.config).toEqual({ label: 'A' })
	})

	it('round-trips drawer items through snapshot', () => {
		const tree = new PaletteLayoutTree({
			version: 1,
			borders: {
				top: [
					{
						space: 1,
						toolbar: [{ editor: 'drawer', config: { label: 'D' }, toolbar: [{ tool: 'a' }] }],
					},
				],
				right: [],
				bottom: [],
				left: [],
			},
		})
		const snapshot = tree.getSnapshot()
		expect(snapshot.borders.top[0]?.toolbar[0]).toEqual({
			editor: 'drawer',
			config: { label: 'D' },
			toolbar: [{ tool: 'a', editor: undefined, config: undefined }],
		})
		const live = tree.getLayout()
		expect(isDrawerItem(live.borders.top[0]?.[0]?.toolbar[0])).toBe(true)
	})

	it('round-trips inline virtual definitions through snapshot', () => {
		const stash = {
			id: 'pause',
			label: 'Pause',
			source: 'gameSpeed',
			kind: 'stash',
			stashedValue: 0,
		} as const
		const tree = new PaletteLayoutTree({
			version: 1,
			borders: {
				top: [{ space: 1, toolbar: [{ tool: stash }] }],
				right: [],
				bottom: [],
				left: [],
			},
		})
		const snapshot = tree.getSnapshot()
		expect(snapshot.borders.top[0]?.toolbar[0]?.tool).toEqual({ ...stash })
		// The snapshot shares no structure with the live tree.
		;(snapshot.borders.top[0]?.toolbar[0]?.tool as { label: string }).label = 'mutated'
		expect(tree.getLayout().borders.top[0]?.[0]?.toolbar[0]).toEqual({
			tool: { ...stash },
			editor: undefined,
			config: undefined,
		})
	})
})

describe('moveItem', () => {
	it('reorders within one toolbar (forward index adjusts for the removal)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		tree.moveItem(topFirst(0), topFirst(2))
		expect(tree.getSnapshot().borders.top[0]?.toolbar.map((item) => item.tool)).toEqual(['b', 'a'])
	})

	it('moves across toolbars and prunes the emptied toolbar', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		tree.moveItem(
			{ container: 'border', region: 'top', trackIndex: 1, toolbarIndex: 0, itemIndex: 0 },
			topFirst(1)
		)
		const snapshot = tree.getSnapshot()
		expect(snapshot.borders.top).toHaveLength(1)
		expect(snapshot.borders.top[0]?.toolbar.map((item) => item.tool)).toEqual(['a', 'c', 'b'])
	})

	it('moves between borders and parking', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		tree.moveItem(topFirst(0), { container: 'parking', toolbarIndex: 0, itemIndex: 1 })
		const snapshot = tree.getSnapshot()
		expect(snapshot.borders.top[0]?.toolbar.map((item) => item.tool)).toEqual(['b'])
		expect(snapshot.parking?.[0]?.map((item) => item.tool)).toEqual(['p', 'a'])
	})

	it('throws on unknown locations and out-of-bounds indices', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		expect(() =>
			tree.moveItem(topFirst(0), {
				container: 'border',
				region: 'right',
				trackIndex: 0,
				toolbarIndex: 0,
				itemIndex: 0,
			})
		).toThrow('moveItem: unknown location')
		expect(() => tree.moveItem(topFirst(9), topFirst(0))).toThrow(
			'moveItem: item index 9 out of bounds'
		)
	})
})

describe('moveToolbar', () => {
	it('relocates a toolbar across regions preserving identity', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const before = tree.getLayout().borders.top[1]?.[0]?.toolbar
		tree.moveToolbar(
			{ container: 'border', region: 'top', trackIndex: 1, toolbarIndex: 0 },
			{ container: 'border', region: 'left', trackIndex: 0, toolbarIndex: 0 }
		)
		const snapshot = tree.getSnapshot()
		expect(snapshot.borders.top).toHaveLength(1)
		expect(snapshot.borders.left[0]?.toolbar).toEqual(
			before?.map((item) => ({
				tool: item.tool,
				editor: item.editor,
				config: item.config,
			}))
		)
	})

	it('moves between parking and borders', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		tree.moveToolbar(
			{ container: 'parking', toolbarIndex: 0 },
			{ container: 'border', region: 'bottom', trackIndex: 0, toolbarIndex: 0 }
		)
		const snapshot = tree.getSnapshot()
		expect(snapshot.parking).toEqual([])
		expect(snapshot.borders.bottom[0]?.toolbar.map((item) => item.tool)).toEqual(['p'])
	})

	it('throws on unknown locations', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		expect(() =>
			tree.moveToolbar(
				{ container: 'parking', toolbarIndex: 9 },
				{ container: 'parking', toolbarIndex: 0 }
			)
		).toThrow('moveToolbar: unknown location')
	})
})

describe('insertItem / removeItem', () => {
	it('inserts at an exact index', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		tree.insertItem(topFirst(1), { tool: 'z' })
		expect(tree.getSnapshot().borders.top[0]?.toolbar.map((item) => item.tool)).toEqual([
			'a',
			'z',
			'b',
		])
	})

	it('removes and returns the item, pruning emptied toolbars', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const removed = tree.removeItem({
			container: 'border',
			region: 'top',
			trackIndex: 1,
			toolbarIndex: 0,
			itemIndex: 0,
		})
		expect(removed).toEqual({ tool: 'c', editor: undefined, config: undefined })
		expect(tree.getSnapshot().borders.top).toHaveLength(1)
	})

	it('throws on unknown locations', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		expect(() => tree.insertItem(topFirst(9), { tool: 'z' })).not.toThrow()
		expect(() =>
			tree.removeItem({
				container: 'border',
				region: 'right',
				trackIndex: 0,
				toolbarIndex: 0,
				itemIndex: 0,
			})
		).toThrow('removeItem: unknown location')
	})
})

describe('setLayout / subscribe', () => {
	it('replaces the whole layout and emits a fresh snapshot', () => {
		const tree = new PaletteLayoutTree()
		const listener = vi.fn()
		tree.subscribe(listener)
		tree.setLayout(twoItemLayout())
		expect(listener).toHaveBeenCalledTimes(1)
		expect(listener.mock.calls[0]?.[0]).toEqual(tree.getSnapshot())
	})

	it('emits on every mutation with a fresh snapshot object', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const snapshots: SerializedLayout[] = []
		tree.subscribe((snapshot) => snapshots.push(snapshot))
		tree.moveItem(topFirst(0), topFirst(1))
		tree.insertItem(topFirst(0), { tool: 'z' })
		expect(snapshots).toHaveLength(2)
		expect(snapshots[0]).not.toBe(snapshots[1])
	})

	it('unsubscribe stops notifications; clearListeners drops everything', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const listener = vi.fn()
		const stop = tree.subscribe(listener)
		stop()
		tree.moveItem(topFirst(0), topFirst(1))
		expect(listener).not.toHaveBeenCalled()

		tree.subscribe(listener)
		tree.clearListeners()
		tree.moveItem(topFirst(0), topFirst(1))
		expect(listener).not.toHaveBeenCalled()
	})

	it('a throwing listener never blocks the others', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const after = vi.fn()
		// The tree re-throws via scheduleMicrotask — capture it instead of
		// letting it escape as an uncaught exception in the test worker.
		const queued: (() => void)[] = []
		const spy = vi.spyOn(schedule, 'scheduleMicrotask').mockImplementation((callback) => {
			queued.push(callback)
		})
		try {
			tree.subscribe(() => {
				throw new Error('bad layout listener')
			})
			tree.subscribe(after)
			tree.moveItem(topFirst(0), topFirst(1))
			expect(after).toHaveBeenCalledTimes(1)
			expect(queued).toHaveLength(1)
			expect(() => queued[0]?.()).toThrow('bad layout listener')
		} finally {
			spy.mockRestore()
		}
	})

	it('accepts a live layout in setLayout', () => {
		const tree = new PaletteLayoutTree()
		const live: PaletteLayout = {
			borders: {
				top: [[{ space: 2, toolbar: [{ tool: 'a' }] }]],
				right: [],
				bottom: [],
				left: [],
			},
			parking: [],
		}
		tree.setLayout(live)
		expect(tree.getSnapshot().borders.top[0]).toMatchObject({ space: 2 })
	})
})

describe('isDrawerItem', () => {
	it('detects drawers and is null-safe', () => {
		expect(isDrawerItem(null)).toBe(false)
		expect(isDrawerItem(undefined)).toBe(false)
		expect(isDrawerItem({ tool: 'a' })).toBe(false)
		expect(isDrawerItem({ editor: 'status' })).toBe(false)
		expect(isDrawerItem({ editor: 'drawer', toolbar: [] })).toBe(true)
		expect(isDrawerItem({ editor: 'drawer' })).toBe(false)
	})
})
