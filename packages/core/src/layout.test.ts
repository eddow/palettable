import { describe, expect, it, vi } from 'vitest'
import * as schedule from './globals.js'
import {
	borderStackHighlight,
	commitDraggedToItemSpace,
	commitDraggedToParking,
	commitDraggedToParkingRow,
	commitDraggedToStackSpace,
	commitDraggedToTrackSpace,
	type DraggingState,
	defaultLayoutFromPoints,
	draggingEmptiesParkingRow,
	draggingEmptiesTrackIndex,
	dragOver,
	dragStart,
	type ItemLocation,
	isDraggingWholeToolbar,
	isDrawerItem,
	isItemSpaceFree,
	itemSpaceHighlight,
	moveToolbarToStack,
	moveToolbarToTrack,
	nearestFreeItemSpaceAfter,
	nearestFreeItemSpaceBefore,
	type PaletteLayout,
	PaletteLayoutTree,
	parkingGapHighlight,
	refreshDragMode,
	resolveDragMode,
	type SerializedLayout,
	startDraggingState,
	trackSpaceHighlight,
	validateSerializedLayout,
	wholeToolbarNeighbourEdges,
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

/** Four-tool single toolbar: the ABCD fixture for edge-drag conformance. */
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

/** Unused multi-toolbar fixture (kept for reference): serialized borders
 * hydrate flat — one track per slot — so multi-TB tracks are built live in
 * the tests below instead. */
function _threeToolbarLayout(): SerializedLayout {
	return {
		version: 1,
		borders: {
			top: [
				{ space: 0.2, toolbar: [{ tool: 'a' }] },
				{ space: 0.3, toolbar: [{ tool: 'b' }] },
				{ space: 0.1, toolbar: [{ tool: 'c' }] },
			],
			right: [],
			bottom: [],
			left: [],
		},
		parking: [],
	}
}

const topFirst = (itemIndex: number): ItemLocation => ({
	container: 'border',
	region: 'top',
	trackIndex: 0,
	toolbarIndex: 0,
	itemIndex,
})

function borderDrag(toolbarIndex = 0, toolCount = 1): DraggingState {
	const tree = new PaletteLayoutTree(twoItemLayout())
	const live = tree.getLayout()
	const toolbar = live.borders.top[0]?.[toolbarIndex]?.toolbar ?? []
	const track = live.borders.top[0] ?? []
	const border = live.borders.top
	const tools = toolbar.slice(0, toolCount)
	return startDraggingState({
		tools: tools.length > 0 ? tools : toolbar.slice(0, 1),
		origin: { kind: 'border', toolbar, track, border },
	})
}

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

	it('validates serialized layouts (version, regions, items, inline tools)', () => {
		expect(validateSerializedLayout(twoItemLayout())).toBe(true)
		expect(validateSerializedLayout({ version: 2, borders: {} })).toBe(false)
		expect(validateSerializedLayout({ version: 1 })).toBe(false)
		expect(validateSerializedLayout({ version: 1, borders: { top: [] } })).toBe(false)
		expect(
			validateSerializedLayout({
				version: 1,
				borders: { top: [{ space: 'x', toolbar: [] }], right: [], bottom: [], left: [] },
			})
		).toBe(false)
		expect(
			validateSerializedLayout({
				version: 1,
				borders: { top: [{ space: 1, toolbar: [{ tool: 123 }] }], right: [], bottom: [], left: [] },
			})
		).toBe(false)
		expect(
			validateSerializedLayout({
				version: 1,
				borders: {
					top: [
						{
							space: 1,
							toolbar: [
								{
									tool: {
										id: 'pause',
										label: 'Pause',
										source: 'gameSpeed',
										kind: 'stash',
										stashedValue: 0,
									},
								},
							],
						},
					],
					right: [],
					bottom: [],
					left: [],
				},
			})
		).toBe(true)
		expect(
			validateSerializedLayout({
				version: 1,
				borders: {
					top: [{ space: 1, toolbar: [{ tool: { kind: 'bogus' } }] }],
					right: [],
					bottom: [],
					left: [],
				},
			})
		).toBe(false)
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

	it('getLayout returns the live layout (read-only — commit via structural methods)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		expect(live).toBe(tree.getLayout())
		expect(live.borders.top[0]?.[0]?.toolbar).toHaveLength(2)
		expect(live.parking).toHaveLength(1)
	})

	it('clones inputs on load (mutating the constructor arg never touches the tree)', () => {
		const input = {
			version: 1,
			borders: {
				top: [{ space: 1, toolbar: [{ tool: 'a', config: { label: 'A' } }] }],
				right: [],
				bottom: [],
				left: [],
			},
		} as const
		const tree = new PaletteLayoutTree(input as never)
		const written = input.borders.top[0]!.toolbar[0] as { config: Record<string, unknown> }
		written.config.label = 'mutated'
		expect(tree.getSnapshot().borders.top[0]?.toolbar[0]?.config).toEqual({ label: 'A' })
	})

	it('round-trips drawer items through snapshot', () => {
		const tree = new PaletteLayoutTree({
			version: 1,
			borders: {
				top: [
					{
						space: 1,
						toolbar: [
							{
								editor: 'drawer',
								config: { label: 'D' },
								toolbar: [{ space: 1, toolbar: [{ tool: 'a' }] }],
							},
						],
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
			toolbar: [{ space: 1, toolbar: [{ tool: 'a', editor: undefined, config: undefined }] }],
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

describe('moveItem / moveToolbar from?/to? + subscribeOps', () => {
	it('moveItem with no from creates (insert path)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const ops: unknown[] = []
		tree.subscribeOps((op) => ops.push(op))
		tree.moveItem(undefined, topFirst(1), { tool: 'z' })
		expect(tree.getSnapshot().borders.top[0]?.toolbar.map((item) => item.tool)).toEqual([
			'a',
			'z',
			'b',
		])
		expect(ops).toHaveLength(1)
		expect(ops[0]).toMatchObject({ kind: 'insert-item' })
	})

	it('moveItem with no to deletes (remove path, prunes emptied toolbar)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const ops: unknown[] = []
		tree.subscribeOps((op) => ops.push(op))
		tree.moveItem(
			{ container: 'border', region: 'top', trackIndex: 1, toolbarIndex: 0, itemIndex: 0 },
			undefined
		)
		expect(tree.getSnapshot().borders.top).toHaveLength(1)
		expect(ops).toHaveLength(1)
		expect(ops[0]).toMatchObject({ kind: 'remove-item' })
	})

	it('moveItem throws when both from and to are undefined', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		expect(() => tree.moveItem(undefined, undefined)).toThrow('both undefined')
	})

	it('moveItem emits a move-item op with the live item ref', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const ops: { kind: string; item?: unknown; pruned?: unknown[] }[] = []
		tree.subscribeOps((op) => ops.push(op as never))
		tree.moveItem(topFirst(0), topFirst(2))
		expect(ops).toHaveLength(1)
		expect(ops[0]?.kind).toBe('move-item')
		const live = tree.getLayout()
		expect(ops[0]?.item).toBe(live.borders.top[0]?.[0]?.toolbar[1])
		expect(ops[0]?.pruned).toEqual([])
	})

	it('moveItem op carries prune victims when the origin toolbar empties', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const ops: { kind: string; pruned?: { kind: string }[] }[] = []
		tree.subscribeOps((op) => ops.push(op as never))
		tree.moveItem(
			{ container: 'border', region: 'top', trackIndex: 1, toolbarIndex: 0, itemIndex: 0 },
			topFirst(0)
		)
		expect(ops).toHaveLength(1)
		expect(ops[0]?.pruned?.map((victim) => victim.kind)).toEqual(['toolbar', 'track'])
	})

	it('moveToolbar with no from creates, with no to deletes', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		tree.moveToolbar(undefined, { container: 'parking', toolbarIndex: 1 }, [{ tool: 'z' }])
		expect(tree.getSnapshot().parking?.[1]?.map((item) => item.tool)).toEqual(['z'])
		tree.moveToolbar({ container: 'parking', toolbarIndex: 1 }, undefined)
		expect(tree.getSnapshot().parking).toHaveLength(1)
	})

	it('moveToolbar op: no from = creation, no to = deletion, both = move', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const ops: { kind: string; from?: unknown; to?: unknown }[] = []
		tree.subscribeOps((op) => ops.push(op as never))
		const parkingAt = { container: 'parking', toolbarIndex: 0 } as const
		tree.moveToolbar(undefined, parkingAt, [{ tool: 'z' }])
		tree.moveToolbar(parkingAt, { container: 'parking', toolbarIndex: 0 })
		tree.moveToolbar({ container: 'parking', toolbarIndex: 0 }, undefined)
		expect(ops[0]?.from).toBeUndefined()
		expect(ops[0]?.to).toEqual(parkingAt)
		expect(ops[1]?.from).toEqual(parkingAt)
		expect(ops[1]?.to).toEqual(parkingAt)
		expect(ops[2]?.from).toEqual(parkingAt)
		expect(ops[2]?.to).toBeUndefined()
	})

	it('moveToolbar deletion reports the prune cascade (slot + emptied track)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const ops: { pruned?: { kind: string }[] }[] = []
		tree.subscribeOps((op) => ops.push(op as never))
		// `twoItemLayout` puts one toolbar per track in the top region.
		tree.moveToolbar(topFirst(0), undefined)
		expect(ops[0]?.pruned?.map((victim) => victim.kind)).toEqual(['toolbar', 'track'])
		expect(tree.getLayout().borders.top).toHaveLength(1)
	})

	it('moveToolbar into a track splits the gap instead of forcing space 1', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		// Removing one top slot leaves a single-track border, then re-insert.
		tree.moveToolbar(topFirst(0), undefined)
		tree.moveToolbar(undefined, topFirst(0), [{ tool: 'z' }])
		const track = tree.getLayout().borders.top[0] ?? []
		expect(track).toHaveLength(2)
		const spaces = track.map((slot) => slot.space)
		expect(spaces.every((space) => space >= 0 && space <= 1)).toBe(true)
		expect(spaces.reduce((sum, space) => sum + space, 0)).toBeLessThanOrEqual(1)
	})

	it('moveToolbar throws when both from and to are undefined', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		expect(() => tree.moveToolbar(undefined, undefined)).toThrow('both undefined')
	})

	it('insertItem/removeItem emit ops; setLayout emits a replace op', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const kinds: string[] = []
		tree.subscribeOps((op) => kinds.push(op.kind))
		tree.insertItem(topFirst(0), { tool: 'z' })
		tree.removeItem(topFirst(0))
		tree.setLayout(twoItemLayout())
		expect(kinds).toEqual(['insert-item', 'remove-item', 'replace'])
	})

	it('subscribeOps unsubscribe + clearListeners drop op listeners', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const listener = vi.fn()
		const stop = tree.subscribeOps(listener)
		stop()
		tree.moveItem(topFirst(0), topFirst(1))
		expect(listener).not.toHaveBeenCalled()
		tree.subscribeOps(listener)
		tree.clearListeners()
		tree.moveItem(topFirst(0), topFirst(1))
		expect(listener).not.toHaveBeenCalled()
	})
})

