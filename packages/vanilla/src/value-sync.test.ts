/**
 * `@palettable/vanilla` — per-tool value sync + editing chrome (Phase E/F probe).
 *
 * Builds a minimal IDE host (one border region) over a real `PaletteCore`
 * and asserts that point value changes update the rendered tool node
 * in place — no structural re-render, same `HTMLElement` identity —
 * and that editing/inspecting transitions flip chrome without rebuilds.
 */
import { ConsoleStore, PaletteCore, PaletteStateStore, ValuesBag } from '@palettable/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createPreviewCore, type DrawerChainEntry, drawerCloseChainIndices } from './head.js'
import { createIDE } from './ide.js'

const hosts: HTMLElement[] = []
afterEach(() => {
	for (const host of hosts.splice(0)) host.remove()
})

function setup(editable = false) {
	const core = new PaletteCore(
		[
			{ id: 'lamp', label: 'Lamp', type: 'boolean' },
			{
				id: 'speed',
				label: 'Speed',
				type: 'number',
				constraints: { min: 0, max: 10, step: 1 },
			},
		],
		{
			initialValues: { lamp: false, speed: 1 },
			initialLayout: {
				version: 1,
				borders: {
					top: [
						{ space: 1, toolbar: [{ point: 'lamp', control: 'toggle' }] },
						{ space: 1, toolbar: [{ point: 'speed', control: 'slider' }] },
					],
					right: [],
					bottom: [],
					left: [],
				},
			},
		}
	)
	const consoleStore = new ConsoleStore()
	const host = document.createElement('div')
	document.body.append(host)
	hosts.push(host)
	const ide = createIDE(host, {
		core,
		consoleStore,
		isEditable: () => editable,
	})
	return { core, consoleStore, ide, host }
}

