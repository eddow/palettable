import { afterEach, describe, expect, it } from 'vitest'
import {
	actualTrackSpaceAt,
	commitDraggedToItemSpace,
	commitDraggedToParking,
	commitDraggedToParkingRow,
	commitDraggedToStackSpace,
	commitDraggedToTrackSpace,
	draggingEmptiesParkingRow,
	draggingEmptiesTrackIndex,
	findOwnershipViolations,
	insertToolbar,
	insertTrackWithToolbar,
	isDraggedToolbarAt,
	isDraggingWholeToolbar,
	Palette,
	palettes,
	removeEmptyTrack,
	removeToolbar,
	resizeToolbar,
	resolveDragMode,
} from '$lib/palette/edition.svelte'
import type { PaletteBorder, PaletteToolbar, PaletteTrack } from '$lib/palette/types'
import {
	reactiveBorder,
	reactiveItem,
	reactiveParking,
	reactiveToolbar,
	reactiveTrack,
} from './fixtures.svelte'

function testPalette(): Palette {
	return new Palette({ tools: {}, keys: {} })
}

function countItems(borders: PaletteBorder[]): number {
	return borders.reduce(
		(sum, border) =>
			sum +
			border.reduce(
				(trackSum, track) => trackSum + track.reduce((s, slot) => s + slot.toolbar.length, 0),
				0
			),
		0
	)
}

describe('layout relocation invariants (headless primitives)', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
	})

	it('conserves items when a toolbar moves between tracks', () => {
		const a: PaletteToolbar = [{ tool: 'a' }, { tool: 'b' }]
		const b: PaletteToolbar = [{ tool: 'c' }]
		const trackA: PaletteTrack = [{ space: 0.2, toolbar: a }]
		const trackB: PaletteTrack = [{ space: 0.3, toolbar: b }]
		const border: PaletteBorder = [trackA, trackB]
		const before = countItems([border])

		// Relocation = remove from origin + insert at destination (the coupled
		// primitive `moveToolbarToTrack`/`moveToolbarToStack` build on).
		const removed = removeToolbar(trackA, a)
		expect(removed).toBe(0)
		removeEmptyTrack(border, trackA)
		insertToolbar(trackB, 1, a, 0.5)

		expect(countItems([border])).toBe(before)
		expect(border).toHaveLength(1)
		expect(trackB.map((slot) => slot.toolbar)).toContain(a)
	})

	it('conserves items when a toolbar moves to a new stack track', () => {
		const a: PaletteToolbar = [{ tool: 'a' }]
		const track: PaletteTrack = [{ space: 0, toolbar: a }]
		const border: PaletteBorder = [track]
		const before = countItems([border])

		removeToolbar(track, a)
		removeEmptyTrack(border, track)
		insertTrackWithToolbar(border, 0, a)

		expect(countItems([border])).toBe(before)
		expect(border).toHaveLength(1)
	})

	it('prunes empty toolbars/tracks without losing sibling items', () => {
		const keep: PaletteToolbar = [{ tool: 'keep' }]
		const doomed: PaletteToolbar = [{ tool: 'doomed' }]
		const track: PaletteTrack = [
			{ space: 0.4, toolbar: keep },
			{ space: 0, toolbar: doomed },
		]
		const border: PaletteBorder = [track]
		const before = countItems([border])

		removeToolbar(track, doomed)
		removeEmptyTrack(border, track)

		expect(countItems([border])).toBe(before - 1)
		expect(track).toHaveLength(1)
		expect(track[0].toolbar).toBe(keep)
		// The surviving track stays (it is not empty), so the border is intact.
		expect(border).toHaveLength(1)
	})

	it('drops an emptied track from its border', () => {
		const solo: PaletteToolbar = [{ tool: 'solo' }]
		const track: PaletteTrack = [{ space: 0, toolbar: solo }]
		const border: PaletteBorder = [track]
		removeToolbar(track, solo)
		removeEmptyTrack(border, track)
		expect(border).toHaveLength(0)
	})
})

