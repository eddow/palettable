import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import DrawerEditor from '$lib/palette/components/DrawerEditor.svelte'
import DrawerPopup from '$lib/palette/components/DrawerPopup.svelte'
import {
	createPaletteDrawerEditor,
	paletteDefaultDrawerEditor,
	paletteDrawerCollapse,
} from '$lib/palette/edition.svelte'
import { Palette } from '$lib/palette/palette.svelte'
import type { PaletteEditorContext, PaletteSchema, PaletteToolbarItem } from '$lib/palette/types'

function drawerPalette(): Palette {
	return new Palette({
		tools: {
			reset: {
				label: 'Reset',
				get can() {
					return true
				},
				run() {},
			},
		},
		keys: { R: 'reset' },
		editors: {
			run: { button: { editor: (() => {}) as never } },
			item: { drawer: paletteDefaultDrawerEditor as never },
		} as never,
		editorDefaults: { run: 'button' },
	})
}

function drawerContext(
	palette: Palette,
	axis: 'horizontal' | 'vertical' = 'horizontal'
): PaletteEditorContext<undefined, PaletteToolbarItem, PaletteSchema> {
	return {
		item: {
			editor: 'drawer',
			toolbar: [{ tool: 'reset', editor: 'button' }],
			config: { icon: '🗂', label: 'More' },
		} as PaletteToolbarItem,
		tool: undefined,
		scope: { palette: palette as never, region: axis === 'vertical' ? 'left' : 'top' },
		flags: {},
		surface: { axis },
	} as PaletteEditorContext<undefined, PaletteToolbarItem, PaletteSchema>
}

describe('drawer editor', () => {
	afterEach(() => {
		document.body.replaceChildren()
		paletteDrawerCollapse.version = 0
	})

	it('factory returns a spec with the shared DrawerEditor and horizontal footprint', () => {
		const spec = createPaletteDrawerEditor()
		expect(spec.editor).toBe(paletteDefaultDrawerEditor.editor)
		expect(spec.flags).toEqual({ footprint: 'horizontal' })
	})

	it('opens a portal popup on trigger click and closes on Escape', async () => {
		const palette = drawerPalette()
		render(DrawerEditor, { props: { context: drawerContext(palette) } })
		await fireEvent.click(screen.getByRole('button', { name: 'More' }))
		await Promise.resolve()
		expect(document.querySelector('.svelette-palette-drawer__popup')).toBeTruthy()
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
		await Promise.resolve()
		await Promise.resolve()
		expect(document.querySelector('.svelette-palette-drawer__popup')).toBeNull()
	})

	it('collapses open drawers when the shared signal bumps', async () => {
		const palette = drawerPalette()
		render(DrawerEditor, { props: { context: drawerContext(palette) } })
		await fireEvent.click(screen.getByRole('button', { name: 'More' }))
		await Promise.resolve()
		expect(document.querySelector('.svelette-palette-drawer__popup')).toBeTruthy()
		paletteDrawerCollapse.version += 1
		await Promise.resolve()
		await Promise.resolve()
		expect(document.querySelector('.svelette-palette-drawer__popup')).toBeNull()
	})

	it('inverts the parent axis for the child toolbar direction', async () => {
		const palette = drawerPalette()
		// Horizontal parent → vertical child popup.
		const { unmount } = render(DrawerEditor, {
			props: { context: drawerContext(palette, 'horizontal') },
		})
		await fireEvent.click(screen.getByRole('button', { name: 'More' }))
		expect(document.querySelector('.svelette-palette-drawer__popup.is-vertical')).toBeTruthy()
		unmount()
		document.body.replaceChildren()

		// Vertical parent → horizontal child popup (nested drawers continue the pattern).
		render(DrawerEditor, { props: { context: drawerContext(palette, 'vertical') } })
		await fireEvent.click(screen.getByRole('button', { name: 'More' }))
		expect(document.querySelector('.svelette-palette-drawer__popup.is-horizontal')).toBeTruthy()
	})

	it('popup publishes palette + child region scope to the child toolbar', () => {
		const palette = drawerPalette()
		const host = document.createElement('div')
		document.body.appendChild(host)
		const { unmount } = render(DrawerPopup, {
			props: {
				palette: palette as never,
				toolbar: [{ tool: 'reset', editor: 'button' }],
				direction: 'vertical',
				region: 'left',
				pos: { left: 0, top: 0 },
				placement: 'center',
				onClose: () => {},
			},
			target: host,
		})
		expect(host.querySelector('.toolbar')).toBeTruthy()
		unmount()
	})

	it('hover mode stays open while the pointer travels to the popup', async () => {
		const palette = drawerPalette()
		const hoverContext = {
			...drawerContext(palette),
			item: {
				editor: 'drawer',
				toolbar: [{ tool: 'reset', editor: 'button' }],
				config: { icon: '🗂', label: 'More', open: 'hover' },
			} as PaletteToolbarItem,
		} as PaletteEditorContext<undefined, PaletteToolbarItem, PaletteSchema>
		render(DrawerEditor, { props: { context: hoverContext } })
		const trigger = screen.getByRole('button', { name: 'More' })
		await fireEvent.mouseEnter(trigger)
		await Promise.resolve()
		const popup = document.querySelector('.svelette-palette-drawer__popup')
		expect(popup).toBeTruthy()
		// Leaving the trigger schedules a close; entering the popup cancels it.
		await fireEvent.mouseLeave(trigger)
		await fireEvent.mouseEnter(popup!)
		await new Promise((resolve) => setTimeout(resolve, 180))
		expect(document.querySelector('.svelette-palette-drawer__popup')).toBeTruthy()
		// Leaving the popup for good closes after the grace period.
		await fireEvent.mouseLeave(popup!)
		await new Promise((resolve) => setTimeout(resolve, 180))
		expect(document.querySelector('.svelette-palette-drawer__popup')).toBeNull()
	})
})