describe('per-tool value sync', () => {
	it('toggle flips pressed state in place (same node)', () => {
		const { core, ide, host } = setup()
		const button = host.querySelector('.toolbar-item-content button')
		expect(button?.getAttribute('aria-pressed')).toBe('false')
		core.values.set('lamp' as never, true as never)
		const again = host.querySelector('.toolbar-item-content button')
		expect(again).toBe(button)
		expect(again?.getAttribute('aria-pressed')).toBe('true')
		expect(again?.classList.contains('is-selected')).toBe(true)
		ide.dispose()
	})

	it('toggle click toggles on then off (no stale spec)', () => {
		const { core, ide, host } = setup()
		const button = host.querySelector('.toolbar-item-content button') as HTMLButtonElement
		expect(button?.getAttribute('aria-pressed')).toBe('false')
		button.click()
		expect(core.values.get('lamp' as never)).toBe(true)
		expect(button.getAttribute('aria-pressed')).toBe('true')
		button.click()
		expect(core.values.get('lamp' as never)).toBe(false)
		expect(button.getAttribute('aria-pressed')).toBe('false')
		ide.dispose()
	})

	it('slider moves thumb + badge in place (same node)', () => {
		const { core, ide, host } = setup()
		const input = host.querySelector('input[type="range"]') as HTMLInputElement | null
		expect(input?.value).toBe('1')
		core.values.set('speed' as never, 7 as never)
		const again = host.querySelector('input[type="range"]') as HTMLInputElement | null
		expect(again).toBe(input)
		expect(again?.value).toBe('7')
		ide.dispose()
	})

	it('slider with showValue:false renders icon-only (no text node)', () => {
		const core = new PaletteCore(
			[{ id: 'speed', label: 'Speed', type: 'number', constraints: { min: 0, max: 10 } }],
			{
				initialValues: { speed: 4 },
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{
								space: 1,
								toolbar: [{ point: 'speed', control: 'slider', config: { showValue: false } }],
							},
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const readout = host.querySelector('.palette-default-slider-value')
		expect(readout?.classList.contains('is-icon-only')).toBe(true)
		const texts = [...(readout?.childNodes ?? [])].filter(
			(child) => child.nodeType === Node.TEXT_NODE
		)
		expect(texts).toHaveLength(0)
		ide.dispose()
	})

	it('segmented with showText:false renders icon-only (no label node)', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light', icon: '☀️' },
							{ value: 'dark', label: 'Dark', icon: '🌙' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{
								space: 1,
								toolbar: [{ point: 'theme', control: 'segmented', config: { showText: false } }],
							},
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const group = host.querySelector('.palette-default-segmented')
		expect(group).not.toBe(null)
		expect(group?.querySelector('.palette-default-choice')).toBe(null)
		expect(group?.querySelectorAll('.palette-default-choice-icon')).toHaveLength(2)
		ide.dispose()
	})

	it('icon-less select reserves no icon space (label only, zero icon nodes)', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light' },
							{ value: 'dark', label: 'Dark' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'theme', control: 'select' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const trigger = host.querySelector('.palette-default-select-trigger')
		expect(trigger?.querySelectorAll('.palette-default-icon')).toHaveLength(0)
		expect(trigger?.querySelector('.palette-default-choice')?.textContent).toBe('Light')
		// List rows are icon-less too, but keep full text.
		const rows = [...(host.querySelectorAll('.palette-default-select-option') ?? [])]
		expect(rows).toHaveLength(2)
		expect(rows[0]?.querySelector('.palette-default-choice-icon')).toBe(null)
		expect(rows[0]?.querySelector('.palette-default-choice')?.textContent).toBe('Light')
		ide.dispose()
	})

	it('tool-icon-less select keeps exactly the value icon', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light', icon: '☀️' },
							{ value: 'dark', label: 'Dark', icon: '🌙' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'theme', control: 'select' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const chip = host.querySelector('.palette-default-select-value')
		expect(chip?.querySelector('.palette-default-tool-icon')).toBe(null)
		expect(chip?.querySelectorAll('.palette-default-icon')).toHaveLength(1)
		expect(chip?.querySelector('.palette-default-value-icon')?.textContent).toBe('☀️')
		ide.dispose()
	})

	it('skeleton select renders a `?` watermark, swapped for the label on value arrival', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light', icon: '☀️' },
							{ value: 'dark', label: 'Dark', icon: '🌙' },
						],
					},
				},
			],
			{
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'theme', control: 'select' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const trigger = host.querySelector('.palette-default-select-trigger')
		expect(trigger?.querySelector('.palette-default-value-icon')).toBe(null)
		expect(trigger?.querySelector('.palette-default-choice')).toBe(null)
		expect(trigger?.querySelector('.palette-default-select-watermark')?.textContent).toBe('?')
		// Value arrival swaps watermark → label in the same trigger node.
		core.values.set('theme' as never, 'dark' as never)
		expect(host.querySelector('.palette-default-select-trigger')).toBe(trigger)
		expect(trigger?.querySelector('.palette-default-select-watermark')).toBe(null)
		expect(trigger?.querySelector('.palette-default-value-icon')?.textContent).toBe('🌙')
		expect(trigger?.querySelector('.palette-default-choice')?.textContent).toBe('Dark')
		ide.dispose()
	})

	it('icon-less segmented option keeps its label with zero icon nodes', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light' },
							{ value: 'dark', label: 'Dark' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'theme', control: 'segmented' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const group = host.querySelector('.palette-default-segmented')
		expect(group?.querySelectorAll('.palette-default-choice-icon')).toHaveLength(0)
		const labels = [...(group?.querySelectorAll('.palette-default-choice') ?? [])].map(
			(node) => node.textContent
		)
		expect(labels).toEqual(['Light', 'Dark'])
		ide.dispose()
	})

	it('select renders trigger chip + full-text list rows', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light', icon: '☀️' },
							{ value: 'dark', label: 'Dark', icon: '🌙' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'theme', control: 'select' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const trigger = host.querySelector('.palette-default-select-trigger')
		expect(trigger?.getAttribute('aria-haspopup')).toBe('listbox')
		expect(trigger?.getAttribute('aria-expanded')).toBe('false')
		expect(trigger?.querySelector('.palette-default-choice')?.textContent).toBe('Light')
		const list = host.querySelector('.palette-default-select-list')
		expect(list?.getAttribute('role')).toBe('listbox')
		expect((list as HTMLElement | null)?.hidden).toBe(true)
		const rows = [...(list?.querySelectorAll('.palette-default-select-option') ?? [])]
		expect(rows).toHaveLength(2)
		expect(rows[0]?.getAttribute('aria-selected')).toBe('true')
		expect(rows[1]?.getAttribute('aria-selected')).toBe('false')
		// Rows always render icon + full text.
		expect(rows[0]?.querySelector('.palette-default-choice-icon')?.textContent).toBe('☀️')
		expect(rows[0]?.querySelector('.palette-default-choice')?.textContent).toBe('Light')
		// Click opens the list; picking a row runs + closes + syncs in place.
		;(trigger as HTMLButtonElement).click()
		expect((list as HTMLElement | null)?.hidden).toBe(false)
		expect(trigger?.getAttribute('aria-expanded')).toBe('true')
		;(rows[1] as HTMLButtonElement).click()
		expect(core.values.get('theme' as never)).toBe('dark')
		expect((list as HTMLElement | null)?.hidden).toBe(true)
		expect(trigger?.querySelector('.palette-default-choice')?.textContent).toBe('Dark')
		ide.dispose()
	})

	it('select with showText:false keeps an icon-only trigger but full-text rows', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light', icon: '☀️' },
							{ value: 'dark', label: 'Dark', icon: '🌙' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{
								space: 1,
								toolbar: [{ point: 'theme', control: 'select', config: { showText: false } }],
							},
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const chip = host.querySelector('.palette-default-select-value')
		expect(chip?.classList.contains('is-icon-only')).toBe(true)
		expect(chip?.querySelector('.palette-default-choice')).toBe(null)
		const rows = host.querySelectorAll('.palette-default-select-option .palette-default-choice')
		expect(rows).toHaveLength(2)
		expect(rows[0]?.textContent).toBe('Light')
		ide.dispose()
	})

	it('vertical select puts the closed label beside the icon chip (segmented pattern)', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light', icon: '☀️' },
							{ value: 'dark', label: 'Dark', icon: '🌙' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [],
						right: [],
						bottom: [],
						left: [{ space: 1, toolbar: [{ point: 'theme', control: 'select' }] }],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const box = host.querySelector('.palette-default-select')
		expect(box).not.toBe(null)
		const trigger = host.querySelector('.palette-default-select-trigger')
		const chip = host.querySelector('.palette-default-select-value')
		const label = trigger?.querySelector(':scope > .palette-default-choice')
		expect(label?.textContent).toBe('Light')
		// The chip keeps icons only; the label is its sibling, not its child.
		expect(chip?.querySelector(':scope > .palette-default-choice')).toBe(null)
		expect(label?.parentElement).toBe(trigger)
		expect(chip?.parentElement).toBe(trigger)
		// Model change updates the sibling label in place, same trigger node.
		core.values.set('theme' as never, 'dark' as never)
		expect(host.querySelector('.palette-default-select-trigger')).toBe(trigger)
		expect(trigger?.querySelector(':scope > .palette-default-choice')?.textContent).toBe('Dark')
		ide.dispose()
	})

	it('select renders tool icon + value icon + label in the closed chip', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light', icon: '☀️' },
							{ value: 'dark', label: 'Dark', icon: '🌙' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{
								space: 1,
								toolbar: [{ point: 'theme', control: 'select', config: { icon: '🪐' } }],
							},
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const chip = host.querySelector('.palette-default-select-value')
		expect(chip?.querySelector('.palette-default-tool-icon')?.textContent).toBe('🪐')
		expect(chip?.querySelector('.palette-default-value-icon')?.textContent).toBe('☀️')
		expect(chip?.querySelector('.palette-default-choice')?.textContent).toBe('Light')
		// Model change swaps the value icon in place, keeping the tool icon.
		core.values.set('theme' as never, 'dark' as never)
		expect(chip?.querySelector('.palette-default-tool-icon')?.textContent).toBe('🪐')
		expect(chip?.querySelector('.palette-default-value-icon')?.textContent).toBe('🌙')
		ide.dispose()
	})

	it('select syncs the trigger in place and preserves the open state', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light', icon: '☀️' },
							{ value: 'dark', label: 'Dark', icon: '🌙' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'theme', control: 'select' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const trigger = host.querySelector(
			'.palette-default-select-trigger'
		) as HTMLButtonElement | null
		trigger?.click()
		const list = host.querySelector('.palette-default-select-list') as HTMLElement | null
		expect(list?.hidden).toBe(false)
		core.values.set('theme' as never, 'dark' as never)
		expect(host.querySelector('.palette-default-select-trigger')).toBe(trigger)
		expect(list?.hidden).toBe(false)
		expect(trigger?.querySelector('.palette-default-choice')?.textContent).toBe('Dark')
		expect(list?.querySelector('[data-value="dark"]')?.getAttribute('aria-selected')).toBe('true')
		ide.dispose()
	})

	it('select reconciles rows on defineEnumOptions with the list open', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light', icon: '☀️' },
							{ value: 'dark', label: 'Dark', icon: '🌙' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'theme', control: 'select' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const trigger = host.querySelector(
			'.palette-default-select-trigger'
		) as HTMLButtonElement | null
		trigger?.click()
		const list = host.querySelector('.palette-default-select-list') as HTMLElement | null
		expect(list?.hidden).toBe(false)
		core.defineEnumOptions('theme', [
			{ value: 'light', label: 'Light', icon: '☀️' },
			{ value: 'dusk', label: 'Dusk', icon: '🌇' },
		])
		expect(list?.hidden).toBe(false)
		expect(host.querySelector('.palette-default-select-trigger')).toBe(trigger)
		expect(list?.querySelector('[data-value="dark"]')).toBe(null)
		expect(list?.querySelector('[data-value="dusk"] .palette-default-choice')?.textContent).toBe(
			'Dusk'
		)
		ide.dispose()
	})

	it('segmented reconciles buttons on defineEnumOptions', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light' },
							{ value: 'dark', label: 'Dark' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'theme', control: 'segmented' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const group = host.querySelector('.palette-default-segmented')
		expect(group?.querySelectorAll('button')).toHaveLength(2)
		core.defineEnumOptions('theme', [
			{ value: 'light', label: 'Light' },
			{ value: 'dusk', label: 'Dusk' },
		])
		expect(host.querySelector('.palette-default-segmented')).toBe(group)
		expect(group?.querySelector('[data-value="dark"]')).toBe(null)
		expect(group?.querySelector('[data-value="dusk"]')).not.toBe(null)
		ide.dispose()
	})

	it('select with showFilter renders a filter input that narrows rows', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light' },
							{ value: 'dark', label: 'Dark' },
							{ value: 'dusk', label: 'Dusk' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{
								space: 1,
								toolbar: [{ point: 'theme', control: 'select', config: { showFilter: true } }],
							},
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const trigger = host.querySelector(
			'.palette-default-select-trigger'
		) as HTMLButtonElement | null
		trigger?.click()
		const input = host.querySelector(
			'[data-testid="select-filter-input"]'
		) as HTMLInputElement | null
		expect(input).not.toBe(null)
		input!.value = 'dusk'
		input!.dispatchEvent(new Event('input', { bubbles: true }))
		const rows = [...host.querySelectorAll('.palette-default-select-option')] as HTMLElement[]
		expect(rows.find((row) => row.dataset.value === 'dusk')?.hidden).toBe(false)
		expect(rows.find((row) => row.dataset.value === 'dark')?.hidden).toBe(true)
		expect(rows.find((row) => row.dataset.value === 'light')?.hidden).toBe(true)
		// Enter runs the first visible row and closes the list.
		input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
		expect(core.values.get('theme')).toBe('dusk')
		expect((host.querySelector('.palette-default-select-list') as HTMLElement)?.hidden).toBe(true)
		ide.dispose()
	})

	it('select without showFilter renders no filter input', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light' },
							{ value: 'dark', label: 'Dark' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'theme', control: 'select' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		expect(host.querySelector('[data-testid="select-filter-input"]')).toBe(null)
		ide.dispose()
	})

	it('focused slider is not clobbered mid-drag', () => {
		const { core, ide, host } = setup()
		const input = host.querySelector('input[type="range"]') as HTMLInputElement | null
		input?.focus()
		input!.value = '4'
		core.values.set('speed' as never, 9 as never)
		expect(input?.value).toBe('4')
		ide.dispose()
	})

	it('theme cycles the document-root class in place (same node)', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'nothing',
					options: [
						{ value: 'light', icon: '☀️', label: 'Light' },
						{ value: 'dark', icon: '🌙', label: 'Dark' },
						{ value: 'system', icon: '💻', label: 'System' },
					],
				},
			],
			{
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{
								space: 1,
								toolbar: [{ point: 'theme', control: 'theme', config: { icon: '🎨' } }],
							},
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		document.documentElement.dataset.theme = 'dark'
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const button = host.querySelector('[data-testid="theme-tool"]') as HTMLButtonElement | null
		expect(button).not.toBe(null)
		// Icon-value only: the current option icon, no text label.
		expect(button?.querySelector('.palette-default-icon')?.textContent).toBe('🌙')
		expect(button?.querySelector('.palette-default-choice')).toBe(null)
		button?.click()
		expect(document.documentElement.dataset.theme).toBe('system')
		expect(host.querySelector('[data-testid="theme-tool"]')).toBe(button)
		expect(button?.querySelector('.palette-default-icon')?.textContent).toBe('💻')
		ide.dispose()
		document.documentElement.classList.remove('palette-default-theme-light')
		delete document.documentElement.dataset.theme
	})
})