describe('track-gap commit (mode model)', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
		palettes.dragging = undefined
	})

	/**
	 * Seed a drag session directly: a real `pointerdown` is not needed to
	 * exercise the commit, and the mode is exactly what is under test. The
	 * origin is the *reactive* toolbar/track object, so identity checks match
	 * what the engine sees.
	 */
	function seedDrag(options: {
		palette: Palette
		border: PaletteBorder
		originTrack: PaletteTrack
		originToolbar: PaletteToolbar
		tools: PaletteToolbar
		mode: 'restructure' | 'slide'
	}) {
		palettes.dragging = {
			palette: options.palette,
			tools: options.tools,
			origin: {
				kind: 'border',
				toolbar: options.originToolbar,
				track: options.originTrack,
				border: options.border,
			},
			mode: options.mode,
		}
	}

	function toolbarCount(border: PaletteBorder): number {
		return border.reduce((sum, track) => sum + track.length, 0)
	}

	it('promotes a tool set to its own toolbar exactly once per gap hover', () => {
		const palette = testPalette()
		// Every object the engine compares by identity must be reactive: a
		// plain object handed to the deep `$state` proxy on `palettes` comes
		// back as a *different* proxy, silently defeating `indexOf`/`includes`.
		const a = reactiveItem('a')
		const dragged = reactiveItem('dragged')
		const b = reactiveItem('b')
		const originToolbar = reactiveToolbar(a, dragged, b)
		const originTrack = reactiveTrack(originToolbar)
		const otherToolbar = reactiveToolbar(reactiveItem('x'))
		const otherTrack = reactiveTrack(otherToolbar)
		const border = reactiveBorder(originTrack, otherTrack)

		seedDrag({
			palette,
			border,
			originTrack,
			originToolbar,
			tools: [dragged],
			mode: 'restructure',
		})

		// First gap hover: extract into a fresh singleton, now a slide.
		expect(commitDraggedToTrackSpace(otherTrack, border, 0)).toBe(true)
		expect(palettes.dragging?.mode).toBe('slide')
		const afterFirst = toolbarCount(border)

		// Second hover at the SAME gap: the session now slides its own toolbar,
		// and that gap is one of the two flanking it, so the commit is a no-op.
		// No additional toolbar may appear — this is the regression the mode
		// model exists to prevent (two toolbars holding the same tool).
		expect(commitDraggedToTrackSpace(otherTrack, border, 0)).toBe(false)
		expect(toolbarCount(border)).toBe(afterFirst)

		// The dragged tool lives in exactly one toolbar, and the origin kept
		// its remaining tools.
		const holders = border.flatMap((track) =>
			track.filter((slot) => slot.toolbar.includes(dragged))
		)
		expect(holders).toHaveLength(1)
		expect(originToolbar).toHaveLength(2)
		expect(countItems([border])).toBe(4)
	})

	it('relocates the same toolbar object when a whole toolbar is committed', () => {
		const palette = testPalette()
		const moved = reactiveToolbar(reactiveItem('a'))
		const originTrack = reactiveTrack(moved)
		const target = reactiveToolbar(reactiveItem('b'))
		const targetTrack = reactiveTrack(target)
		const border = reactiveBorder(originTrack, targetTrack)

		seedDrag({
			palette,
			border,
			originTrack,
			originToolbar: moved,
			tools: [...moved],
			mode: 'slide',
		})

		expect(commitDraggedToTrackSpace(targetTrack, border, 0)).toBe(true)

		// Identity preserved: never cloned, and the emptied origin track went
		// away entirely.
		expect(palettes.dragging?.origin.toolbar).toBe(moved)
		expect(targetTrack.map((slot) => slot.toolbar)).toContain(moved)
		expect(border).toHaveLength(1)
		expect(toolbarCount(border)).toBe(2)
	})

	it('ignores the two gaps touching the moved toolbar', () => {
		const palette = testPalette()
		const moved = reactiveToolbar(reactiveItem('m'))
		const track = reactiveTrack(reactiveToolbar(reactiveItem('l')), moved)
		track[0].space = 0.25
		track[1].space = 0.25
		const border = reactiveBorder(track)

		seedDrag({
			palette,
			border,
			originTrack: track,
			originToolbar: moved,
			tools: [...moved],
			mode: 'slide',
		})

		const spacesBefore = track.map((slot) => slot.space)
		// Gaps 1 and 2 surround `moved` (slot 1) — both are no-ops.
		expect(commitDraggedToTrackSpace(track, border, 1)).toBe(false)
		expect(commitDraggedToTrackSpace(track, border, 2)).toBe(false)
		expect(track.map((slot) => slot.space)).toEqual(spacesBefore)
		expect(track).toHaveLength(2)
	})

	it('still extracts a tool set into the gap beside its own toolbar', () => {
		// A tool pulled out of a toolbar may be dropped into the gap directly
		// next to that toolbar. The flanking-gap no-op only applies while
		// *sliding* a whole toolbar — gating it on the gap alone made this
		// move silently do nothing.
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(reactiveItem('a'), dragged)
		const neighbour = reactiveToolbar(reactiveItem('n'))
		const track = reactiveTrack(originToolbar, neighbour)
		const border = reactiveBorder(track)

		seedDrag({
			palette,
			border,
			originTrack: track,
			originToolbar,
			tools: [dragged],
			mode: 'restructure',
		})

		// Gap 1 sits between the origin toolbar (slot 0) and its neighbour.
		expect(commitDraggedToTrackSpace(track, border, 1)).toBe(true)
		expect(palettes.dragging?.mode).toBe('slide')
		// One extra toolbar on the track; the origin kept its other tool.
		expect(track).toHaveLength(3)
		expect(originToolbar).toHaveLength(1)
		const holders = track.filter((slot) => slot.toolbar.includes(dragged))
		expect(holders).toHaveLength(1)
	})

	it('still extracts a tool set into the gap before its own toolbar', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(dragged, reactiveItem('a'))
		const neighbour = reactiveToolbar(reactiveItem('n'))
		const track = reactiveTrack(neighbour, originToolbar)
		const border = reactiveBorder(track)

		seedDrag({
			palette,
			border,
			originTrack: track,
			originToolbar,
			tools: [dragged],
			mode: 'restructure',
		})

		// Gap 1 is the leading gap of the origin toolbar (slot 1).
		expect(commitDraggedToTrackSpace(track, border, 1)).toBe(true)
		expect(track).toHaveLength(3)
		expect(originToolbar).toHaveLength(1)
	})

	it('keeps neighbours still when sliding a toolbar within its track', () => {
		const track = reactiveTrack(
			reactiveToolbar(reactiveItem('l')),
			reactiveToolbar(reactiveItem('m')),
			reactiveToolbar(reactiveItem('r'))
		)

		// A slide rebalances only the two gaps *flanking* the moved toolbar
		// (`space[1]` before it, `space[2]` after it). Their sum is invariant.
		// So the toolbar at position 0 keeps its gap unchanged, and the
		// toolbar at position 2 keeps the same combined span in front of it —
		// it can shift only as much as the slider does, never independently.
		const before = track.map((slot) => slot.space)
		const flankingSum = track[1].space + track[2].space

		resizeToolbar(track, 1, 0.75)

		expect(track[0].space).toBe(before[0])
		expect(track[1].space + track[2].space).toBeCloseTo(flankingSum, 10)
		// Total conserved: stored spaces plus the implicit trailing gap = 1.
		const total =
			track.reduce((sum, slot) => sum + slot.space, 0) + actualTrackSpaceAt(track, track.length)
		expect(total).toBeCloseTo(1, 10)
	})
})