describe('drag veto + mode helpers (explicit dragging state)', () => {
	it('resolveDragMode: whole toolbar → slide, subset → restructure', () => {
		const whole = borderDrag(0, 2)
		expect(resolveDragMode(whole)).toBe('slide')
		const subset = borderDrag(0, 1)
		expect(resolveDragMode(subset)).toBe('restructure')
		expect(refreshDragMode(subset)).toBe('restructure')
		expect(subset.mode).toBe('restructure')
	})

	it('isDraggingWholeToolbar is container-scoped (identity + origin toolbar)', () => {
		const dragging = borderDrag(0, 2)
		const live = dragging.origin.kind === 'border' ? dragging.origin.track : []
		expect(isDraggingWholeToolbar(dragging, dragging.origin.toolbar)).toBe(true)
		expect(isDraggingWholeToolbar(dragging, live[1]?.toolbar ?? [])).toBe(false)
		expect(isDraggingWholeToolbar(undefined, dragging.origin.toolbar)).toBe(false)
	})

	it('isItemSpaceFree rejects gaps touching dragged tools', () => {
		const dragging = borderDrag(0, 1)
		const toolbar = dragging.origin.toolbar
		// A DZ beside a dragged tool never highlights: gap 0 touches the
		// dragged edge tool, so it stays dark (the candidate moves out to
		// the track gap — see `trackSpaceHighlight`).
		expect(isItemSpaceFree(dragging, toolbar, 0)).toBe(false)
		expect(isItemSpaceFree(dragging, toolbar, 1)).toBe(false)
		expect(isItemSpaceFree(dragging, toolbar, 2)).toBe(true)
		expect(isItemSpaceFree(undefined, toolbar, 0)).toBe(true)
	})

	it('nearestFree scans both directions, undefined when all touch dragged tools', () => {
		const dragging = borderDrag(0, 1)
		const toolbar = dragging.origin.toolbar
		expect(nearestFreeItemSpaceBefore(dragging, toolbar, 0)).toBe(undefined)
		expect(nearestFreeItemSpaceAfter(dragging, toolbar, 1)).toBe(2)
		expect(nearestFreeItemSpaceBefore(dragging, toolbar, 2)).toBe(2)
	})

	it('draggingEmptiesTrackIndex finds the single-toolbar whole-dragged track', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const sole = live.borders.top[1]?.[0]?.toolbar ?? []
		const track = live.borders.top[1] ?? []
		const dragging: DraggingState = startDraggingState({
			tools: [...sole],
			origin: { kind: 'border', toolbar: sole, track, border: live.borders.top },
		})
		expect(draggingEmptiesTrackIndex(dragging, live.borders.top)).toBe(1)
		const partial = borderDrag(0, 1)
		expect(draggingEmptiesTrackIndex(partial, live.borders.top)).toBe(undefined)
		expect(draggingEmptiesTrackIndex(undefined, live.borders.top)).toBe(undefined)
	})

	it('draggingEmptiesParkingRow finds the sole-row whole-dragged stack', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const sole = live.parking[0] ?? []
		const dragging: DraggingState = startDraggingState({
			tools: [...sole],
			origin: { kind: 'parking', toolbar: sole, parking: live.parking, index: 0 },
		})
		expect(draggingEmptiesParkingRow(dragging, live.parking)).toBe(0)
		const border = borderDrag(0, 1)
		expect(draggingEmptiesParkingRow(border, live.parking)).toBe(undefined)
	})
})