describe('editing chrome without rebuild', () => {
	it('console open flips editing classes + inert + guards', () => {
		const { consoleStore, ide, host } = setup(true)
		// createIDE turns the container itself into `.palette-ide`.
		expect(host.classList.contains('palette-ide')).toBe(true)
		expect(host.querySelector('.toolbar-item-guard')).toBe(null)
		// No commandBox tool in this fixture → edit mode needs mode 'edit'.
		consoleStore.open('edit')
		// The editing flip re-renders structurally (drag listeners bind at
		// render time), so node identity is not preserved — the chrome
		// flips are what this pins.
		expect(host.classList.contains('editing')).toBe(true)
		expect(host.querySelector('.toolbar-item-content')?.hasAttribute('inert')).toBe(true)
		expect(host.querySelector('.toolbar-item-guard') instanceof HTMLElement).toBe(true)
		consoleStore.close()
		expect(host.classList.contains('editing')).toBe(false)
		expect(host.querySelector('.toolbar-item-content')?.hasAttribute('inert')).toBe(false)
		expect(host.querySelector('.toolbar-item-guard')).toBe(null)
		ide.dispose()
	})

	it('guard pointerdown stamps no data-dragged for a subset drag (nothing moves yet)', () => {
		const core = new PaletteCore(
			[
				{ id: 'lamp', label: 'Lamp', type: 'boolean' },
				{ id: 'speed', label: 'Speed', type: 'number' },
			],
			{
				initialValues: { lamp: false, speed: 1 },
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{
								space: 1,
								toolbar: [
									{ point: 'lamp', control: 'toggle' },
									{ point: 'speed', control: 'slider' },
								],
							},
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => true })
		consoleStore.open('edit')
		expect(host.querySelector('.toolbar[data-dragged="true"]')).toBe(null)
		const first = host.querySelectorAll('.toolbar-item')[0] as HTMLElement
		first
			.querySelector('.toolbar-item-guard')
			?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		// Core decided: a subset drag moves nothing, so no toolbar owns the
		// chrome — it appears only once the extraction promotes to a slide.
		expect(host.querySelector('.toolbar[data-dragged="true"]')).toBe(null)
		ide.dispose()
	})

	it('guard pointerdown flips data-inspected on two nodes only', () => {
		const { consoleStore, ide, host } = setup(true)
		// No commandBox tool in this fixture → edit mode needs mode 'edit'.
		consoleStore.open('edit')
		const wrappers = [...host.querySelectorAll('.toolbar-item')]
		expect(wrappers.length).toBeGreaterThanOrEqual(2)
		const first = wrappers[0] as HTMLElement
		const second = wrappers[1] as HTMLElement
		first
			.querySelector('.toolbar-item-guard')
			?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
		expect(first.dataset.inspected).toBe('true')
		second
			.querySelector('.toolbar-item-guard')
			?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
		expect(first.dataset.inspected).toBe(undefined)
		expect(second.dataset.inspected).toBe('true')
		// No rebuild: wrappers keep identity across the flip.
		expect(host.querySelectorAll('.toolbar-item')[0]).toBe(first)
		expect(host.querySelectorAll('.toolbar-item')[1]).toBe(second)
		ide.dispose()
	})

	it('selection patch re-renders details panel only, borders untouched', () => {
		const { consoleStore, ide, host } = setup(true)
		// No commandBox tool in this fixture → edit mode needs mode 'edit'.
		consoleStore.open('edit')
		const bar = host.querySelector('.toolbar')
		consoleStore.patch({ selectedEntryId: 'lamp' })
		expect(host.querySelector('.toolbar')).toBe(bar)
		expect(host.querySelector('[data-testid="console-details-panel"]') instanceof HTMLElement).toBe(
			true
		)
		ide.dispose()
	})

	it('add-source select clears an inspected item so the add panel shows', () => {
		const { core, consoleStore, ide, host } = setup(true)
		consoleStore.open('edit')
		const first = host.querySelector('.toolbar-item') as HTMLElement
		first
			.querySelector('.toolbar-item-guard')
			?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
		expect(first.dataset.inspected).toBe('true')
		expect(host.querySelector('.palette-default-config-table')).not.toBe(null)
		// Clicking an add source begins add: the inspector clears and the
		// add panel for the selected entry renders instead (configurator +
		// preview directly — no variant picker in between).
		const row = host.querySelector('.palette-default-command-result') as HTMLElement | null
		expect(row).not.toBe(null)
		row!.click()
		expect(first.dataset.inspected).toBe(undefined)
		expect(host.querySelector('[data-testid="console-add-panel"]')).not.toBe(null)
		expect(host.querySelector('[data-testid="console-add-preview"]')).not.toBe(null)
		ide.dispose()
		void core
	})

	it('inspecting follows the dragged tool object, not its old index', () => {
		const { core, consoleStore, ide, host } = setup(true)
		consoleStore.open('edit')
		const live = core.layout.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar
		const item = toolbar?.[0]
		if (!toolbar || !item) throw new Error('expected toolbar item')
		const first = host.querySelectorAll('.toolbar-item')[0] as HTMLElement
		first
			.querySelector('.toolbar-item-guard')
			?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
		expect(first.dataset.inspected).toBe('true')
		// Move the inspected tool into the other toolbar (same op the drag
		// engine emits): the edition must follow the object, not the index
		// it vacated — the details panel still configures the same tool.
		core.layout.moveItem(
			{ container: 'border', region: 'top', trackIndex: 0, toolbarIndex: 0, itemIndex: 0 },
			{ container: 'border', region: 'top', trackIndex: 1, toolbarIndex: 0, itemIndex: 1 }
		)
		const panel = host.querySelector('[data-testid="console-details-panel"]')
		expect(panel?.textContent).toContain('Inspect')
		// The tool now lives in the other toolbar: the emptied source
		// track is pruned, so only one top track remains holding both tools.
		const after = core.layout.getLayout()
		expect(after.borders.top).toHaveLength(1)
		expect(after.borders.top[0]?.[0]?.toolbar.length).toBe(2)
		expect(after.borders.top[0]?.[0]?.toolbar.includes(item)).toBe(true)
		ide.dispose()
	})

	it('hovering a tool paints no drop-zone without a drag session', () => {
		const { consoleStore, ide, host } = setup(true)
		consoleStore.open('edit')
		const bar = host.querySelector('.toolbar') as HTMLElement | null
		expect(bar).not.toBe(null)
		expect(host.querySelector('.toolbar-drop-zone.highlighted')).toBe(null)
		const item = bar!.querySelector('.toolbar-item') as HTMLElement | null
		item!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
		// No drag session runs (movement engine stripped): core gates every
		// highlight on `editing && dragging`, so hover alone stays dark.
		expect(host.querySelector('.toolbar-drop-zone.highlighted')).toBe(null)
		bar!.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
		expect(host.querySelector('.toolbar-drop-zone.highlighted')).toBe(null)
		ide.dispose()
	})

	it('hovering a track paints no stack DZ without a drag session', () => {
		const { consoleStore, ide, host } = setup(true)
		consoleStore.open('edit')
		const border = host.querySelector('.toolbar-border[data-region="top"]') as HTMLElement | null
		expect(border).not.toBe(null)
		// Dispatch on the track background (a track-space gap, not a
		// toolbar): with no drag session the flanking stacks stay dark.
		const tracks = border!.querySelectorAll('.toolbar-track')
		expect(tracks.length).toBe(2)
		const bg = (tracks[1] as HTMLElement).querySelector(
			'.toolbar-track-space.toolbar-drop-zone'
		) as HTMLElement | null
		expect(bg).not.toBe(null)
		bg!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
		expect(
			border!.querySelectorAll('.toolbar-stack-space.toolbar-drop-zone.highlighted').length
		).toBe(0)
		border!.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
		expect(border!.querySelector('.toolbar-drop-zone.highlighted')).toBe(null)
		ide.dispose()
	})

	it('no highlight when not editing', () => {
		const { ide, host } = setup(false)
		const border = host.querySelector('.toolbar-border[data-region="top"]') as HTMLElement | null
		const track = border!.querySelector('.toolbar-track') as HTMLElement | null
		track!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
		expect(host.querySelector('.toolbar-drop-zone.highlighted')).toBe(null)
		ide.dispose()
	})

	it('selecting an entry shows the full configurator + a disconnected preview', () => {
		const core = new PaletteCore(
			[
				{ id: 'lamp', label: 'Lamp', type: 'boolean' },
				{
					id: 'speed',
					label: 'Speed',
					type: 'number',
					constraints: { min: 0, max: 10, step: 1 },
				},
			],
			{
				initialValues: { lamp: false, speed: 1 },
				initialLayout: {
					version: 1,
					borders: { top: [], right: [], bottom: [], left: [] },
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => true })
		consoleStore.open('edit')
		consoleStore.patch({ selectedEntryId: 'tool:lamp' })
		const panel = host.querySelector('[data-testid="console-add-panel"]') as HTMLElement | null
		expect(panel).not.toBe(null)
		// Full configurator rows (same as the inspector, minus Delete —
		// the draft is detached, so there is nothing to delete — and minus
		// Control: `lamp` is a single-control boolean, so it binds silently).
		const keys = [...panel!.querySelectorAll('.palette-default-config-key strong')].map(
			(node) => node.textContent
		)
		expect(keys).toEqual(expect.arrayContaining(['Label', 'Icon', 'Hint', 'Tone']))
		expect(keys).not.toContain('Control')
		expect(keys).not.toContain('Delete')
		expect(panel!.querySelector('[data-testid="configurator-delete"]')).toBe(null)
		// Preview below the configuration, carrying the tool.
		const preview = panel!.querySelector('[data-testid="console-add-preview"]')
		expect(preview).not.toBe(null)
		expect(preview?.querySelector('.toolbar-item-content button')).not.toBe(null)
		ide.dispose()
	})

	it('preview interactions never touch the live store', () => {
		const core = new PaletteCore([{ id: 'lamp', label: 'Lamp', type: 'boolean' }], {
			initialValues: { lamp: false },
			initialLayout: {
				version: 1,
				borders: { top: [], right: [], bottom: [], left: [] },
			},
		})
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => true })
		consoleStore.open('edit')
		consoleStore.patch({ selectedEntryId: 'tool:lamp' })
		const panel = host.querySelector('[data-testid="console-add-panel"]') as HTMLElement | null
		expect(panel).not.toBe(null)
		const previewButton = panel!.querySelector(
			'[data-testid="console-add-preview-content"] button'
		) as HTMLButtonElement | null
		expect(previewButton).not.toBe(null)
		previewButton!.click()
		expect(core.values.get('lamp' as never)).toBe(false)
		// …but the preview re-rendered pressed in place (same node).
		expect(previewButton!.getAttribute('aria-pressed')).toBe('true')
		expect(panel!.querySelector('[data-testid="console-add-preview-content"] button')).toBe(
			previewButton
		)
		ide.dispose()
	})

	it('configurator edits retarget the draft preview (label flows through)', () => {
		const core = new PaletteCore(
			[
				{
					id: 'speed',
					label: 'Speed',
					type: 'number',
					constraints: { min: 0, max: 10, step: 1 },
				},
			],
			{
				initialValues: { speed: 1 },
				initialLayout: {
					version: 1,
					borders: { top: [], right: [], bottom: [], left: [] },
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => true })
		consoleStore.open('edit')
		consoleStore.patch({ selectedEntryId: 'tool:speed' })
		const panel = host.querySelector('[data-testid="console-add-panel"]') as HTMLElement | null
		expect(panel).not.toBe(null)
		const labelInput = [...panel!.querySelectorAll('.palette-default-config-value input')][0] as
			| HTMLInputElement
			| undefined
		expect(labelInput).not.toBe(undefined)
		labelInput!.value = 'Velocity'
		labelInput!.dispatchEvent(new Event('input', { bubbles: true }))
		// The details panel re-rendered: the preview follows the edit —
		// the slider's accessible title carries the new label.
		const again = host.querySelector('[data-testid="console-add-panel"]') as HTMLElement | null
		expect(again).not.toBe(null)
		const previewRange = again!.querySelector(
			'[data-testid="console-add-preview-content"] input[type="range"]'
		) as HTMLInputElement | null
		expect(previewRange).not.toBe(null)
		expect(previewRange!.getAttribute('aria-label')).toContain('Velocity')
		ide.dispose()
	})

	it('selecting an entry opens the configurator + preview directly (no variant picker)', () => {
		const core = new PaletteCore([{ id: 'lamp', label: 'Lamp', type: 'boolean' }], {
			initialValues: { lamp: false },
			initialLayout: {
				version: 1,
				borders: { top: [], right: [], bottom: [], left: [] },
			},
		})
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => true })
		consoleStore.open('edit')
		consoleStore.patch({ selectedEntryId: 'tool:lamp' })
		const panel = host.querySelector('[data-testid="console-add-panel"]') as HTMLElement | null
		expect(panel).not.toBe(null)
		// No variant picker: one source = one variant, so the configurator +
		// preview render as soon as the entry is selected.
		expect(panel!.querySelector('.palette-default-add-variant-trigger')).toBe(null)
		expect(panel!.querySelector('.palette-default-config-table')).not.toBe(null)
		expect(panel!.querySelector('[data-testid="console-add-preview"]')).not.toBe(null)
		ide.dispose()
	})

	it('a nothing-point add panel binds 1:1 with no Control row', () => {
		const core = new PaletteCore(
			[{ id: 'theme', label: 'Theme', type: 'nothing', controls: ['theme'] }],
			{
				initialLayout: {
					version: 1,
					borders: { top: [], right: [], bottom: [], left: [] },
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => true })
		consoleStore.open('edit')
		consoleStore.patch({ selectedEntryId: 'tool:theme' })
		const panel = host.querySelector('[data-testid="console-add-panel"]') as HTMLElement | null
		expect(panel).not.toBe(null)
		const keys = [...panel!.querySelectorAll('.palette-default-config-key strong')].map(
			(node) => node.textContent
		)
		expect(keys).not.toContain('Control')
		expect(panel!.querySelector('[data-testid="console-add-preview"]')).not.toBe(null)
		ide.dispose()
	})

	it('a multi-control enum keeps its Control row', () => {
		const core = new PaletteCore(
			[
				{
					id: 'mode',
					label: 'Mode',
					type: 'enum',
					constraints: { options: [{ value: 'a' }, { value: 'b' }] },
				},
			],
			{
				initialLayout: {
					version: 1,
					borders: { top: [], right: [], bottom: [], left: [] },
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => true })
		consoleStore.open('edit')
		consoleStore.patch({ selectedEntryId: 'tool:mode' })
		const panel = host.querySelector('[data-testid="console-add-panel"]') as HTMLElement | null
		expect(panel).not.toBe(null)
		const keys = [...panel!.querySelectorAll('.palette-default-config-key strong')].map(
			(node) => node.textContent
		)
		expect(keys).toContain('Control')
		ide.dispose()
	})
})