describe('drag mode (derived and cached)', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
		palettes.dragging = undefined
	})

	it('is a restructure while other tools remain in the origin toolbar', () => {
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(reactiveItem('a'), dragged, reactiveItem('b'))
		palettes.dragging = {
			palette: testPalette(),
			tools: [dragged],
			origin: {
				kind: 'border',
				toolbar: originToolbar,
				track: reactiveTrack(),
				border: reactiveBorder(),
			},
			mode: 'restructure',
		}
		// "Anything else than `dragging` in my toolbar?" — yes.
		expect(palettes.dragging && resolveDragMode(palettes.dragging)).toBe('restructure')
	})

	it('is a slide when the dragged tools are the whole toolbar', () => {
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(dragged)
		palettes.dragging = {
			palette: testPalette(),
			tools: [dragged],
			origin: {
				kind: 'border',
				toolbar: originToolbar,
				track: reactiveTrack(),
				border: reactiveBorder(),
			},
			mode: 'slide',
		}
		// A lone tool in its toolbar IS that toolbar — slide from the start.
		expect(palettes.dragging && resolveDragMode(palettes.dragging)).toBe('slide')
	})

	it('becomes a slide once a restructure extracts its tools', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(reactiveItem('a'), dragged)
		const originTrack = reactiveTrack(originToolbar)
		const target = reactiveToolbar(reactiveItem('x'))
		const targetTrack = reactiveTrack(target)
		const border = reactiveBorder(originTrack, targetTrack)

		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: originTrack, border },
			mode: 'restructure',
		}

		commitDraggedToTrackSpace(targetTrack, border, 0)

		expect(palettes.dragging?.mode).toBe('slide')
		expect(palettes.dragging?.origin.toolbar).toContain(dragged)
	})

	it('goes back to a restructure when a merge absorbs the selection', () => {
		// This is the bug: sliding a toolbar into another toolbar cast it as
		// part of that toolbar, so the whole toolbar is no longer selected and
		// sliding must stop — only restructure stays available.
		const palette = testPalette()
		const moved = reactiveItem('moved')
		const sliding = reactiveToolbar(moved)
		const slidingTrack = reactiveTrack(sliding)
		const host = reactiveToolbar(reactiveItem('host'))
		const hostTrack = reactiveTrack(host)
		const border = reactiveBorder(slidingTrack, hostTrack)

		palettes.dragging = {
			palette,
			tools: [moved],
			origin: { kind: 'border', toolbar: sliding, track: slidingTrack, border },
			mode: 'slide',
		}

		// Merge into the host toolbar at item space 1.
		expect(commitDraggedToItemSpace(host, hostTrack, border, 1)).toBe(true)

		// The host now holds the selection *plus* its own tool, so the whole
		// toolbar is no longer what is being dragged.
		expect(palettes.dragging?.mode).toBe('restructure')
		expect(host).toHaveLength(2)
	})

	it('stays a slide when a merge leaves the selection alone in a toolbar', () => {
		// Merging an empty-ish selection into a toolbar that is *itself* the
		// selection (same object) must not flip the mode to restructure.
		const palette = testPalette()
		const first = reactiveItem('a')
		const second = reactiveItem('b')
		const toolbar = reactiveToolbar(first, second)
		const track = reactiveTrack(toolbar)
		const border = reactiveBorder(track)

		palettes.dragging = {
			palette,
			tools: [first, second],
			origin: { kind: 'border', toolbar, track, border },
			mode: 'slide',
		}

		expect(palettes.dragging && resolveDragMode(palettes.dragging)).toBe('slide')
	})
})

