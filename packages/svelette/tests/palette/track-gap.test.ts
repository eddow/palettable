import { render } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { activeToolbarSlideElement, Palette, palettes } from '$lib/palette/edition.svelte'
import type { PaletteBorder } from '$lib/palette/types'
import { reactiveBorder, reactiveItem, reactiveToolbar, reactiveTrack } from './fixtures.svelte'
import IdeProbe from './IdeProbe.svelte'

function testPalette(): Palette {
	return new Palette({ tools: {}, keys: {} })
}

/**
 * Track-gap drop zones, driven through the real DOM.
 *
 * The gap commit is a *hover* commit: the pointer handler on `.toolbar-track`
 * reads `[data-track-space-index]` and commits immediately. The regression
 * this file pins is that a second `pointermove` over the same physical gap —
 * which is what the browser delivers while the pointer sits still, and what
 * happens before Svelte has flushed the freshly inserted toolbar — must not
 * build a second toolbar holding the same tools.
 */
describe('track-gap drop zones', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
		palettes.dragging = undefined
	})

	function setup() {
		const palette = testPalette()
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(reactiveItem('a'), dragged, reactiveItem('b'))
		const originTrack = reactiveTrack(originToolbar)
		const otherToolbar = reactiveToolbar(reactiveItem('x'))
		const otherTrack = reactiveTrack(otherToolbar)
		const border: PaletteBorder = reactiveBorder(originTrack, otherTrack)
		palettes.editing = palette
		render(IdeProbe, { props: { palette, top: border } })
		return { palette, border, dragged, originToolbar, otherTrack }
	}

	function toolbarCount(border: PaletteBorder): number {
		return border.reduce((sum, track) => sum + track.length, 0)
	}

	/**
	 * Give the track's gaps and toolbars a fake pixel layout.
	 *
	 * jsdom has no layout engine, so every `getBoundingClientRect()` is zero and
	 * `toolbarSlideBounds` bails out (`available > 0` fails). Without this the
	 * slide can never arm and any assertion about it is vacuous.
	 *
	 * Layout per track, in 100px cells: gap `j` spans `[j, j+1]` cells, toolbar
	 * `i` sits inside cell `i` (`left = i*100 + 30`, width 60) — so its leading
	 * gap is 30px and the free span is 140px.
	 */
	function stubTrackLayout(): void {
		const rect = (left: number, right: number): DOMRect =>
			({
				left,
				right,
				top: 0,
				bottom: 50,
				width: right - left,
				height: 50,
				x: left,
				y: 0,
				toJSON: () => ({}),
			}) as DOMRect
		for (const track of document.querySelectorAll('.toolbar-track')) {
			track.querySelectorAll('[data-track-space-index]').forEach((gapEl, j) => {
				;(gapEl as HTMLElement).getBoundingClientRect = () => rect(j * 100, (j + 1) * 100)
			})
			track.querySelectorAll('[data-toolbar-slot-index] .toolbar').forEach((toolbarEl, i) => {
				;(toolbarEl as HTMLElement).getBoundingClientRect = () => rect(i * 100 + 30, i * 100 + 90)
			})
		}
	}

	/** Dispatch a `pointermove` on the gap element at `index` of a track. */
	function hoverGap(trackIndex: number, index: number): void {
		const track = document.querySelectorAll('.toolbar-track')[trackIndex]
		const gap = track?.querySelector(`[data-track-space-index="${index}"]`)
		if (!(gap instanceof HTMLElement)) throw new Error(`no gap ${index} in track ${trackIndex}`)
		gap.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				clientX: 10,
				clientY: 10,
			})
		)
	}

	/** Dispatch a `pointermove` on the toolbar at `index` of a track. */
	function hoverToolbar(trackIndex: number, index: number): void {
		const track = document.querySelectorAll('.toolbar-track')[trackIndex]
		const toolbar = track?.querySelector(`[data-toolbar-slot-index="${index}"] .toolbar`)
		if (!(toolbar instanceof HTMLElement)) throw new Error(`no toolbar ${index}`)
		toolbar.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				clientX: 10,
				clientY: 10,
			})
		)
	}

	it('creates exactly one toolbar when the same gap is hovered twice', async () => {
		const { palette, border, dragged, originToolbar, otherTrack } = setup()

		// Seed the session as a tool-set drag out of the 3-tool origin toolbar.
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: border[0], border },
			mode: 'restructure',
		}

		const before = toolbarCount(border)

		// The real pointer sequence: hover the gap (commit), then drift over
		// the toolbar that just appeared under the cursor, then back onto the
		// same gap. The toolbar hover must NOT clear the gap memo, and the
		// repeat gap hover must be absorbed — otherwise a second toolbar is
		// built holding the same tool.
		hoverGap(1, 0)
		expect(toolbarCount(border)).toBe(before + 1)
		expect(palettes.dragging?.mode).toBe('slide')

		hoverToolbar(1, 0)
		hoverGap(1, 0)

		expect(toolbarCount(border)).toBe(before + 1)

		// The dragged tool is in exactly one toolbar; the origin kept the rest.
		const holders = border.flatMap((track) =>
			track.filter((slot) => slot.toolbar.includes(dragged))
		)
		expect(holders).toHaveLength(1)
		expect(originToolbar).toHaveLength(2)
		expect(otherTrack).toBeTruthy()
	})

	it('treats the gap after the new toolbar as inert, not as a second insert', async () => {
		const { palette, border, dragged, originToolbar } = setup()
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: border[0], border },
			mode: 'restructure',
		}

		const before = toolbarCount(border)

		// Commit into gap 0, then hover gap 1 — the gap immediately *after*
		// the toolbar that was just created. That gap flanks the moved
		// toolbar, so it must be inert. It is also the case that used to
		// duplicate: the engine could not find the moved toolbar by identity,
		// so it "relocated" it by inserting a second copy.
		hoverGap(1, 0)
		expect(toolbarCount(border)).toBe(before + 1)

		hoverGap(1, 1)
		expect(toolbarCount(border)).toBe(before + 1)

		const holders = border.flatMap((track) =>
			track.filter((slot) => slot.toolbar.includes(dragged))
		)
		expect(holders).toHaveLength(1)
	})

	it('does not commit when the pointer is inside a toolbar', async () => {
		const { palette, border, dragged, originToolbar } = setup()
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: border[0], border },
			mode: 'restructure',
		}

		const before = toolbarCount(border)
		const toolbarEl = document.querySelectorAll('.toolbar')[1]
		expect(toolbarEl).toBeTruthy()
		toolbarEl?.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				clientX: 10,
				clientY: 10,
			})
		)

		// Hovering a toolbar is the item-space DZ's business, not the track's.
		expect(toolbarCount(border)).toBe(before)
		expect(palettes.dragging?.mode).toBe('restructure')
	})

	it('disarms slide-follow when a merge casts the toolbar into another', async () => {
		const { palette, border, dragged, originToolbar } = setup()

		// Seed as a *slide*: the selection is the whole origin toolbar. A whole
		// toolbar grab always carries a grab offset, so `recenter` is not used
		// and the anchor is the toolbar's own resting spot.
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: border[0], border },
			mode: 'slide',
			grabOffset: 5,
		}
		stubTrackLayout()

		// A move inside the origin track arms slide-follow over the toolbar.
		await tick()
		hoverToolbar(0, 0)
		expect(activeToolbarSlideElement()).toBeDefined()

		// Now merge into the *other* toolbar by hovering one of its item
		// spaces. The selection becomes a subset, so the toolbar is no longer
		// the thing being moved: sliding must stop.
		const otherToolbarEl = document.querySelectorAll('.toolbar')[1]
		const spaces = otherToolbarEl?.querySelectorAll('[data-item-space-index]')
		expect(spaces && spaces.length > 1).toBe(true)
		spaces?.[1]?.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				cancelable: true,
				pointerId: 1,
				clientX: 10,
				clientY: 10,
			})
		)

		expect(palettes.dragging?.mode).toBe('restructure')
		await tick()
		expect(activeToolbarSlideElement()).toBeUndefined()
	})
})