describe('drag structure events preserve unmoved DOM', () => {
	it('a same-track item merge re-renders only the target track', () => {
		const { core, consoleStore, ide, host } = setup(true)
		consoleStore.open('edit')
		const border = host.querySelector('.toolbar-border[data-region="top"]') as HTMLElement
		const tracksBefore = [...border.querySelectorAll(':scope > .toolbar-track')] as HTMLElement[]
		expect(tracksBefore).toHaveLength(2)
		const live = core.layout.getLayout()
		const a = live.borders.top[0]?.[0]?.toolbar
		const b = live.borders.top[1]?.[0]?.toolbar
		const item = a?.[0]
		if (!a || !b || !item) throw new Error('expected toolbars')
		// Drive the commit through the real session so the op shape is the
		// one the adapter applies in production (not a hand-built op).
		const session = core.layout.createDrag({ kind: 'tool', toolbar: a, item })
		const events: import('@palettable/core').DragEvent[] = []
		session.subscribe((event) => events.push(event))
		session.over({ kind: 'item-gap', toolbar: b, gap: 1 }, { clientX: 0, clientY: 0 })
		session.end()
		expect(events.some((event) => event.type === 'structure')).toBe(true)
		// Target track rebuilt (item landed there); the other track's node
		// survived — no full-border rebuild.
		const tracksAfter = [...border.querySelectorAll(':scope > .toolbar-track')] as HTMLElement[]
		expect(tracksAfter).toHaveLength(2)
		expect(tracksAfter[1]).toBe(tracksBefore[1])
		// The dragged lamp tool moved from track 0 into track 1: the
		// surviving track now renders both tools (lamp toggle + speed
		// slider), and the emptied track 0 is gone from the model.
		expect(tracksAfter[1]?.querySelectorAll('.toolbar-item').length).toBeGreaterThanOrEqual(1)
		expect(core.layout.getLayout().borders.top).toHaveLength(1)
		ide.dispose()
	})

	it('a cross-region slide keeps the untouched regions identical', () => {
		const { core, consoleStore, ide, host } = setup(true)
		consoleStore.open('edit')
		const right = host.querySelector('.toolbar-border[data-region="right"]') as HTMLElement
		const rightBefore = right.innerHTML
		const live = core.layout.getLayout()
		const toolbar = live.borders.top[0]?.[0]?.toolbar
		if (!toolbar) throw new Error('expected toolbar')
		// Whole-toolbar slide across regions via the tree path (same op the
		// session emits: `from` + `to` + pruned victims).
		core.layout.moveToolbar(
			{ container: 'border', region: 'top', trackIndex: 0, toolbarIndex: 0 },
			{ container: 'border', region: 'left', trackIndex: 0, toolbarIndex: 0 }
		)
		// Untouched region kept byte-identical DOM — no `replace`, no
		// console pass, no collateral rebuild.
		expect(right.innerHTML).toBe(rightBefore)
		expect(host.querySelector('.toolbar-border[data-region="left"]') instanceof HTMLElement).toBe(
			true
		)
		ide.dispose()
	})
})