describe('container-scoped drag identity (parking vs border)', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
		palettes.dragging = undefined
	})

	it('a border drag never matches a parking toolbar holding the same object', () => {
		const palette = testPalette()
		const shared = reactiveItem('shared')
		const borderToolbar = reactiveToolbar(shared, reactiveItem('other'))
		const borderTrack = reactiveTrack(borderToolbar)
		const border = reactiveBorder(borderTrack)
		// Same object rendered in parking (the old mirror bug): the drag
		// originated in the border, so only the border toolbar matches.
		const parking = reactiveParking(borderToolbar)
		palettes.dragging = {
			palette,
			tools: [shared],
			origin: { kind: 'border', toolbar: borderToolbar, track: borderTrack, border },
			mode: 'restructure',
		}
		expect(isDraggingWholeToolbar(parking[0])).toBe(false)
		expect(
			isDraggedToolbarAt(borderToolbar, {
				kind: 'border',
				toolbar: borderToolbar,
				track: borderTrack,
				border,
			})
		).toBe(true)
		expect(
			isDraggedToolbarAt(borderToolbar, {
				kind: 'parking',
				toolbar: borderToolbar,
				parking,
				index: 0,
			})
		).toBe(false)
	})

	it('a parking drag never matches its mirror in a border', () => {
		const palette = testPalette()
		const row = reactiveToolbar(reactiveItem('p'))
		const parking = reactiveParking(row)
		const borderToolbar = reactiveToolbar(reactiveItem('b'))
		const borderTrack = reactiveTrack(borderToolbar)
		const border = reactiveBorder(borderTrack)
		palettes.dragging = {
			palette,
			tools: [...row],
			origin: { kind: 'parking', toolbar: row, parking, index: 0 },
			mode: 'slide',
		}
		expect(isDraggingWholeToolbar(borderToolbar)).toBe(false)
		expect(isDraggedToolbarAt(row, { kind: 'parking', toolbar: row, parking, index: 0 })).toBe(true)
		expect(
			isDraggedToolbarAt(row, { kind: 'border', toolbar: row, track: borderTrack, border })
		).toBe(false)
		// Parking drags have no tracks: the border emptied-track guard stays inert.
		expect(draggingEmptiesTrackIndex(border)).toBe(undefined)
	})

	it('moves a tool from a border into a parking row (ownership transfer)', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(reactiveItem('keep'), dragged)
		const originTrack = reactiveTrack(originToolbar)
		const border = reactiveBorder(originTrack)
		const parked = reactiveToolbar(reactiveItem('parked'))
		const parking = reactiveParking(parked)
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: originTrack, border },
			mode: 'restructure',
		}
		expect(commitDraggedToParking(parked, parking, 0, 1)).toBe(true)
		expect(originToolbar).toHaveLength(1)
		expect(parked).toContain(dragged)
		expect(palettes.dragging?.origin.kind).toBe('parking')
		expect(
			findOwnershipViolations({
				borders: { top: border, right: [], bottom: [], left: [] },
				parking,
			})
		).toEqual([])
	})
})

