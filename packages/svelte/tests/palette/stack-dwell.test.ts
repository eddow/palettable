import { render } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configuration } from '$lib/palette/configuration'
import { Palette, palettes } from '$lib/palette/edition.svelte'
import type { PaletteConfig } from '$lib/palette/types'
import {
	reactiveBorder,
	reactiveItem,
	reactiveParking,
	reactiveToolbar,
	reactiveTrack,
} from './fixtures.svelte'
import ParkingEditorStub from './ParkingEditorStub.svelte'
import ParkingProbe from './ParkingProbe.svelte'
import StackBorderProbe from './StackBorderProbe.svelte'

function testPalette(): Palette {
	return new Palette({
		tools: {
			run: {
				get can() {
					return true
				},
				run() {},
			},
		},
		keys: { N: 'run' },
		editor: () => ParkingEditorStub as never,
	} satisfies PaletteConfig)
}

describe('stack-DZ hover timer', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
		palettes.dragging = undefined
		vi.useRealTimers()
	})

	function seedBorderDrag(palette: Palette) {
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(reactiveItem('keep'), dragged)
		const originTrack = reactiveTrack(originToolbar)
		const border = reactiveBorder(originTrack)
		palettes.editing = palette
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: originTrack, border },
			mode: 'restructure',
		}
		return { border, originToolbar, dragged }
	}

	function hoverStack(index: number): HTMLElement {
		const dz = document.querySelector<HTMLElement>(`[data-stack-index="${index}"]`)
		if (!dz) throw new Error(`missing stack DZ ${index}`)
		dz.dispatchEvent(
			new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 1 })
		)
		return dz
	}

	it('commits a new track after the dwell, exactly once while held', async () => {
		const palette = testPalette()
		const { border, originToolbar, dragged } = seedBorderDrag(palette)
		render(StackBorderProbe, { props: { palette, border } })

		hoverStack(1)
		await Promise.resolve()
		// Still armed, not yet committed.
		expect(border).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs)
		expect(border).toHaveLength(2)
		expect(border[1][0].toolbar).toContain(dragged)
		expect(originToolbar).toHaveLength(1)

		// Holding the pointer on the same DZ must not build another track.
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs * 3)
		expect(border).toHaveLength(2)
	})

	it('cancels when the pointer leaves the DZ before the dwell', async () => {
		const palette = testPalette()
		const { border } = seedBorderDrag(palette)
		const { container } = render(StackBorderProbe, { props: { palette, border } })

		hoverStack(1)
		await Promise.resolve()
		const root = container.querySelector<HTMLElement>('[data-region="top"]')
		root?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, cancelable: true }))
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs * 2)
		expect(border).toHaveLength(1)
	})

	it('cancels when the drag ends (mouse-up) before the dwell', async () => {
		const palette = testPalette()
		const { border } = seedBorderDrag(palette)
		render(StackBorderProbe, { props: { palette, border } })

		hoverStack(1)
		await Promise.resolve()
		palettes.dragging = undefined
		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs * 2)
		expect(border).toHaveLength(1)
	})

	it('retargets when the pointer moves to another DZ', async () => {
		const palette = testPalette()
		const { border, dragged } = seedBorderDrag(palette)
		render(StackBorderProbe, { props: { palette, border } })

		hoverStack(0)
		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs / 2)
		// Move to the other DZ: the first timer must not fire.
		hoverStack(1)
		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs / 2)
		expect(border).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs / 2)
		expect(border).toHaveLength(2)
		expect(border[1][0].toolbar).toContain(dragged)
	})

	it('never arms on track hover (flanking double-highlight)', async () => {
		const palette = testPalette()
		const { border } = seedBorderDrag(palette)
		render(StackBorderProbe, { props: { palette, border } })

		const trackEl = document.querySelector<HTMLElement>('[data-track-index="0"]')
		if (!trackEl) throw new Error('missing track element')
		trackEl.dispatchEvent(
			new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 1 })
		)
		await Promise.resolve()
		// Both flanking stacks highlight, but no timer arms.
		expect(
			document.querySelectorAll('.toolbar-stack-space.toolbar-drop-zone.highlighted').length
		).toBe(2)
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs * 2)
		expect(border).toHaveLength(1)
	})
})

describe('parking-gap hover timer', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
		palettes.dragging = undefined
		vi.useRealTimers()
	})

	beforeEach(() => {
		vi.useFakeTimers()
	})

	function seedParkingDrag(palette: Palette) {
		const dragged = reactiveItem('dragged')
		const originToolbar = reactiveToolbar(reactiveItem('keep'), dragged)
		const originTrack = reactiveTrack(originToolbar)
		const border = reactiveBorder(originTrack)
		const parking = reactiveParking()
		palettes.editing = palette
		palettes.dragging = {
			palette,
			tools: [dragged],
			origin: { kind: 'border', toolbar: originToolbar, track: originTrack, border },
			mode: 'restructure',
		}
		return { border, parking, originToolbar, dragged }
	}

	function hoverParkingGap(index: number): HTMLElement {
		const dz = document.querySelector<HTMLElement>(`[data-parking-gap-index="${index}"]`)
		if (!dz) throw new Error(`missing parking gap ${index}`)
		dz.dispatchEvent(
			new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 1 })
		)
		return dz
	}

	it('commits a new row after the dwell, exactly once while held', async () => {
		const palette = testPalette()
		const { parking, originToolbar, dragged } = seedParkingDrag(palette)
		render(ParkingProbe, { props: { palette, parking } })

		hoverParkingGap(0)
		await Promise.resolve()
		expect(parking).toHaveLength(0)
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs)
		expect(parking).toHaveLength(1)
		expect(parking[0]).toContain(dragged)
		expect(originToolbar).toHaveLength(1)

		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs * 3)
		expect(parking).toHaveLength(1)
	})

	it('cancels when the pointer leaves the gap before the dwell', async () => {
		const palette = testPalette()
		const { parking } = seedParkingDrag(palette)
		const { container } = render(ParkingProbe, { props: { palette, parking } })

		hoverParkingGap(0)
		await Promise.resolve()
		const root = container.querySelector<HTMLElement>('[data-container="parking"]')
		root?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, cancelable: true }))
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs * 2)
		expect(parking).toHaveLength(0)
	})

	it('cancels when the drag ends (mouse-up) before the dwell', async () => {
		const palette = testPalette()
		const { parking } = seedParkingDrag(palette)
		render(ParkingProbe, { props: { palette, parking } })

		hoverParkingGap(0)
		await Promise.resolve()
		palettes.dragging = undefined
		await Promise.resolve()
		await vi.advanceTimersByTimeAsync(configuration.stackDzHoverMs * 2)
		expect(parking).toHaveLength(0)
	})
})
