import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import DemoSliderEditor from '$demo/editors/DemoSlider.svelte'
import StarsEditor from '$demo/editors/StarsEditor.svelte'
import CommandBoxEditor from '$lib/head/editors/CommandBoxEditor.svelte'
import SegmentedEditor from '$lib/head/editors/SegmentedEditor.svelte'
import SelectEditor from '$lib/head/editors/SelectEditor.svelte'
import StepperEditor from '$lib/head/editors/StepperEditor.svelte'
import ToggleEditor from '$lib/head/editors/ToggleEditor.svelte'
import { BaseConfigurator } from '$lib/head/registry'
import type {
	PaletteBorder,
	PaletteEditorContext,
	PaletteSchema,
	PaletteToolBool,
	PaletteToolbarItem,
	PaletteToolEnum,
	PaletteToolNumber,
	PaletteTrack,
} from '$lib/palette/core.svelte'
import { closeConsole, configuratorPresenter, consoleState } from '$lib/palette/core.svelte'
import { Palette, removePaletteItem } from '$lib/palette/edition.svelte'

describe('head editors', () => {
	afterEach(() => {
		document.body.replaceChildren()
	})

	it('ToggleEditor toggles a boolean tool and renders its configured icon', async () => {
		const tool: PaletteToolBool = { type: 'boolean', value: false, default: false, label: 'Mute' }
		const item: PaletteToolbarItem = { tool: 'mute', editor: 'toggle', config: { icon: '🔔' } }
		const context = {
			item,
			tool,
			scope: {},
			flags: {},
			surface: { axis: 'horizontal' as const },
		} as PaletteEditorContext<PaletteToolBool, PaletteToolbarItem, PaletteSchema>

		render(ToggleEditor, { props: { context } })
		const button = screen.getByRole('button')
		expect(button).toHaveTextContent('🔔')
		await fireEvent.click(button)
		expect(tool.value).toBe(true)
	})

	it('SelectEditor reflects and changes an enum value', async () => {
		const tool: PaletteToolEnum = {
			type: 'enum',
			value: 'dark',
			default: 'dark',
			label: 'Theme',
			values: [
				{ value: 'light', label: 'Light' },
				{ value: 'dark', label: 'Dark' },
			],
		}
		const item: PaletteToolbarItem = { tool: 'theme', editor: 'select' }
		const context = {
			item,
			tool,
			scope: {},
			flags: {},
			surface: { axis: 'horizontal' as const },
		} as PaletteEditorContext<PaletteToolEnum, PaletteToolbarItem, PaletteSchema>

		render(SelectEditor, { props: { context } })
		const select = screen.getByRole('combobox') as HTMLSelectElement
		expect(select.value).toBe('dark')
		await fireEvent.change(select, { target: { value: 'light' } })
		expect(tool.value).toBe('light')
	})

	it('SegmentedEditor selects an enum value and marks the selected button', async () => {
		const tool: PaletteToolEnum = {
			type: 'enum',
			value: 'dark',
			default: 'dark',
			label: 'Theme',
			values: [
				{ value: 'light', label: 'Light' },
				{ value: 'dark', label: 'Dark' },
			],
		}
		const item: PaletteToolbarItem = { tool: 'theme', editor: 'segmented' }
		const context = {
			item,
			tool,
			scope: {},
			flags: {},
			surface: { axis: 'horizontal' as const },
		} as PaletteEditorContext<PaletteToolEnum, PaletteToolbarItem, PaletteSchema>

		const { container } = render(SegmentedEditor, { props: { context } })
		const buttons = Array.from(container.querySelectorAll('button'))
		expect(buttons).toHaveLength(2)
		// The selected value renders as the pushed-in button.
		const selected = buttons.find((button) => button.classList.contains('is-selected'))
		expect(selected).toHaveTextContent('Dark')

		const light = buttons.find((button) => button.textContent?.includes('Light'))
		await fireEvent.click(light as HTMLElement)
		expect(tool.value).toBe('light')
	})

	it('StepperEditor increments and decrements within bounds via the presenter', async () => {
		const tool: PaletteToolNumber = {
			type: 'number',
			value: 2,
			default: 2,
			label: 'Speed',
			min: 1,
			max: 5,
			step: 1,
		}
		const item: PaletteToolbarItem = { tool: 'gameSpeed', editor: 'stepper' }
		const context = {
			item,
			tool,
			scope: {},
			flags: {},
			surface: { axis: 'horizontal' as const },
		} as PaletteEditorContext<PaletteToolNumber, PaletteToolbarItem, PaletteSchema>

		const { container } = render(StepperEditor, { props: { context } })
		const [dec, inc] = Array.from(container.querySelectorAll('button'))
		await fireEvent.click(inc as HTMLElement)
		expect(tool.value).toBe(3)
		await fireEvent.click(dec as HTMLElement)
		expect(tool.value).toBe(2)
	})

	it('BaseConfigurator renders editor choices injected through the scope', () => {
		const item: PaletteToolbarItem = {
			tool: 'theme',
			editor: 'select',
			config: { label: 'Theme' },
		}
		const context = {
			item,
			tool: undefined,
			scope: {
				editorChoices: [
					{ id: 'flip', label: 'Flip', selected: false },
					{ id: 'select', label: 'Select', selected: true },
				],
			},
			flags: {},
		} as PaletteEditorContext

		const { container } = render(BaseConfigurator, { props: { context } })
		expect(screen.getByDisplayValue('Theme')).toBeTruthy()

		// First `<select>` is the editor-variant chooser (second is tone).
		const editorSelect = container.querySelector('select') as HTMLSelectElement
		expect(editorSelect.value).toBe('select')
		expect(Array.from(editorSelect.options).map((option) => option.value)).toEqual([
			'flip',
			'select',
		])
	})

	it('CommandBoxEditor renders an open-editor button that opens the console in edit mode', async () => {
		const palette = new Palette({
			tools: {
				foo: {
					label: 'Foo',
					get can() {
						return true
					},
					run() {},
				},
			},
			keys: {},
			editable: true,
			editors: { item: { commandBox: {} } } as never,
			editorDefaults: { run: 'button' },
		})
		const item: PaletteToolbarItem = { editor: 'commandBox' }
		const context = {
			item,
			tool: undefined,
			scope: { palette: palette as never },
			flags: {},
			surface: { axis: 'horizontal' as const },
		} as PaletteEditorContext<undefined, PaletteToolbarItem, PaletteSchema>

		render(CommandBoxEditor, { props: { context } })
		const button = screen.getByTestId('command-box-open-editor')
		expect(button).toBeTruthy()
		// Not a toggle/check-button: no aria-pressed.
		expect(button.getAttribute('aria-pressed')).toBeNull()
		expect(consoleState.open).toBe(false)
		await fireEvent.click(button)
		expect(consoleState.open).toBe(true)
		expect(consoleState.mode).toBe('edit')
		closeConsole()
	})

	describe('G2 headless removal', () => {
		it('removePaletteItem splices the item and keeps siblings', () => {
			const keep = { tool: 'keep' }
			const doomed = { tool: 'doomed' }
			const toolbar = [keep, doomed]
			const track: PaletteTrack = [{ space: 0, toolbar }]
			const border: PaletteBorder = [track]
			expect(removePaletteItem(doomed, toolbar, track, border)).toBe(true)
			expect(toolbar).toEqual([keep])
			expect(border).toHaveLength(1)
		})

		it('removePaletteItem prunes the emptied toolbar and track', () => {
			const solo = { tool: 'solo' }
			const toolbar = [solo]
			const track: PaletteTrack = [{ space: 0, toolbar }]
			const border: PaletteBorder = [track]
			expect(removePaletteItem(solo, toolbar, track, border)).toBe(true)
			expect(toolbar).toHaveLength(0)
			expect(border).toHaveLength(0)
		})

		it('removePaletteItem returns false for an unknown item', () => {
			const toolbar = [{ tool: 'a' }]
			const track: PaletteTrack = [{ space: 0, toolbar }]
			const border: PaletteBorder = [track]
			expect(removePaletteItem({ tool: 'ghost' }, toolbar, track, border)).toBe(false)
			expect(toolbar).toHaveLength(1)
			expect(border).toHaveLength(1)
		})

		it('configuratorPresenter.remove() deletes via the live location', () => {
			const first = { tool: 'a' }
			const second = { tool: 'b' }
			const toolbar = [first, second]
			const track: PaletteTrack = [{ space: 0, toolbar }]
			const border: PaletteBorder = [track]
			const context = {
				item: first,
				tool: undefined,
				scope: { toolbar, track, border },
				flags: {},
			} as PaletteEditorContext
			const view = configuratorPresenter(context)
			expect(view.removable).toBe(true)
			expect(view.remove()).toBe(true)
			expect(toolbar).toEqual([second])
		})

		it('configuratorPresenter.remove() no-ops without a location', () => {
			const context = {
				item: { tool: 'a' },
				tool: undefined,
				scope: {},
				flags: {},
			} as PaletteEditorContext
			expect(configuratorPresenter(context).remove()).toBe(false)
		})

		it('BaseConfigurator delete button removes the item from its toolbar', async () => {
			const first: PaletteToolbarItem = { tool: 'a', editor: 'toggle' }
			const second: PaletteToolbarItem = { tool: 'b', editor: 'toggle' }
			const toolbar = [first, second]
			const track: PaletteTrack = [{ space: 0, toolbar }]
			const border: PaletteBorder = [track]
			const context = {
				item: first,
				tool: undefined,
				scope: { toolbar, track, border },
				flags: {},
			} as unknown as PaletteEditorContext
			render(BaseConfigurator, { props: { context } })
			await fireEvent.click(screen.getByTestId('configurator-delete'))
			expect(toolbar).toEqual([second])
			expect(border).toHaveLength(1)
		})
	})

	it('Demo SliderEditor overrides the head slider and mutates via the presenter', async () => {
		const tool: PaletteToolNumber = {
			type: 'number',
			value: 14,
			default: 14,
			label: 'Font Size',
			min: 10,
			max: 20,
			step: 1,
		}
		const item: PaletteToolbarItem = {
			tool: 'fontSize',
			editor: 'slider',
			config: { icon: 'A', label: 'Font size' },
		}
		const context = {
			item,
			tool,
			scope: {},
			flags: {},
			surface: { axis: 'horizontal' as const },
		} as PaletteEditorContext<PaletteToolNumber, PaletteToolbarItem, PaletteSchema>

		const { container } = render(DemoSliderEditor, { props: { context } })
		// The override carries a distinct badged value element (the head slider
		// has none), proving the demo component is the one rendered.
		const badge = container.querySelector('.palette-default-slider-badge')
		expect(badge).toBeTruthy()
		expect(badge).toHaveTextContent('14')

		// Mutation routes through `sliderPresenter.set` (no `tool.value = …` in
		// the component), so the tool updates even though the badge DOM text
		// needs a reactive `$state` tool to re-render (out of scope here).
		const input = container.querySelector('input[type="range"]') as HTMLInputElement
		await fireEvent.input(input, { target: { value: '16' } })
		expect(tool.value).toBe(16)
	})

	it('Demo StarsEditor renders a rating row and sets a discrete value', async () => {
		const tool: PaletteToolNumber = {
			type: 'number',
			value: 2,
			default: 2,
			label: 'Speed',
			min: 1,
			max: 5,
			step: 1,
		}
		const item: PaletteToolbarItem = { tool: 'gameSpeed', editor: 'stars' }
		const context = {
			item,
			tool,
			scope: {},
			flags: {},
			surface: { axis: 'horizontal' as const },
		} as PaletteEditorContext<PaletteToolNumber, PaletteToolbarItem, PaletteSchema>

		const { container } = render(StarsEditor, { props: { context } })
		const buttons = Array.from(container.querySelectorAll('button[role="radio"]'))
		expect(buttons).toHaveLength(5)
		// The first `value` buttons render the filled "▶" glyph.
		const filled = buttons.filter((button) => button.textContent === '▶')
		expect(filled).toHaveLength(2)

		await fireEvent.click(buttons[4] as HTMLElement)
		expect(tool.value).toBe(5)
	})
})