describe('parking row commits (dwell drop)', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
		palettes.dragging = undefined
	})

	it('creates a fresh row from a border subset drag', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(reactiveItem('keep'), dragged)
		const originTrack = reactiveTrack(originToolbar)
		const border = reactiveBorder(originTrack)
		const parking = reactiveParking()
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: originTrack, border },
			mode: 'restructure',
		}
		expect(commitDraggedToParkingRow(parking, 0)).toBe(true)
		expect(parking).toHaveLength(1)
		expect(parking[0]).toContain(dragged)
		expect(originToolbar).toHaveLength(1)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'parking', index: 0 })
		expect(palettes.dragging?.mode).toBe('slide')
		expect(
			findOwnershipViolations({
				borders: { top: border, right: [], bottom: [], left: [] },
				parking,
			})
		).toEqual([])
	})

	it('relocates a whole border toolbar as a row (identity preserved)', () => {
		const palette = testPalette()
		const originToolbar = reactiveToolbar(reactiveItem('a'), reactiveItem('b'))
		const originTrack = reactiveTrack(originToolbar)
		const border = reactiveBorder(originTrack)
		const parking = reactiveParking()
		palettes.dragging = {
			palette,
			tools: [...originToolbar],
			origin: { kind: 'border', toolbar: originToolbar, track: originTrack, border },
			mode: 'slide',
		}
		expect(commitDraggedToParkingRow(parking, 0)).toBe(true)
		expect(parking).toHaveLength(1)
		expect(parking[0]).toBe(originToolbar)
		expect(border).toHaveLength(0)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'parking', index: 0 })
	})

	it('reorders a parked row within its own stack', () => {
		const palette = testPalette()
		const first = reactiveToolbar(reactiveItem('first'))
		const second = reactiveToolbar(reactiveItem('second'))
		const parking = reactiveParking(first, second)
		palettes.dragging = {
			palette,
			tools: [...first],
			origin: { kind: 'parking', toolbar: first, parking, index: 0 },
			mode: 'slide',
		}
		expect(commitDraggedToParkingRow(parking, 2)).toBe(true)
		expect(parking).toHaveLength(2)
		expect(parking[0]).toBe(second)
		expect(parking[1]).toBe(first)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'parking', index: 1 })
	})

	it('refuses the gaps touching the row the drag would empty', () => {
		const palette = testPalette()
		const row = reactiveToolbar(reactiveItem('solo'))
		const parking = reactiveParking(row)
		palettes.dragging = {
			palette,
			tools: [...row],
			origin: { kind: 'parking', toolbar: row, parking, index: 0 },
			mode: 'slide',
		}
		expect(commitDraggedToParkingRow(parking, 0)).toBe(false)
		expect(commitDraggedToParkingRow(parking, 1)).toBe(false)
		expect(parking).toHaveLength(1)
		expect(parking[0]).toBe(row)
	})

	it('extracts a parking subset into a fresh row', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originRow = reactiveToolbar(reactiveItem('keep'), dragged)
		const parking = reactiveParking(originRow)
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'parking', toolbar: originRow, parking, index: 0 },
			mode: 'restructure',
		}
		expect(commitDraggedToParkingRow(parking, 1)).toBe(true)
		expect(parking).toHaveLength(2)
		expect(originRow).toHaveLength(1)
		expect(parking[1]).toContain(dragged)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'parking', index: 1 })
	})

	it('reports the row a parking drag would empty', () => {
		const palette = testPalette()
		const row = reactiveToolbar(reactiveItem('solo'))
		const parking = reactiveParking(row)
		palettes.dragging = {
			palette,
			tools: [...row],
			origin: { kind: 'parking', toolbar: row, parking, index: 0 },
			mode: 'slide',
		}
		expect(draggingEmptiesParkingRow(parking)).toBe(0)
	})

	it('reports no emptied row for partial or multi-row parking drags', () => {
		const palette = testPalette()
		const row = reactiveToolbar(reactiveItem('keep'), reactiveItem('dragged'))
		const other = reactiveToolbar(reactiveItem('other'))
		const parking = reactiveParking(row, other)
		palettes.dragging = {
			palette,
			tools: [row[1]],
			origin: { kind: 'parking', toolbar: row, parking, index: 0 },
			mode: 'restructure',
		}
		expect(draggingEmptiesParkingRow(parking)).toBe(undefined)
	})
})