describe('gap highlight (pure, no DOM)', () => {
	it('border stacks: row hover flanks, gap hover singles, veto suppresses', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const dragging = borderDrag(0, 1)
		const row = borderStackHighlight({
			border: live.borders.top,
			active: 0,
			hovered: undefined,
			editing: true,
			dragging,
		})
		expect([...row.highlighted]).toEqual([0, 1])
		expect(row.hovered).toBe(undefined)
		const gap = borderStackHighlight({
			border: live.borders.top,
			active: undefined,
			hovered: 2,
			editing: true,
			dragging,
		})
		expect([...gap.highlighted]).toEqual([2])
		expect(gap.hovered).toBe(2)
	})

	it('border stacks: emptied-track neighbours never highlight, mask shows end gap', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const sole = live.borders.top[1]?.[0]?.toolbar ?? []
		const track = live.borders.top[1] ?? []
		const dragging: DraggingState = startDraggingState({
			tools: [...sole],
			origin: { kind: 'border', toolbar: sole, track, border: live.borders.top },
		})
		const vetoed = borderStackHighlight({
			border: live.borders.top,
			active: undefined,
			hovered: 1,
			editing: true,
			dragging,
		})
		expect([...vetoed.highlighted]).toEqual([])
		const masked = borderStackHighlight({
			border: live.borders.top,
			active: undefined,
			hovered: undefined,
			editing: true,
			dragging,
			maskActive: true,
		})
		// Mask shows the inner end gap even under the emptied veto (the veto
		// applies to direct/row hover; the mask is the console/panel fallback).
		expect([...masked.highlighted]).toEqual([2])
	})

	it('border stacks: no highlight when not editing or not dragging', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const dragging = borderDrag(0, 1)
		expect(
			borderStackHighlight({
				border: live.borders.top,
				active: 0,
				hovered: undefined,
				editing: false,
				dragging,
			}).highlighted.size
		).toBe(0)
		expect(
			borderStackHighlight({
				border: live.borders.top,
				active: 0,
				hovered: undefined,
				editing: true,
				dragging: undefined,
			}).highlighted.size
		).toBe(0)
	})

	it('parking gaps mirror the stack protocol with the row veto', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const dragging = borderDrag(0, 1)
		const row = parkingGapHighlight({
			parking: live.parking,
			active: 0,
			hovered: undefined,
			editing: true,
			dragging,
		})
		expect([...row.highlighted]).toEqual([0, 1])
		const sole = live.parking[0] ?? []
		const parkingDrag: DraggingState = startDraggingState({
			tools: [...sole],
			origin: { kind: 'parking', toolbar: sole, parking: live.parking, index: 0 },
		})
		const vetoed = parkingGapHighlight({
			parking: live.parking,
			active: undefined,
			hovered: 0,
			editing: true,
			dragging: parkingDrag,
		})
		expect([...vetoed.highlighted]).toEqual([])
	})

	it('item spaces: dragged-touching gaps never highlight, flank falls back to free', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const dragging: DraggingState = startDraggingState({
			tools: toolbar.slice(0, 1),
			origin: {
				kind: 'border',
				toolbar,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
		})
		// Gap 0 touches the dragged tool: dark. The candidate moves out to
		// the track gap (see the track-spaces test below).
		const direct = itemSpaceHighlight({
			toolbar,
			activeItem: undefined,
			hovered: 0,
			editing: true,
			dragging,
		})
		expect([...direct.highlighted]).toEqual([])
		const flank = itemSpaceHighlight({
			toolbar,
			activeItem: 0,
			hovered: undefined,
			editing: true,
			dragging,
		})
		expect([...flank.highlighted]).toEqual([2])
	})

	it('item spaces: ABCD with D dragged keeps the gap after D dark', () => {
		// Conformance anchor for the e2e `edge-stay` suite (future adapters
		// must satisfy the same rule): a DZ beside a dragged tool is never
		// highlighted — the trailing edge gap stays dark even on direct
		// hover, and the candidate moves out to the track gap after the
		// toolbar (see the track-spaces fallback below).
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		expect(toolbar).toHaveLength(4)
		const dragging: DraggingState = startDraggingState({
			tools: toolbar.slice(3, 4),
			origin: {
				kind: 'border',
				toolbar,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
		})
		const direct = itemSpaceHighlight({
			toolbar,
			activeItem: undefined,
			hovered: 4,
			editing: true,
			dragging,
		})
		expect([...direct.highlighted]).toEqual([])
		const flank = itemSpaceHighlight({
			toolbar,
			activeItem: 3,
			hovered: undefined,
			editing: true,
			dragging,
		})
		expect([...flank.highlighted]).toEqual([2])
	})

	it('track spaces: fallback paints when the item-space side runs dry', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const track = live.borders.top[0] ?? []
		const toolbar = track[0]?.toolbar ?? []
		// Drag the whole toolbar content: every item-space touches a dragged
		// tool, so both sides fall back to the flanking track gaps — except
		// the slide veto suppresses the flanks of the moved toolbar itself.
		// Use a two-toolbar track so the fallback has a paintable neighbour.
		const dragging: DraggingState = startDraggingState({
			tools: [...toolbar],
			origin: { kind: 'border', toolbar, track, border: live.borders.top },
		})
		const vetoedSlide = trackSpaceHighlight({
			track,
			toolbar,
			slotIndex: 0,
			activeSlot: 0,
			hovered: undefined,
			editing: true,
			dragging,
		})
		expect([...vetoedSlide.highlighted]).toEqual([])
		// Restructure drag of the whole content from another track: both
		// sides run dry, both flanking track gaps paint (no slide veto —
		// the origin track differs from the target track).
		const other = live.borders.top[1] ?? []
		const otherToolbar = other[0]?.toolbar ?? []
		const cross: DraggingState = startDraggingState({
			tools: [...otherToolbar],
			origin: { kind: 'border', toolbar: otherToolbar, track: other, border: live.borders.top },
		})
		const fallback = trackSpaceHighlight({
			track,
			toolbar: otherToolbar,
			slotIndex: 0,
			activeSlot: 0,
			hovered: undefined,
			editing: true,
			dragging: cross,
		})
		expect([...fallback.highlighted]).toEqual([0, 1])
		// Partial drag of the edge tool: the before side runs dry (gap 0
		// touches the dragged tool), so the left track gap paints; the
		// after side still has free gap 2.
		const partial: DraggingState = startDraggingState({
			tools: toolbar.slice(0, 1),
			origin: { kind: 'border', toolbar, track, border: live.borders.top },
		})
		const half = trackSpaceHighlight({
			track,
			toolbar,
			slotIndex: 0,
			activeSlot: 0,
			hovered: undefined,
			editing: true,
			dragging: partial,
		})
		// Hovering item 0 (the dragged tool): the before side runs dry, so
		// the left track gap paints; the after side still has free gap 2.
		expect([...half.highlighted]).toEqual([0])
		// ABCD with D dragged: the after side runs dry (gap 4 touches the
		// dragged tool), so the track gap after the toolbar paints — the
		// e2e `edge-stay` conformance anchor at core level.
		const abcd = new PaletteLayoutTree(fourItemLayout())
		const abcdLive = abcd.getLayout()
		const abcdTrack = abcdLive.borders.top[0] ?? []
		const abcdToolbar = abcdTrack[0]?.toolbar ?? []
		const abcdDragging: DraggingState = startDraggingState({
			tools: abcdToolbar.slice(3, 4),
			origin: {
				kind: 'border',
				toolbar: abcdToolbar,
				track: abcdTrack,
				border: abcdLive.borders.top,
			},
		})
		const abcdFallback = trackSpaceHighlight({
			track: abcdTrack,
			toolbar: abcdToolbar,
			slotIndex: 0,
			activeSlot: 3,
			hovered: undefined,
			editing: true,
			dragging: abcdDragging,
		})
		expect([...abcdFallback.highlighted]).toEqual([1])
		// Sliding veto: the flanks of the moved toolbar never paint.
		const vetoed = trackSpaceHighlight({
			track,
			toolbar,
			slotIndex: 0,
			activeSlot: undefined,
			hovered: 0,
			editing: true,
			dragging,
		})
		expect([...vetoed.highlighted]).toEqual([])
	})

	it('whole-toolbar drag paints neighbour TB edges, not track gaps', () => {
		// Conformance anchor for whole-TB drags: the dragged toolbar's own
		// flanks stay dark (sliding veto) and the candidates are the last
		// DZ of the previous TB + the first DZ of the next TB (same track).
		// Built live: serialized borders hydrate flat (one track per slot),
		// so a multi-TB track is assembled here via a subset extract (a
		// whole-TB slide onto its own flanking gap is vetoed by design).
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const first = live.borders.top[0]?.[0]?.toolbar ?? []
		const track = live.borders.top[0] ?? []
		const subset: DraggingState = startDraggingState({
			tools: first.slice(0, 1),
			origin: { kind: 'border', toolbar: first, track, border: live.borders.top },
		})
		expect(commitDraggedToTrackSpace(subset, track, live.borders.top, 1)).toMatchObject({
			moved: true,
		})
		expect(track).toHaveLength(2)
		// The extract leaves [bcd] + [a]: drag the whole second toolbar.
		const middle = track[1]?.toolbar ?? []
		expect(middle).toHaveLength(1)
		const dragging = startDraggingState({
			tools: [...middle],
			origin: { kind: 'border', toolbar: middle, track, border: live.borders.top },
		})
		expect(dragging.isWholeToolbar).toBe(true)
		expect(dragging.mode).toBe('slide')
		const edges = wholeToolbarNeighbourEdges({
			track,
			slotIndex: 1,
			dragging,
			editing: true,
		})
		// Previous TB holds 3 tools → last DZ is gap 3; no next TB.
		expect(edges.map((edge) => edge.gap)).toEqual([3])
		expect(edges[0]?.toolbar).toBe(track[0]?.toolbar)
		// Own-track flanks vetoed even on direct hover.
		const flank = trackSpaceHighlight({
			track,
			toolbar: middle,
			slotIndex: 1,
			activeSlot: undefined,
			hovered: 1,
			editing: true,
			dragging,
		})
		expect([...flank.highlighted]).toEqual([])
		// Subset drags get no neighbour edges (a singleton has no subset).
		const other = track[0]?.toolbar ?? []
		const partial = startDraggingState({
			tools: other.slice(0, 1),
			origin: { kind: 'border', toolbar: other, track, border: live.borders.top },
		})
		expect(partial.isWholeToolbar).toBe(false)
		expect(
			wholeToolbarNeighbourEdges({ track, slotIndex: 0, dragging: partial, editing: true })
		).toEqual([])
	})

	it('startDraggingState derives the whole-toolbar flag at drag-start', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const whole = startDraggingState({
			tools: [...toolbar],
			origin: {
				kind: 'border',
				toolbar,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
		})
		expect(whole.isWholeToolbar).toBe(true)
		expect(whole.mode).toBe('slide')
		const partial = startDraggingState({
			tools: toolbar.slice(0, 1),
			origin: {
				kind: 'border',
				toolbar,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
		})
		expect(partial.isWholeToolbar).toBe(false)
		expect(partial.mode).toBe('restructure')
	})
})

