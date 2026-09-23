/**
 * `@palettable/vanilla` — consumer icon customization (resolver + field hook).
 *
 * Proves a consumer can own icon rendering without touching the adapter:
 * `icon:<name>` tokens resolve through `IdeOptions.iconResolver`, and the
 * configurator Icon row swaps to `IdeOptions.renderIconField` when provided.
 * Default (no options) stays identity + plain text input.
 */
import { ConsoleStore, PaletteCore } from '@palettable/core'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveIcon } from './head.js'
import { createIDE } from './ide.js'

const hosts: HTMLElement[] = []
afterEach(() => {
	for (const host of hosts.splice(0)) host.remove()
})

const DICT: Record<string, string> = { moon: '🌙', sun: '☀️' }
const resolver = (token: string): string | undefined => {
	if (!token.startsWith('icon:')) return token
	return DICT[token.slice('icon:'.length)] ?? token
}

function setup(
	layoutIcon: string,
	options: Parameters<typeof createIDE>[1] extends never
		? never
		: Omit<Parameters<typeof createIDE>[1], 'core' | 'consoleStore' | 'isEditable'> = {}
) {
	const core = new PaletteCore([{ id: 'lamp', label: 'Lamp', type: 'boolean' }], {
		initialValues: { lamp: false },
		initialLayout: {
			version: 1,
			borders: {
				top: [
					{
						space: 1,
						toolbar: [{ point: 'lamp', control: 'toggle', config: { icon: layoutIcon } }],
					},
				],
				right: [],
				bottom: [],
				left: [],
			},
		},
	})
	const consoleStore = new ConsoleStore()
	const host = document.createElement('div')
	document.body.append(host)
	hosts.push(host)
	const ide = createIDE(host, {
		core,
		consoleStore,
		isEditable: () => false,
		...options,
	})
	return { core, consoleStore, ide, host }
}

describe('icon resolver', () => {
	it('resolveIcon is identity without a resolver (emoji passthrough)', () => {
		expect(resolveIcon('💨')).toBe('💨')
		expect(resolveIcon(undefined)).toBe(undefined)
		expect(resolveIcon('')).toBe('')
	})

	it('default IDE renders the raw token (no resolver)', () => {
		const { ide, host } = setup('icon:moon')
		expect(host.querySelector('.palette-default-icon')?.textContent).toBe('icon:moon')
		ide.dispose()
	})

	it('resolver maps known icon: names to glyphs', () => {
		const { ide, host } = setup('icon:moon', { iconResolver: resolver })
		expect(host.querySelector('.palette-default-icon')?.textContent).toBe('🌙')
		ide.dispose()
	})

	it('unknown icon: names fall back to the raw token (never blank)', () => {
		const { ide, host } = setup('icon:nope', { iconResolver: resolver })
		expect(host.querySelector('.palette-default-icon')?.textContent).toBe('icon:nope')
		ide.dispose()
	})

	it('emoji still passes through with a resolver set', () => {
		const { ide, host } = setup('💨', { iconResolver: resolver })
		expect(host.querySelector('.palette-default-icon')?.textContent).toBe('💨')
		ide.dispose()
	})
})

describe('configurator icon field hook', () => {
	function setupEditable(options: {
		readonly iconChoices?: readonly string[]
		readonly renderIconField?: (field: {
			readonly value: string
			readonly onChange: (next: string) => void
			readonly choices: readonly string[]
		}) => HTMLElement
	}) {
		const core = new PaletteCore([{ id: 'lamp', label: 'Lamp', type: 'boolean' }], {
			initialValues: { lamp: false },
			initialLayout: {
				version: 1,
				borders: {
					top: [{ space: 1, toolbar: [{ point: 'lamp', control: 'toggle', config: {} }] }],
					right: [],
					bottom: [],
					left: [],
				},
			},
		})
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, {
			core,
			consoleStore,
			isEditable: () => true,
			iconResolver: resolver,
			...options,
		})
		return { core, consoleStore, ide, host }
	}

	function iconRow(host: HTMLElement): HTMLElement | null {
		for (const row of host.querySelectorAll('.palette-default-config-row')) {
			const key = row.querySelector('.palette-default-config-key strong')?.textContent
			if (key === 'Icon') return row.querySelector('.palette-default-config-value')
		}
		return null
	}

	function openInspector(host: HTMLElement, consoleStore: ConsoleStore): void {
		// Edit-mode guards render only once the console opens edit mode;
		// guard pointerdown then inspects (mirrors value-sync.test.ts).
		consoleStore.open('edit')
		const guard = host.querySelector('.toolbar-item-guard') as HTMLElement | null
		expect(guard).not.toBe(null)
		guard!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
	}

	it('default Icon row is a plain text input', () => {
		const { consoleStore, ide, host } = setupEditable({})
		openInspector(host, consoleStore)
		const cell = iconRow(host)
		const input = cell?.querySelector('input')
		expect(input).not.toBe(null)
		expect(cell?.querySelector('datalist')).toBe(null)
		ide.dispose()
	})

	it('custom field is used when provided and writes back via onChange', () => {
		const seen: string[][] = []
		const { consoleStore, ide, host } = setupEditable({
			iconChoices: ['icon:moon', 'icon:sun'],
			renderIconField: ({ value, onChange, choices }) => {
				seen.push([...choices])
				const field = document.createElement('input')
				field.value = value
				field.setAttribute('list', 'test-icons')
				field.addEventListener('input', () => onChange(field.value))
				const list = document.createElement('datalist')
				list.id = 'test-icons'
				for (const choice of choices) {
					const option = document.createElement('option')
					option.value = choice
					list.append(option)
				}
				const wrap = document.createElement('span')
				wrap.append(field, list)
				return wrap
			},
		})
		openInspector(host, consoleStore)
		const cell = iconRow(host)
		expect(cell?.querySelector('datalist')).not.toBe(null)
		expect(seen).toEqual([['icon:moon', 'icon:sun']])
		const input = cell?.querySelector('input') as HTMLInputElement | null
		expect(input).not.toBe(null)
		// Free text stays typable: write an emoji straight through.
		input!.value = '🚀'
		input!.dispatchEvent(new Event('input', { bubbles: true }))
		expect(host.querySelector('.palette-default-icon')?.textContent).toBe('🚀')
		// …and a predefined choice resolves through the dict.
		input!.value = 'icon:moon'
		input!.dispatchEvent(new Event('input', { bubbles: true }))
		expect(host.querySelector('.palette-default-icon')?.textContent).toBe('🌙')
		ide.dispose()
	})
})