describe('parking → border commits (cross-container symmetry)', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
		palettes.dragging = undefined
	})

	it('merges a parked tool into a border toolbar (origin becomes border)', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originRow = reactiveToolbar(reactiveItem('keep'), dragged)
		const parking = reactiveParking(originRow)
		const host = reactiveToolbar(reactiveItem('host'))
		const hostTrack = reactiveTrack(host)
		const border = reactiveBorder(hostTrack)
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'parking', toolbar: originRow, parking, index: 0 },
			mode: 'restructure',
		}
		expect(commitDraggedToItemSpace(host, hostTrack, border, 1)).toBe(true)
		expect(host).toContain(dragged)
		expect(originRow).toHaveLength(1)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'border' })
		expect(
			findOwnershipViolations({
				borders: { top: border, right: [], bottom: [], left: [] },
				parking,
			})
		).toEqual([])
	})

	it('slides a whole parked row into a track gap (identity preserved)', () => {
		const palette = testPalette()
		const row = reactiveToolbar(reactiveItem('a'), reactiveItem('b'))
		const parking = reactiveParking(row)
		const host = reactiveToolbar(reactiveItem('host'))
		const hostTrack = reactiveTrack(host)
		const border = reactiveBorder(hostTrack)
		palettes.dragging = {
			palette,
			tools: [...row],
			origin: { kind: 'parking', toolbar: row, parking, index: 0 },
			mode: 'slide',
		}
		expect(commitDraggedToTrackSpace(hostTrack, border, 1)).toBe(true)
		expect(parking).toHaveLength(0)
		expect(hostTrack).toHaveLength(2)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'border' })
		expect(
			findOwnershipViolations({
				borders: { top: border, right: [], bottom: [], left: [] },
				parking,
			})
		).toEqual([])
	})

	it('extracts a parked subset into a fresh border toolbar', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originRow = reactiveToolbar(reactiveItem('keep'), dragged)
		const parking = reactiveParking(originRow)
		const host = reactiveToolbar(reactiveItem('host'))
		const hostTrack = reactiveTrack(host)
		const border = reactiveBorder(hostTrack)
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'parking', toolbar: originRow, parking, index: 0 },
			mode: 'restructure',
		}
		expect(commitDraggedToTrackSpace(hostTrack, border, 0)).toBe(true)
		expect(originRow).toHaveLength(1)
		expect(hostTrack).toHaveLength(2)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'border' })
		expect(palettes.dragging?.mode).toBe('slide')
	})
})