describe('movement commits (explicit dragging state)', () => {
	it('commitDraggedToItemSpace merges and follows the origin', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const source = live.borders.top[0]?.[0]?.toolbar ?? []
		const target = live.borders.top[1]?.[0]?.toolbar ?? []
		const dragging: DraggingState = startDraggingState({
			tools: source.slice(0, 1),
			origin: {
				kind: 'border',
				toolbar: source,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
		})
		expect(
			commitDraggedToItemSpace(dragging, target, live.borders.top[1] ?? [], live.borders.top, 1)
		).toMatchObject({ moved: true })
		expect(target.map((item) => (item as { tool?: unknown }).tool)).toEqual(['c', 'a'])
		expect(dragging.origin.kind).toBe('border')
		expect(dragging.mode).toBe('restructure')
	})

	it('commitDraggedToItemSpace forward move lands between, not after', () => {
		// ABCD with B dragged onto gap 3 (between C and D): the prune
		// removes B first, so gap 3 shifts back to 2 — B lands between C
		// and D (ACBD), not after D. Backward moves need no shift.
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const track = live.borders.top[0] ?? []
		const forward: DraggingState = startDraggingState({
			tools: toolbar.slice(1, 2),
			origin: { kind: 'border', toolbar, track, border: live.borders.top },
		})
		expect(commitDraggedToItemSpace(forward, toolbar, track, live.borders.top, 3)).toMatchObject({
			moved: true,
		})
		expect(toolbar.map((item) => (item as { tool?: unknown }).tool)).toEqual(['a', 'c', 'b', 'd'])
		const back = new PaletteLayoutTree(fourItemLayout())
		const backLive = back.getLayout()
		const backToolbar = backLive.borders.top[0]?.[0]?.toolbar ?? []
		const backTrack = backLive.borders.top[0] ?? []
		const backward: DraggingState = startDraggingState({
			tools: backToolbar.slice(2, 3),
			origin: {
				kind: 'border',
				toolbar: backToolbar,
				track: backTrack,
				border: backLive.borders.top,
			},
		})
		expect(
			commitDraggedToItemSpace(backward, backToolbar, backTrack, backLive.borders.top, 1)
		).toMatchObject({ moved: true })
		expect(backToolbar.map((item) => (item as { tool?: unknown }).tool)).toEqual([
			'a',
			'c',
			'b',
			'd',
		])
	})

	it('commitDraggedToTrackSpace slide relocates identity, flanking gaps veto', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[1]?.[0]?.toolbar ?? []
		const track = live.borders.top[1] ?? []
		const dragging: DraggingState = startDraggingState({
			tools: [...toolbar],
			origin: { kind: 'border', toolbar, track, border: live.borders.top },
		})
		expect(commitDraggedToTrackSpace(dragging, track, live.borders.top, 0)).toMatchObject({
			moved: false,
		})
		expect(
			commitDraggedToTrackSpace(dragging, live.borders.top[0] ?? [], live.borders.top, 2)
		).toMatchObject({ moved: true })
		expect(live.borders.top[0]).toHaveLength(2)
		expect(dragging.origin.kind).toBe('border')
		expect(dragging.mode).toBe('slide')
	})

	it('commitDraggedToTrackSpace restructure extracts a singleton and promotes to slide', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const source = live.borders.top[0]?.[0]?.toolbar ?? []
		const dragging: DraggingState = startDraggingState({
			tools: source.slice(0, 1),
			origin: {
				kind: 'border',
				toolbar: source,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
		})
		expect(
			commitDraggedToTrackSpace(dragging, live.borders.top[1] ?? [], live.borders.top, 1)
		).toMatchObject({ moved: true })
		expect(dragging.mode).toBe('slide')
		if (dragging.origin.kind !== 'border') throw new Error('expected border origin')
		expect(dragging.origin.toolbar).toHaveLength(1)
	})

	it('commitDraggedToStackSpace vetoes the emptied neighbours, else creates a track', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const sole = live.borders.top[1]?.[0]?.toolbar ?? []
		const track = live.borders.top[1] ?? []
		const dragging: DraggingState = startDraggingState({
			tools: [...sole],
			origin: { kind: 'border', toolbar: sole, track, border: live.borders.top },
		})
		expect(commitDraggedToStackSpace(dragging, live.borders.top, 1)).toMatchObject({
			moved: false,
		})
		expect(commitDraggedToStackSpace(dragging, live.borders.top, 0)).toMatchObject({
			moved: true,
		})
		expect(live.borders.top).toHaveLength(2)
	})

	it('commitDraggedToParkingRow vetoes the emptied neighbours, else creates a row', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const sole = live.parking[0] ?? []
		const dragging: DraggingState = startDraggingState({
			tools: [...sole],
			origin: { kind: 'parking', toolbar: sole, parking: live.parking, index: 0 },
		})
		expect(commitDraggedToParkingRow(dragging, live.parking, 0)).toMatchObject({ moved: false })
		const border = borderDrag(0, 1)
		const borderLive = border.origin.kind === 'border' ? border.origin.border : live.borders.top
		expect(commitDraggedToParkingRow(border, live.parking, 1)).toMatchObject({ moved: true })
		expect(borderLive).toBeDefined()
		expect(live.parking).toHaveLength(2)
	})

	it('commitDraggedToParking merges into an existing row and follows the origin', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const source = live.borders.top[0]?.[0]?.toolbar ?? []
		const target = live.parking[0] ?? []
		const dragging: DraggingState = startDraggingState({
			tools: source.slice(0, 1),
			origin: {
				kind: 'border',
				toolbar: source,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
		})
		expect(commitDraggedToParking(dragging, target, live.parking, 0, 1)).toMatchObject({
			moved: true,
		})
		expect(target.map((item) => (item as { tool?: unknown }).tool)).toEqual(['p', 'a'])
		expect(dragging.origin.kind).toBe('parking')
	})

	it('moveToolbarToTrack / moveToolbarToStack wrap the track primitives', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[1]?.[0]?.toolbar ?? []
		const track = live.borders.top[1] ?? []
		const dragging: DraggingState = startDraggingState({
			tools: [...toolbar],
			origin: { kind: 'border', toolbar, track, border: live.borders.top },
		})
		expect(
			moveToolbarToTrack(dragging, live.borders.top[0] ?? [], live.borders.top, 2)
		).toMatchObject({
			moved: true,
		})
		expect(moveToolbarToStack(dragging, live.borders.top, 0)).toMatchObject({ moved: true })
	})
})

