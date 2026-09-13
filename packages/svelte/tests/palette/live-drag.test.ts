import { render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Palette, palettes } from '$lib/palette/edition.svelte'
import PaletteItemDragProbe from './PaletteItemDragProbe.svelte'
import ParkingEditorStub from './ParkingEditorStub.svelte'

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
	})
}

// Movement was stripped: item guards only inspect on pointerdown (no detach,
// no preview, no session). This locks the inspect-only contract in place.
describe('item inspect (no movement yet)', () => {
	afterEach(() => {
		document.body.replaceChildren()
		palettes.editing = undefined
		palettes.inspecting = undefined
	})

	it('pointerdown inspects without touching the toolbar', async () => {
		const firstItem = { tool: 'run' }
		const secondItem = { tool: 'run' }
		const toolbar = [firstItem, secondItem]
		const track = [{ space: 0, toolbar }]
		const border = [track]
		const palette = testPalette()
		palettes.editing = palette
		render(PaletteItemDragProbe, {
			props: {
				target: {
					kind: 'border',
					border,
					direction: 'horizontal',
					item: firstItem,
					palette,
					region: 'top',
					toolbar,
					track,
					trackIndex: 0,
				},
			},
		})
		const guard = screen.getByTestId('item-guard')
		Object.defineProperties(guard, {
			setPointerCapture: { configurable: true, value: vi.fn() },
			releasePointerCapture: { configurable: true, value: vi.fn() },
			hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
		})
		guard.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				button: 0,
				buttons: 1,
				pointerId: 1,
			})
		)
		expect(toolbar).toHaveLength(2)
		expect(palettes.inspecting?.palette).toBe(palette)
		expect(palettes.inspecting?.item).toStrictEqual(firstItem)
	})
})