describe('stack-gap commits (hover-dwell drop)', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
		palettes.dragging = undefined
	})

	it('extracts a subset into a new track at the stack (origin pruned when emptied)', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(reactiveItem('keep'), dragged)
		const originTrack = reactiveTrack(originToolbar)
		const border = reactiveBorder(originTrack)
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: originTrack, border },
			mode: 'restructure',
		}
		expect(commitDraggedToStackSpace(border, 1)).toBe(true)
		expect(border).toHaveLength(2)
		expect(border[1]).toHaveLength(1)
		expect(border[1][0].toolbar).toContain(dragged)
		// Origin kept its remaining tool; the session became a slide and
		// follows the placed toolbar (proxy read-back, not the raw ref).
		expect(originToolbar).toHaveLength(1)
		expect(palettes.dragging?.mode).toBe('slide')
		expect(palettes.dragging?.origin.toolbar).toBe(border[1][0].toolbar)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'border', border })
		expect(
			findOwnershipViolations({
				borders: { top: border, right: [], bottom: [], left: [] },
			})
		).toEqual([])
	})

	it('removes the origin track when a lone tool leaves it', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(dragged)
		const originTrack = reactiveTrack(originToolbar)
		const other = reactiveToolbar(reactiveItem('other'))
		const otherTrack = reactiveTrack(other)
		const border = reactiveBorder(originTrack, otherTrack)
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: originTrack, border },
			mode: 'restructure',
		}
		// Stack 2 is past the surviving track — the emptied origin track
		// (index 0) vanishes, so the new track lands at index 1.
		expect(commitDraggedToStackSpace(border, 2)).toBe(true)
		expect(border).toHaveLength(2)
		expect(border[1][0].toolbar).toContain(dragged)
		expect(border[0]).toBe(otherTrack)
	})

	it('relocates a whole toolbar into a new track (identity preserved)', () => {
		const palette = testPalette()
		const moved = reactiveToolbar(reactiveItem('a'), reactiveItem('b'))
		const originTrack = reactiveTrack(moved)
		const border = reactiveBorder(originTrack, reactiveTrack(reactiveToolbar(reactiveItem('x'))))
		palettes.dragging = {
			palette,
			tools: [...moved],
			origin: { kind: 'border', toolbar: moved, track: originTrack, border },
			mode: 'slide',
		}
		expect(commitDraggedToStackSpace(border, 2)).toBe(true)
		expect(palettes.dragging?.origin.toolbar).toBe(moved)
		expect(border).toHaveLength(2)
		expect(border[1][0].toolbar).toBe(moved)
		expect(palettes.dragging?.mode).toBe('slide')
	})

	it('moves a toolbar across borders (west to north)', () => {
		const palette = testPalette()
		const moved = reactiveToolbar(reactiveItem('a'))
		const westTrack = reactiveTrack(moved)
		const west = reactiveBorder(westTrack)
		const northTrack = reactiveTrack(reactiveToolbar(reactiveItem('n')))
		const north = reactiveBorder(northTrack)
		palettes.dragging = {
			palette,
			tools: [...moved],
			origin: { kind: 'border', toolbar: moved, track: westTrack, border: west },
			mode: 'slide',
		}
		expect(commitDraggedToStackSpace(north, 1)).toBe(true)
		expect(west).toHaveLength(0)
		expect(north).toHaveLength(2)
		expect(north[1][0].toolbar).toBe(moved)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'border', border: north })
	})

	it('refuses the stacks touching the track the drag would empty', () => {
		const palette = testPalette()
		const moved = reactiveToolbar(reactiveItem('solo'))
		const originTrack = reactiveTrack(moved)
		const border = reactiveBorder(originTrack, reactiveTrack(reactiveToolbar(reactiveItem('x'))))
		palettes.dragging = {
			palette,
			tools: [...moved],
			origin: { kind: 'border', toolbar: moved, track: originTrack, border },
			mode: 'slide',
		}
		expect(commitDraggedToStackSpace(border, 0)).toBe(false)
		expect(commitDraggedToStackSpace(border, 1)).toBe(false)
		expect(border).toHaveLength(2)
		expect(border[0]).toBe(originTrack)
	})

	it('slides a parked row into a new track (cross-container symmetry)', () => {
		const palette = testPalette()
		const row = reactiveToolbar(reactiveItem('a'), reactiveItem('b'))
		const parking = reactiveParking(row)
		const border = reactiveBorder(reactiveTrack(reactiveToolbar(reactiveItem('host'))))
		palettes.dragging = {
			palette,
			tools: [...row],
			origin: { kind: 'parking', toolbar: row, parking, index: 0 },
			mode: 'slide',
		}
		expect(commitDraggedToStackSpace(border, 1)).toBe(true)
		expect(parking).toHaveLength(0)
		expect(border).toHaveLength(2)
		expect(border[1][0].toolbar).toBe(row)
		expect(palettes.dragging?.origin).toMatchObject({ kind: 'border', border })
		expect(
			findOwnershipViolations({
				borders: { top: border, right: [], bottom: [], left: [] },
				parking,
			})
		).toEqual([])
	})

	it('extracts a parked subset into a new track (origin row kept when not emptied)', () => {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originRow = reactiveToolbar(reactiveItem('keep'), dragged)
		const parking = reactiveParking(originRow)
		const border = reactiveBorder(reactiveTrack(reactiveToolbar(reactiveItem('host'))))
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'parking', toolbar: originRow, parking, index: 0 },
			mode: 'restructure',
		}
		expect(commitDraggedToStackSpace(border, 0)).toBe(true)
		expect(originRow).toHaveLength(1)
		expect(parking).toHaveLength(1)
		expect(border).toHaveLength(2)
		expect(border[0][0].toolbar).toContain(dragged)
		expect(palettes.dragging?.mode).toBe('slide')
	})

	it('rejects idle sessions', () => {
		const border = reactiveBorder(reactiveTrack(reactiveToolbar(reactiveItem('b'))))
		palettes.dragging = undefined
		expect(commitDraggedToStackSpace(border, 1)).toBe(false)
		expect(border).toHaveLength(1)
	})
})