describe('core drag engine (dragStart / dragOver)', () => {
	it('dragStart resolves the origin from the grabbed tool', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const dragging = dragStart(live, { kind: 'tool', toolbar, item })
		expect(dragging.tools).toEqual([item])
		expect(dragging.origin).toMatchObject({ kind: 'border', toolbar })
		expect(dragging.isWholeToolbar).toBe(false)
	})

	it('dragStart of a singleton toolbar marks the whole-toolbar flag', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[1]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const dragging = dragStart(live, { kind: 'tool', toolbar, item })
		expect(dragging.isWholeToolbar).toBe(true)
		expect(dragging.mode).toBe('slide')
	})

	it('dragStart of a toolbar grabs the whole content', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const dragging = dragStart(live, { kind: 'toolbar', toolbar })
		expect(dragging.tools).toHaveLength(2)
		expect(dragging.isWholeToolbar).toBe(true)
	})

	it('dragOver a free item-gap paints + commits (reorder-forward lands between)', () => {
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const track = live.borders.top[0] ?? []
		const item = toolbar[1]
		if (!item) throw new Error('expected item')
		const dragging = dragStart(live, { kind: 'tool', toolbar, item })
		const decision = dragOver(
			dragging,
			live,
			{ kind: 'item-gap', toolbar, track, border: live.borders.top, gap: 3 },
			{},
			true
		)
		expect(decision.moved).toBe(true)
		expect(decision.itemHighlights).toEqual([{ toolbar, gaps: [3] }])
		expect(toolbar.map((entry) => (entry as { tool?: unknown }).tool)).toEqual(['a', 'c', 'b', 'd'])
	})

	it('dragOver a dark item-gap never moves tools', () => {
		const tree = new PaletteLayoutTree(fourItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const track = live.borders.top[0] ?? []
		const item = toolbar[3]
		if (!item) throw new Error('expected item')
		const dragging = dragStart(live, { kind: 'tool', toolbar, item })
		const decision = dragOver(
			dragging,
			live,
			{ kind: 'item-gap', toolbar, track, border: live.borders.top, gap: 4 },
			{},
			true
		)
		expect(decision.moved).toBe(false)
		expect(decision.itemHighlights).toEqual([])
		expect(toolbar).toHaveLength(4)
	})

	it('dragOver a tool paints the active-item fallback without committing', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const dragging = dragStart(live, { kind: 'tool', toolbar, item })
		const other = toolbar[1]
		if (!other) throw new Error('expected item')
		const decision = dragOver(
			dragging,
			live,
			{ kind: 'tool', toolbar, item: other },
			{ activeItem: 1 },
			true
		)
		expect(decision.moved).toBe(false)
		expect(decision.itemHighlights.length).toBeGreaterThan(0)
		expect(toolbar).toHaveLength(2)
	})

	it('dragOver a track-gap paints + extracts a singleton', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const dragging = dragStart(live, { kind: 'tool', toolbar, item })
		const track = live.borders.top[1] ?? []
		const decision = dragOver(
			dragging,
			live,
			{ kind: 'track-gap', track, border: live.borders.top, gap: 1 },
			{},
			true
		)
		expect(decision.moved).toBe(true)
		expect(decision.trackHighlights).toEqual([{ track, gaps: [1] }])
		expect(dragging.isWholeToolbar).toBe(true)
	})

	it('dragOver with editing off returns empty (hover stays dark)', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar ?? []
		const track = live.borders.top[0] ?? []
		const item = toolbar[0]
		if (!item) throw new Error('expected item')
		const dragging = dragStart(live, { kind: 'tool', toolbar, item })
		const decision = dragOver(
			dragging,
			live,
			{ kind: 'item-gap', toolbar, track, border: live.borders.top, gap: 1 },
			{},
			false
		)
		expect(decision.moved).toBe(false)
		expect(decision.itemHighlights).toEqual([])
		expect(toolbar).toHaveLength(2)
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
