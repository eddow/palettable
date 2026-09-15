/**
 * `@palettable/vanilla` — per-tool value sync + editing chrome (Phase E/F probe).
 *
 * Builds a minimal IDE host (one border region) over a real `PaletteCore`
 * and asserts that point value changes update the rendered tool node
 * in place — no structural re-render, same `HTMLElement` identity —
 * and that editing/inspecting transitions flip chrome without rebuilds.
 */
import { ConsoleStore, PaletteCore, PaletteStateStore } from '@palettable/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createIDE } from './ide.js'

const hosts: HTMLElement[] = []
afterEach(() => {
	for (const host of hosts.splice(0)) host.remove()
})

function setup(editable = false) {
	const core = new PaletteCore(
		[
			{ id: 'lamp', label: 'Lamp', type: 'boolean', defaultValue: false },
			{
				id: 'speed',
				label: 'Speed',
				type: 'number',
				defaultValue: 1,
				constraints: { min: 0, max: 10, step: 1 },
			},
		],
		{
			initialLayout: {
				version: 1,
				borders: {
					top: [
						{ space: 1, toolbar: [{ tool: 'lamp', editor: 'toggle' }] },
						{ space: 1, toolbar: [{ tool: 'speed', editor: 'slider' }] },
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

	it('focused slider is not clobbered mid-drag', () => {
		const { core, ide, host } = setup()
		const input = host.querySelector('input[type="range"]') as HTMLInputElement | null
		input?.focus()
		input!.value = '4'
		core.values.set('speed' as never, 9 as never)
		expect(input?.value).toBe('4')
		ide.dispose()
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
						top: [{ space: 1, toolbar: [{ tool: 'boost', editor: 'button' }] }],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const bag = new PaletteStateStore([])
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
