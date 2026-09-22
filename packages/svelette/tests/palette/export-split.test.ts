import { describe, expect, it } from 'vitest'
import * as core from '$lib/palette/core.svelte'
import * as edition from '$lib/palette/edition.svelte'

describe('core/edition export split', () => {
	it('core exposes the read-only surface only', () => {
		// Read-only essentials are present.
		for (const name of [
			'Palette',
			'paletteTool',
			'createPaletteKeys',
			'paletteRoot',
			'paletteCommandBoxModel',
			'paletteCommandEntries',
			'buttonPresenter',
			'commandBoxPresenter',
			'serializePaletteLayout',
			'validatePaletteLayout',
			// Console run-mode: a read-only palette can still open a command
			// console (run commands), so the run-only surface lives in core.
			'consoleState',
			'consoleTool',
			'openConsole',
			'closeConsole',
			'toggleConsole',
		]) {
			expect(core, `core should export ${name}`).toHaveProperty(name)
		}
		// Mutation surface is absent from core.
		for (const name of [
			'palettes',
			'isEditing',
			'paletteItemDrag',
			'insertToolbar',
			'removeToolbar',
			'paletteAddItemEntries',
			'paletteCatalogEntries',
			'popupAddList',
			'resetConsoleAddState',
			'createPaletteDrawerEditor',
			'renderPaletteConfigurator',
			'resolveItemPlacementTarget',
		]) {
			expect(core, `core must NOT export ${name}`).not.toHaveProperty(name)
		}
	})

	it('edition re-exports core plus the mutation surface', () => {
		for (const name of Object.keys(core)) {
			expect(edition, `edition should re-export core's ${name}`).toHaveProperty(name)
		}
		for (const name of [
			'palettes',
			'isEditing',
			'paletteItemDrag',
			'insertToolbar',
			'consoleState',
			'consoleTool',
			'createPaletteDrawerEditor',
			'renderPaletteConfigurator',
		]) {
			expect(edition, `edition should export ${name}`).toHaveProperty(name)
		}
	})
})
