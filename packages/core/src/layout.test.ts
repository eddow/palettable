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
	validateSerializedLayout,
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

function borderDrag(toolbarIndex = 0, toolCount = 1): DraggingState {
	const tree = new PaletteLayoutTree(twoItemLayout())
	const live = tree.getLayout()
	const toolbar = live.borders.top[0]?.[toolbarIndex]?.toolbar ?? []
	const track = live.borders.top[0] ?? []
	const border = live.borders.top
	const tools = toolbar.slice(0, toolCount)
	return {
		tools: tools.length > 0 ? tools : toolbar.slice(0, 1),
		origin: { kind: 'border', toolbar, track, border },
		mode: 'restructure',
	}
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
		const dragging: DraggingState = {
			tools: [...sole],
			origin: { kind: 'border', toolbar: sole, track, border: live.borders.top },
			mode: 'slide',
		}
		expect(draggingEmptiesTrackIndex(dragging, live.borders.top)).toBe(1)
		const partial = borderDrag(0, 1)
		expect(draggingEmptiesTrackIndex(partial, live.borders.top)).toBe(undefined)
		expect(draggingEmptiesTrackIndex(undefined, live.borders.top)).toBe(undefined)
	})

	it('draggingEmptiesParkingRow finds the sole-row whole-dragged stack', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const sole = live.parking[0] ?? []
		const dragging: DraggingState = {
			tools: [...sole],
			origin: { kind: 'parking', toolbar: sole, parking: live.parking, index: 0 },
			mode: 'slide',
		}
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
		const dragging: DraggingState = {
			tools: [...sole],
			origin: { kind: 'border', toolbar: sole, track, border: live.borders.top },
			mode: 'slide',
		}
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
		const parkingDrag: DraggingState = {
			tools: [...sole],
			origin: { kind: 'parking', toolbar: sole, parking: live.parking, index: 0 },
			mode: 'slide',
		}
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
		const dragging: DraggingState = {
			tools: toolbar.slice(0, 1),
			origin: {
				kind: 'border',
				toolbar,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
			mode: 'restructure',
		}
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
})

describe('movement commits (explicit dragging state)', () => {
	it('commitDraggedToItemSpace merges and follows the origin', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const source = live.borders.top[0]?.[0]?.toolbar ?? []
		const target = live.borders.top[1]?.[0]?.toolbar ?? []
		const dragging: DraggingState = {
			tools: source.slice(0, 1),
			origin: {
				kind: 'border',
				toolbar: source,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
			mode: 'restructure',
		}
		expect(
			commitDraggedToItemSpace(dragging, target, live.borders.top[1] ?? [], live.borders.top, 1)
		).toBe(true)
		expect(target.map((item) => (item as { tool?: unknown }).tool)).toEqual(['c', 'a'])
		expect(dragging.origin.kind).toBe('border')
		expect(dragging.mode).toBe('restructure')
	})

	it('commitDraggedToTrackSpace slide relocates identity, flanking gaps veto', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[1]?.[0]?.toolbar ?? []
		const track = live.borders.top[1] ?? []
		const dragging: DraggingState = {
			tools: [...toolbar],
			origin: { kind: 'border', toolbar, track, border: live.borders.top },
			mode: 'slide',
		}
		expect(commitDraggedToTrackSpace(dragging, track, live.borders.top, 0)).toBe(false)
		expect(
			commitDraggedToTrackSpace(dragging, live.borders.top[0] ?? [], live.borders.top, 2)
		).toBe(true)
		expect(live.borders.top[0]).toHaveLength(2)
		expect(dragging.origin.kind).toBe('border')
		expect(dragging.mode).toBe('slide')
	})

	it('commitDraggedToTrackSpace restructure extracts a singleton and promotes to slide', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const source = live.borders.top[0]?.[0]?.toolbar ?? []
		const dragging: DraggingState = {
			tools: source.slice(0, 1),
			origin: {
				kind: 'border',
				toolbar: source,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
			mode: 'restructure',
		}
		expect(
			commitDraggedToTrackSpace(dragging, live.borders.top[1] ?? [], live.borders.top, 1)
		).toBe(true)
		expect(dragging.mode).toBe('slide')
		if (dragging.origin.kind !== 'border') throw new Error('expected border origin')
		expect(dragging.origin.toolbar).toHaveLength(1)
	})

	it('commitDraggedToStackSpace vetoes the emptied neighbours, else creates a track', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const sole = live.borders.top[1]?.[0]?.toolbar ?? []
		const track = live.borders.top[1] ?? []
		const dragging: DraggingState = {
			tools: [...sole],
			origin: { kind: 'border', toolbar: sole, track, border: live.borders.top },
			mode: 'slide',
		}
		expect(commitDraggedToStackSpace(dragging, live.borders.top, 1)).toBe(false)
		expect(commitDraggedToStackSpace(dragging, live.borders.top, 0)).toBe(true)
		expect(live.borders.top).toHaveLength(2)
	})

	it('commitDraggedToParkingRow vetoes the emptied neighbours, else creates a row', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const sole = live.parking[0] ?? []
		const dragging: DraggingState = {
			tools: [...sole],
			origin: { kind: 'parking', toolbar: sole, parking: live.parking, index: 0 },
			mode: 'slide',
		}
		expect(commitDraggedToParkingRow(dragging, live.parking, 0)).toBe(false)
		const border = borderDrag(0, 1)
		const borderLive = border.origin.kind === 'border' ? border.origin.border : live.borders.top
		expect(commitDraggedToParkingRow(border, live.parking, 1)).toBe(true)
		expect(borderLive).toBeDefined()
		expect(live.parking).toHaveLength(2)
	})

	it('commitDraggedToParking merges into an existing row and follows the origin', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const source = live.borders.top[0]?.[0]?.toolbar ?? []
		const target = live.parking[0] ?? []
		const dragging: DraggingState = {
			tools: source.slice(0, 1),
			origin: {
				kind: 'border',
				toolbar: source,
				track: live.borders.top[0] ?? [],
				border: live.borders.top,
			},
			mode: 'restructure',
		}
		expect(commitDraggedToParking(dragging, target, live.parking, 0, 1)).toBe(true)
		expect(target.map((item) => (item as { tool?: unknown }).tool)).toEqual(['p', 'a'])
		expect(dragging.origin.kind).toBe('parking')
	})

	it('moveToolbarToTrack / moveToolbarToStack wrap the track primitives', () => {
		const tree = new PaletteLayoutTree(twoItemLayout())
		const live = tree.getLayout()
		const toolbar = live.borders.top[1]?.[0]?.toolbar ?? []
		const track = live.borders.top[1] ?? []
		const dragging: DraggingState = {
			tools: [...toolbar],
			origin: { kind: 'border', toolbar, track, border: live.borders.top },
			mode: 'slide',
		}
		expect(moveToolbarToTrack(dragging, live.borders.top[0] ?? [], live.borders.top, 2)).toBe(true)
		expect(moveToolbarToStack(dragging, live.borders.top, 0)).toBe(true)
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