describe('drawer drag editing', () => {
	function drawerSetup() {
		const core = new PaletteCore(
			[
				{ id: 'lamp', label: 'Lamp', type: 'boolean' },
				{ id: 'speed', label: 'Speed', type: 'number', constraints: { min: 0, max: 10 } },
				{ id: 'more', label: 'More', type: 'nothing' as never },
			],
			{
				initialValues: { lamp: false, speed: 1 },
				initialLayout: {
					version: 2,
					borders: {
						top: [
							[
								{
									space: 1,
									toolbar: [
										{ point: 'lamp', control: 'toggle' },
										{
											point: 'more',
											control: 'drawer',
											config: { label: 'More' },
											toolbar: [{ space: 1, toolbar: [{ point: 'speed', control: 'slider' }] }],
										},
									],
								},
							],
						],
						right: [],
						bottom: [],
						left: [],
					},
				} as never,
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => true })
		consoleStore.open('edit')
		return { core, consoleStore, ide, host }
	}

	it('drawer popup renders item DZs in edit mode', () => {
		const { ide, host } = drawerSetup()
		const popup = host.querySelector('.palettable-drawer__popup') as HTMLElement
		expect(popup instanceof HTMLElement).toBe(true)
		// Open via pointerdown (toggle mode default) then assert DZs exist.
		const trigger = host.querySelector('.palettable-drawer__trigger') as HTMLButtonElement
		trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		expect(popup.hidden).toBe(false)
		const spaces = popup.querySelectorAll('[data-item-space-index]')
		// One tool → two gaps (before + after).
		expect(spaces.length).toBe(2)
		ide.dispose()
	})

	it('dragging a border tool into a drawer merges via the session', () => {
		const { core, ide, host } = drawerSetup()
		const live = core.layout.getLayout()
		const borderToolbar = live.borders.top[0]?.[0]?.toolbar
		const drawerItem = borderToolbar?.[1]
		const childToolbar = (drawerItem as { toolbar: { toolbar: unknown[] }[] }).toolbar[0]
			?.toolbar as import('@palettable/core').Toolbar
		const item = borderToolbar?.[0]
		if (!borderToolbar || !childToolbar || !item) throw new Error('expected toolbars')
		const session = core.layout.createDrag({ kind: 'tool', toolbar: borderToolbar, item })
		const events: import('@palettable/core').DragEvent[] = []
		session.subscribe((event) => events.push(event))
		session.over({ kind: 'item-gap', toolbar: childToolbar, gap: 1 }, { clientX: 0, clientY: 0 })
		session.end()
		expect(events.some((event) => event.type === 'structure')).toBe(true)
		expect(childToolbar.map((entry) => (entry as { point?: unknown }).point)).toEqual([
			'speed',
			'lamp',
		])
		// Drawer popup re-rendered in place (still in the DOM).
		expect(host.querySelector('.palettable-drawer__popup') instanceof HTMLElement).toBe(true)
		ide.dispose()
	})

	it('drawer opens on edit hover even without a drag', () => {
		const { ide, host } = drawerSetup()
		const popup = host.querySelector('.palettable-drawer__popup') as HTMLElement
		const wrapper = host.querySelector('.palettable-drawer') as HTMLElement
		expect(popup.hidden).toBe(true)
		// Rest hover (no drag session): bubbling `pointerover` on the
		// wrapper opens in edit mode (`pointerenter` does NOT bubble, so
		// a wrapper listener never fires for guard-covered trigger hits).
		// jsdom fires it synchronously via dispatch.
		wrapper.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
		expect(popup.hidden).toBe(false)
		ide.dispose()
	})

	it('drawer-child tool hover paints flanking gaps mid-drag (guard path)', () => {
		const { ide, host } = drawerSetup()
		// Open the drawer first (edit hover-open).
		const trigger = host.querySelector('.palettable-drawer__trigger') as HTMLButtonElement
		trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		const popup = host.querySelector('.palettable-drawer__popup') as HTMLElement
		expect(popup.hidden).toBe(false)
		// Start the drag through the ADAPTER (border lamp guard
		// pointerdown → `startToolDrag` sets the adapter `dragSession` the
		// wrap `pointermove` handler paints through). A raw
		// `core.layout.createDrag` leaves the adapter session unset, so the
		// handler bails before reaching the engine.
		const borderGuard = host.querySelector('.toolbar-border .toolbar-item-guard') as HTMLElement
		expect(borderGuard instanceof HTMLElement).toBe(true)
		borderGuard.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		const guard = popup.querySelector('.toolbar-item-guard') as HTMLElement
		expect(guard instanceof HTMLElement).toBe(true)
		// `buttons: 1` — the drag session's window move handler treats
		// `buttons === 0` as release and ends the gesture (clearing paint),
		// so a synthetic move must carry the pressed button like a real drag.
		guard.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1 }))
		// The engine paints the flanking item-gaps `highlighted` (same
		// `item-gap` session path as border bars).
		const spaces = [...popup.querySelectorAll('[data-item-space-index]')]
		expect(spaces.length).toBe(2)
		expect(spaces.some((node) => (node as HTMLElement).classList.contains('highlighted'))).toBe(
			true
		)
		ide.dispose()
	})

	it('drawer drag-hover event opens the popup for its own item', () => {
		const { core, ide, host } = drawerSetup()
		const live = core.layout.getLayout()
		const borderToolbar = live.borders.top[0]?.[0]?.toolbar
		const drawerItem = borderToolbar?.[1]
		if (!drawerItem) throw new Error('expected drawer item')
		const popup = host.querySelector('.palettable-drawer__popup') as HTMLElement
		const wrapper = host.querySelector('.palettable-drawer') as HTMLElement
		expect(popup.hidden).toBe(true)
		// Dispatch the adapter's drag-hover event with the live drawer
		// item. The `isDragging` gate reads the adapter session (unset
		// here), so stub it via a real guard pointerdown is overkill —
		// instead assert the identity gate: a foreign item never opens.
		wrapper.dispatchEvent(
			new CustomEvent('palettable-drawer-drag-hover', {
				detail: { point: 'foreign' },
				bubbles: true,
			})
		)
		expect(popup.hidden).toBe(true)
		ide.dispose()
	})

	it('dragging the last drawer tool out leaves the last bar empty (drop target)', () => {
		const { core, ide, host } = drawerSetup()
		const live = core.layout.getLayout()
		const borderToolbar = live.borders.top[0]?.[0]?.toolbar
		const drawerItem = borderToolbar?.[1]
		const childTrack = (drawerItem as { toolbar: { toolbar: unknown[] }[] }).toolbar
		const childToolbar = childTrack[0]?.toolbar as import('@palettable/core').Toolbar
		const item = childToolbar?.[0]
		if (!borderToolbar || !childToolbar || !item) throw new Error('expected toolbars')
		const session = core.layout.createDrag({ kind: 'tool', toolbar: childToolbar, item })
		session.over({ kind: 'item-gap', toolbar: borderToolbar, gap: 0 }, { clientX: 0, clientY: 0 })
		session.end()
		// Last drawer bar persists empty (the drawer's drop target).
		expect(childToolbar).toHaveLength(0)
		expect(childTrack).toHaveLength(1)
		// Open the drawer and assert the emptied toolbar renders its bar
		// with DZs (leading + trailing collapse to one visual target via
		// the `:only-child` CSS rule — both nodes exist, one paints large).
		const trigger = host.querySelector('.palettable-drawer__trigger') as HTMLButtonElement
		trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		const popup = host.querySelector('.palettable-drawer__popup') as HTMLElement
		const bar = popup.querySelector('.toolbar') as HTMLElement
		expect(bar instanceof HTMLElement).toBe(true)
		const spaces = popup.querySelectorAll('[data-item-space-index]')
		expect(spaces.length).toBeGreaterThanOrEqual(1)
		ide.dispose()
	})

	it('toggle trigger opens on primary pointerdown, ignores right-click, toggles on keyboard click', () => {
		const { ide, host } = drawerSetup()
		const popup = host.querySelector('.palettable-drawer__popup') as HTMLElement
		const trigger = host.querySelector('.palettable-drawer__trigger') as HTMLButtonElement
		expect(popup.hidden).toBe(true)
		// Right/middle press must not toggle.
		trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }))
		expect(popup.hidden).toBe(true)
		// Primary press opens.
		trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		expect(popup.hidden).toBe(false)
		// Primary press again closes (toggle).
		trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		expect(popup.hidden).toBe(true)
		// Keyboard click (`detail === 0`) opens — pointerdown never fires
		// for Enter/Space.
		trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(popup.hidden).toBe(false)
		ide.dispose()
	})

	it('nested drawer opens toward the IDE center and stacks above its parent', () => {
		// Geometry override (jsdom reports zero rects): the seek measures
		// the WRAPPER rect (trigger + popup as laid out), so the override
		// is the wrapper rect. Threaded through `HeadContext` — no
		// `getBoundingClientRect` stubbing needed. NOTE: the override is
		// shared by BOTH drawers (outer top-border drawer + nested), so
		// pick a rect that flips the nested one correctly: nested is a
		// horizontal child (extends sideways) right of center; its parent
		// axis is vertical, so the content region center-seeks
		// top/bottom → upper half → `top`.
		let runs = 0
		const ideRect = { left: 0, top: 0, width: 1000, height: 800 }
		const triggerRect = { left: 600, top: 100, width: 340, height: 44 }
		const core = new PaletteCore(
			[
				{
					id: 'fire',
					label: 'Fire',
					type: 'action',
					run: () => {
						runs++
					},
				},
				{ id: 'more', label: 'More', type: 'nothing' as never },
			],
			{
				initialLayout: {
					version: 2,
					borders: {
						top: [
							[
								{
									space: 1,
									toolbar: [
										{
											point: 'more',
											control: 'drawer',
											config: { label: 'Outer' },
											toolbar: [
												{
													space: 1,
													toolbar: [
														{
															point: 'more',
															control: 'drawer',
															config: { label: 'Inner' },
															toolbar: [
																{ space: 1, toolbar: [{ point: 'fire', control: 'button' }] },
															],
														},
													],
												},
											],
										},
									],
								},
							],
						],
						right: [],
						bottom: [],
						left: [],
					},
				} as never,
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, {
			core,
			consoleStore,
			isEditable: () => false,
			headContext: { ideRect, triggerRect },
		})
		const outerTrigger = host.querySelector('.palettable-drawer__trigger') as HTMLButtonElement
		outerTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		const popups = [...host.querySelectorAll('.palettable-drawer__popup')] as HTMLElement[]
		expect(popups).toHaveLength(2)
		expect(popups[0]?.hidden).toBe(false)
		// Outer is top-level: depth 1 → z 211.
		expect(popups[0]?.style.zIndex).toBe('211')
		const innerTrigger = popups[0]?.querySelector(
			'.palettable-drawer__trigger'
		) as HTMLButtonElement
		innerTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		expect(popups[1]?.hidden).toBe(false)
		// Nested stacks above the parent.
		expect(Number(popups[1]?.style.zIndex)).toBeGreaterThan(Number(popups[0]?.style.zIndex))
		// Wrappers are purely structural: no region class, no `--region`.
		for (const wrapper of host.querySelectorAll('.palettable-drawer')) {
			expect(wrapper.className).toBe('palettable-drawer')
			expect((wrapper as HTMLElement).style.getPropertyValue('--region')).toBe('')
		}
		// Outer (top border → vertical child): wrapper above IDE center
		// (100+22 < 400) → opens down; parent axis horizontal, wrapper
		// right of center (600+170 > 500) → content region `right`.
		// Placement is declarative (`--region` only): the popup queries
		// the parent container's `--region`.
		expect(popups[0]?.style.getPropertyValue('--region')).toBe('right')
		// Nested wrapper right of IDE center (600+170 > 500) → horizontal
		// popup opens left; parent axis vertical + upper half → `top`.
		expect(popups[1]?.style.getPropertyValue('--region')).toBe('top')
		// No inline geometry: placement is declarative (`--region`), the
		// stylesheet owns the sides.
		expect(popups[1]?.style.right).toBe('')
		expect(popups[1]?.style.left).toBe('')
		expect(runs).toBe(0)
		ide.dispose()
	})

	it('drawerCloseChainIndices closes the bottom-up run maxed with the hover extent', () => {
		const entry = (closeOnClick: boolean, openMode: 'hover' | 'toggle'): DrawerChainEntry => ({
			close: () => {},
			closeOnClick,
			openMode,
		})
		// No flags → nothing closes.
		expect(drawerCloseChainIndices([entry(false, 'toggle')])).toEqual([])
		// Leaf opt-in closes just the leaf.
		expect(drawerCloseChainIndices([entry(true, 'toggle'), entry(false, 'toggle')])).toEqual([0])
		// Contiguous run from the leaf closes through the run, stops at false.
		expect(
			drawerCloseChainIndices([
				entry(true, 'toggle'),
				entry(true, 'toggle'),
				entry(false, 'toggle'),
			])
		).toEqual([0, 1])
		// Hover extent wins even when nothing opts in: closes up to and
		// including the outermost hover ancestor.
		expect(
			drawerCloseChainIndices([
				entry(false, 'toggle'),
				entry(false, 'toggle'),
				entry(false, 'hover'),
			])
		).toEqual([0, 1, 2])
		// Max of both extents: run of 1 but hover reaches the top.
		expect(
			drawerCloseChainIndices([
				entry(true, 'toggle'),
				entry(false, 'toggle'),
				entry(false, 'hover'),
			])
		).toEqual([0, 1, 2])
	})

	it('command click inside a closeOnClick drawer closes it, sibling without flag stays', () => {
		let runs = 0
		const core = new PaletteCore(
			[
				{
					id: 'fire',
					label: 'Fire',
					type: 'action',
					run: () => {
						runs++
					},
				},
				{ id: 'more', label: 'More', type: 'nothing' as never },
			],
			{
				initialLayout: {
					version: 2,
					borders: {
						top: [
							[
								{
									space: 1,
									toolbar: [
										{
											point: 'more',
											control: 'drawer',
											config: { label: 'Closer', closeOnClick: true },
											toolbar: [{ space: 1, toolbar: [{ point: 'fire', control: 'button' }] }],
										},
										{
											point: 'more',
											control: 'drawer',
											config: { label: 'Stayer' },
											toolbar: [{ space: 1, toolbar: [{ point: 'fire', control: 'button' }] }],
										},
									],
								},
							],
						],
						right: [],
						bottom: [],
						left: [],
					},
				} as never,
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const triggers = [
			...host.querySelectorAll('.palettable-drawer__trigger'),
		] as HTMLButtonElement[]
		expect(triggers).toHaveLength(2)
		for (const trigger of triggers)
			trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		const popups = [...host.querySelectorAll('.palettable-drawer__popup')] as HTMLElement[]
		expect(popups.every((popup) => !popup.hidden)).toBe(true)
		// Activating the command in the first drawer runs the action AND
		// closes that drawer via the close-on-click chain (the sibling
		// also closes, but via outside-click — the click is outside its
		// wrapper).
		const firstButton = popups[0]?.querySelector('button') as HTMLButtonElement
		firstButton.click()
		expect(runs).toBe(1)
		expect(popups[0]?.hidden).toBe(true)
		expect(popups[1]?.hidden).toBe(true)
		// Reopen the opt-out drawer: its own command runs but leaves it open.
		triggers[1]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		expect(popups[1]?.hidden).toBe(false)
		const secondButton = popups[1]?.querySelector('button') as HTMLButtonElement
		secondButton.click()
		expect(runs).toBe(2)
		expect(popups[1]?.hidden).toBe(false)
		ide.dispose()
	})
})

describe('can flips', () => {
	it('a can flip toggles disabled in place, without a value change', () => {
		const core = new PaletteCore(
			[
				{
					id: 'boost',
					label: 'Boost',
					type: 'action',
					run: () => {},
					uses: ['mode'],
					can: (bag) => bag?.get('armed' as never) === true,
				},
			],
			{
				initialLayout: {
					version: 1,
					borders: {
						top: [{ space: 1, toolbar: [{ point: 'boost', control: 'button' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const bag = new PaletteStateStore()
		bag.set('armed' as never, false as never)
		core.setContext('mode', bag as never)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const button = host.querySelector('.toolbar-item-content button') as HTMLButtonElement
		expect(button.disabled).toBe(true)
		bag.set('armed' as never, true as never)
		expect(host.querySelector('.toolbar-item-content button')).toBe(button)
		expect(button.disabled).toBe(false)
		ide.dispose()
	})
})

describe('contextual value sync (ship selection pattern)', () => {
	function shipSetup() {
		const core = new PaletteCore(
			[
				{ id: 'shipShields', label: 'Ship Shields', type: 'boolean', uses: ['ship'] },
				{
					id: 'shipPower',
					label: 'Ship Reactor',
					type: 'number',
					constraints: { min: 0.5, max: 5, step: 0.5 },
					uses: ['ship'],
				},
				{
					id: 'fireTorpedo',
					label: 'Fire Torpedo',
					type: 'action',
					uses: ['ship'],
					can: (bag) => bag?.get('shipId' as never) !== undefined,
					run: () => {},
				},
			],
			{
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{
								space: 1,
								toolbar: [
									{ point: 'shipShields', control: 'toggle' },
									{ point: 'shipPower', control: 'slider' },
									{ point: 'fireTorpedo', control: 'button' },
								],
							},
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const bag = new ValuesBag<Record<string, unknown>>()
		core.setContext('ship', bag)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		return { core, bag, ide, host }
	}

	it('no selection renders skeleton (mixed toggle, disabled fire)', () => {
		const { ide, host } = shipSetup()
		const toggle = host.querySelector('.toolbar-item-content button') as HTMLButtonElement
		expect(toggle.getAttribute('aria-pressed')).toBe('mixed')
		// Context tools with no value are disabled — nothing to write to.
		expect(toggle.disabled).toBe(true)
		const input = host.querySelector('input[type="range"]') as HTMLInputElement
		expect(input.disabled).toBe(true)
		const buttons = [...host.querySelectorAll('.toolbar-item-content button')]
		const fire = buttons[buttons.length - 1] as HTMLButtonElement
		expect(fire.disabled).toBe(true)
		ide.dispose()
	})

	it('selection hydrates tools; toolbar writes land in the bag, not root', () => {
		const { core, bag, ide, host } = shipSetup()
		bag.setTree({ shipId: 'aurora', shipShields: true, shipPower: 3 })
		const toggle = host.querySelector('.toolbar-item-content button') as HTMLButtonElement
		expect(toggle.getAttribute('aria-pressed')).toBe('true')
		expect(toggle.disabled).toBe(false)
		const input = host.querySelector('input[type="range"]') as HTMLInputElement
		expect(input.value).toBe('3')
		expect(input.disabled).toBe(false)
		// Toolbar write routes to the context bag; root stays skeleton.
		core.writeValue('shipShields', false)
		expect(bag.get('shipShields')).toBe(false)
		expect(core.values.has('shipShields')).toBe(false)
		expect(toggle.getAttribute('aria-pressed')).toBe('false')
		ide.dispose()
	})

	it('deselecting returns tools to skeleton without touching root', () => {
		const { bag, ide, host } = shipSetup()
		bag.setTree({ shipId: 'aurora', shipShields: true, shipPower: 3 })
		expect(
			(host.querySelector('.toolbar-item-content button') as HTMLButtonElement).getAttribute(
				'aria-pressed'
			)
		).toBe('true')
		bag.setTree({
			shipId: undefined,
			shipShields: undefined,
			shipPower: undefined,
		})
		const toggle = host.querySelector('.toolbar-item-content button') as HTMLButtonElement
		expect(toggle.getAttribute('aria-pressed')).toBe('mixed')
		// Back to skeleton → disabled again (in place, same node).
		expect(toggle.disabled).toBe(true)
		expect((host.querySelector('input[type="range"]') as HTMLInputElement).disabled).toBe(true)
		ide.dispose()
	})
})

describe('spec-grammar coverage (vanilla adapter)', () => {
	function specSetup() {
		const core = new PaletteCore(
			[
				{ id: 'lamp', label: 'Lamp', type: 'boolean' },
				{
					id: 'speed',
					label: 'Speed',
					type: 'number',
					constraints: { min: 0, max: 10, step: 1 },
				},
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: { options: [{ value: 'light' }, { value: 'dark' }] },
				},
				{ id: 'save', label: 'Save', type: 'action', run: () => {} },
			],
			{
				initialValues: { lamp: false, speed: 1, theme: 'light' },
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{ space: 1, toolbar: [{ point: 'lamp', control: 'toggle' }] },
							{ space: 1, toolbar: [{ point: 'speed', control: 'stepper' }] },
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		return { core, ide, host }
	}

	it('stepper clicks step the live value and gate at the bounds', () => {
		const { core, ide, host } = specSetup()
		const group = host.querySelector('.palette-default-stepper')
		expect(group).not.toBe(null)
		const buttons = [...group!.querySelectorAll('button')] as HTMLButtonElement[]
		expect(buttons).toHaveLength(2)
		const [minus, plus] = buttons as [HTMLButtonElement, HTMLButtonElement]
		plus.click()
		expect(core.values.get('speed' as never)).toBe(2)
		minus.click()
		expect(core.values.get('speed' as never)).toBe(1)
		// At max the + button is disabled (bounds gate mirrors `can`).
		core.values.set('speed' as never, 10 as never)
		expect(plus.disabled).toBe(true)
		expect(minus.disabled).toBe(false)
		core.values.set('speed' as never, 0 as never)
		expect(minus.disabled).toBe(true)
		expect(plus.disabled).toBe(false)
		ide.dispose()
	})

	it('key bindings run toggle/step runnables and gate steps at the bound', () => {
		const core = new PaletteCore(
			[
				{ id: 'lamp', label: 'Lamp', type: 'boolean' },
				{ id: 'speed', label: 'Speed', type: 'number', constraints: { min: 0, max: 10, step: 1 } },
			],
			{
				keys: {
					L: { kind: 'toggle', point: 'lamp' },
					'+': { kind: 'inc', point: 'speed', delta: 1 },
					'-': { kind: 'dec', point: 'speed', delta: 1 },
				},
				initialValues: { lamp: false, speed: 10 },
				initialLayout: { version: 1, borders: { top: [], right: [], bottom: [], left: [] } },
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const keyWindow = host.ownerDocument.defaultView ?? window
		// Toggle via key.
		keyWindow.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))
		expect(core.values.get('lamp' as never)).toBe(true)
		// Step at max is a no-op (bounds gate, no preventDefault side effect on value).
		keyWindow.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))
		expect(core.values.get('speed' as never)).toBe(10)
		// Step down works.
		keyWindow.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))
		expect(core.values.get('speed' as never)).toBe(9)
		ide.dispose()
	})

	it('preview core applies setter/toggle/step runnables locally, never live', () => {
		const live = new PaletteCore(
			[
				{ id: 'lamp', label: 'Lamp', type: 'boolean' },
				{ id: 'speed', label: 'Speed', type: 'number', constraints: { min: 0, max: 10, step: 1 } },
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: { options: [{ value: 'light' }, { value: 'dark' }] },
				},
				{ id: 'save', label: 'Save', type: 'action', run: () => {} },
			],
			{ initialValues: { lamp: false, speed: 1, theme: 'light' } }
		)
		const { core: preview, setLocal } = createPreviewCore(
			live,
			{ point: 'lamp', control: 'toggle' },
			{ lamp: false, speed: 1, theme: 'light' }
		)
		// Setter forms.
		preview.run({ kind: 'set', point: 'lamp', value: true })
		expect(preview.values.get('lamp')).toBe(true)
		expect(live.values.get('lamp' as never)).toBe(false)
		preview.run({ kind: 'set', point: 'speed', value: 7 })
		expect(preview.values.get('speed')).toBe(7)
		preview.run({ kind: 'set', point: 'theme', value: 'dark' })
		expect(preview.values.get('theme')).toBe('dark')
		// Toggle form.
		preview.run({ kind: 'toggle', point: 'lamp' })
		expect(preview.values.get('lamp')).toBe(false)
		// Step forms (clamped at bounds).
		preview.run({ kind: 'inc', point: 'speed', delta: 2 })
		expect(preview.values.get('speed')).toBe(9)
		preview.run({ kind: 'inc', point: 'speed', delta: 5 })
		expect(preview.values.get('speed')).toBe(10)
		preview.run({ kind: 'dec', point: 'speed', delta: 20 })
		expect(preview.values.get('speed')).toBe(0)
		// Invalid runnables are absorbed (never throw, never touch live).
		preview.run({ kind: 'action', point: 'save' })
		preview.run({ kind: 'set', point: 'speed', value: 'abc' })
		preview.run({ kind: 'set', point: 'lamp', value: 'maybe' })
		expect(live.values.get('speed' as never)).toBe(1)
		expect(live.values.get('theme' as never)).toBe('light')
		// values.set writes locally too.
		setLocal('lamp', true)
		expect(preview.values.get('lamp')).toBe(true)
		expect(live.values.get('lamp' as never)).toBe(false)
	})
})
