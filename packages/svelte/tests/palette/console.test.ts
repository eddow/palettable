import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import Console from '$lib/head/Console.svelte'
import { headEditors } from '$lib/head/registry'
import { closeConsole, consoleState, openConsole } from '$lib/palette/console.svelte'
import { Palette } from '$lib/palette/palette.svelte'

function makePalette(editable = true) {
	return new Palette({
		tools: {
			foo: { type: 'boolean', label: 'Foo', value: false, default: false },
			bar: {
				label: 'Bar',
				get can() {
					return true
				},
				run() {},
			},
		},
		keys: {},
		editable,
		editors: headEditors as never,
		editorDefaults: { run: 'button', boolean: 'toggle' },
	})
}

const top = [[{ space: 0, toolbar: [{ tool: 'foo', editor: 'toggle' }] }]]

describe('console without commandBox (command-first)', () => {
	afterEach(() => {
		document.body.replaceChildren()
		closeConsole()
	})

	it('run mode shows toggle + run box only (no add/details/parking)', async () => {
		const palette = makePalette()
		openConsole('run')
		render(Console, { props: { palette: palette as never, top: top as never } })
		expect(screen.queryByTestId('console-mode-toggle')).toBeTruthy()
		expect(screen.getByTestId('console-input').getAttribute('placeholder')).toBe('Command…')
		expect(screen.queryByTestId('console-add-panel')).toBeNull()
		expect(screen.queryByTestId('console-details-panel')).toBeNull()
	})

	it('edit mode shows add box + details, add panel after selection', async () => {
		const palette = makePalette()
		openConsole('edit')
		render(Console, { props: { palette: palette as never, top: top as never } })
		expect(screen.queryByTestId('console-mode-toggle')).toBeTruthy()
		expect(screen.getByTestId('console-input').getAttribute('placeholder')).toBe('Add to toolbar…')
		// No selection yet: no add panel, details shows the empty hint.
		expect(screen.queryByTestId('console-add-panel')).toBeNull()
		expect(screen.queryByTestId('console-details-panel')).toBeTruthy()
		// Selecting an add entry shows the add variants.
		const first = screen
			.getByTestId('console-results')
			.querySelector('.palette-default-command-result') as HTMLElement
		first.click()
		await Promise.resolve()
		expect(screen.queryByTestId('console-add-panel')).toBeTruthy()
	})

	it('edit mode add-box results list addable tools (no command presets)', async () => {
		const palette = makePalette()
		openConsole('edit')
		render(Console, { props: { palette: palette as never, top: top as never } })
		const results = screen.getByTestId('console-results')
		const rows = results.querySelectorAll('.palette-default-command-result')
		expect(rows.length).toBeGreaterThan(0)
		for (const row of rows) {
			// Catalogue drag was stripped: rows are click-to-select, not draggable.
			expect(row.getAttribute('draggable')).toBeNull()
			expect(row.textContent).toMatch(
				/Add (boolean|number|enum|editor-only|.*) tool|Add editor-only item/
			)
		}
	})

	it('toggle flips between run and edit', async () => {
		const palette = makePalette()
		openConsole('run')
		render(Console, { props: { palette: palette as never, top: top as never } })
		const toggle = screen.getByTestId('console-mode-toggle') as HTMLButtonElement
		expect(consoleState.mode).toBe('run')
		expect(toggle.getAttribute('aria-pressed')).toBe('false')
		await fireEvent.click(toggle)
		expect(consoleState.mode).toBe('edit')
		expect(toggle.getAttribute('aria-pressed')).toBe('true')
		expect(screen.getByTestId('console-input').getAttribute('placeholder')).toBe('Add to toolbar…')
	})

	it('read-only palette (editable: false) shows no toggle and stays in run mode', async () => {
		const palette = makePalette(false)
		openConsole('edit')
		render(Console, { props: { palette: palette as never, top: top as never } })
		expect(screen.queryByTestId('console-mode-toggle')).toBeNull()
		expect(screen.getByTestId('console-input').getAttribute('placeholder')).toBe('Command…')
		expect(screen.queryByTestId('console-add-panel')).toBeNull()
		expect(screen.queryByTestId('console-details-panel')).toBeNull()
	})
})
