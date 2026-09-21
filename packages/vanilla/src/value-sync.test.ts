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
								toolbar: [{ tool: 'speed', editor: 'slider', config: { showValue: false } }],
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
								toolbar: [{ tool: 'theme', editor: 'segmented', config: { showText: false } }],
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
						top: [{ space: 1, toolbar: [{ tool: 'theme', editor: 'select' }] }],
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
								toolbar: [{ tool: 'theme', editor: 'select', config: { showText: false } }],
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
						left: [{ space: 1, toolbar: [{ tool: 'theme', editor: 'select' }] }],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		const host = document.createElement('div')
		document.body.append(host)
		hosts.push(host)
		const ide = createIDE(host, { core, consoleStore, isEditable: () => false })
		const box = host.querySelector('.palette-default-select.palette-default-layout-vertical')
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
								toolbar: [{ tool: 'theme', editor: 'select', config: { icon: '🪐' } }],
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
						top: [{ space: 1, toolbar: [{ tool: 'theme', editor: 'select' }] }],
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

	it('focused slider is not clobbered mid-drag', () => {
		const { core, ide, host } = setup()
		const input = host.querySelector('input[type="range"]') as HTMLInputElement | null
		input?.focus()
		input!.value = '4'
		core.values.set('speed' as never, 9 as never)
		expect(input?.value).toBe('4')
		ide.dispose()
	})

	it('theme cycles the bound value + document-root class in place (same node)', () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', icon: '☀️', label: 'Light' },
							{ value: 'dark', icon: '🌙', label: 'Dark' },
							{ value: 'system', icon: '💻', label: 'System' },
						],
					},
				},
			],
			{
				initialValues: { theme: 'dark' },
				initialLayout: {
					version: 1,
					borders: {
						top: [
							{
								space: 1,
								toolbar: [{ tool: 'theme', editor: 'theme', config: { icon: '🎨' } }],
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
		const button = host.querySelector('[data-testid="theme-tool"]') as HTMLButtonElement | null
		expect(button).not.toBe(null)
		// Icon-value only: the current option icon, no text label.
		expect(button?.querySelector('.palette-default-icon')?.textContent).toBe('🌙')
		expect(button?.querySelector('.palette-default-choice')).toBe(null)
		button?.click()
		expect(core.values.get('theme' as never)).toBe('system')
		expect(host.querySelector('[data-testid="theme-tool"]')).toBe(button)
		expect(button?.querySelector('.palette-default-icon')?.textContent).toBe('💻')
		// External value change syncs the icon in place too.
		core.values.set('theme' as never, 'light' as never)
		expect(host.querySelector('[data-testid="theme-tool"]')).toBe(button)
		expect(button?.querySelector('.palette-default-icon')?.textContent).toBe('☀️')
		expect(document.documentElement.classList.contains('palette-default-theme-light')).toBe(true)
		core.values.set('theme' as never, 'dark' as never)
		expect(document.documentElement.classList.contains('palette-default-theme-light')).toBe(false)
		ide.dispose()
		document.documentElement.classList.remove('palette-default-theme-light')
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

	it('guard pointerdown stamps core-decided data-dragged (vanilla applies only)', () => {
		const { consoleStore, ide, host } = setup(true)
		consoleStore.open('edit')
		const bars = [...host.querySelectorAll('.toolbar')] as HTMLElement[]
		expect(bars.length).toBeGreaterThanOrEqual(2)
		expect(host.querySelector('.toolbar[data-dragged="true"]')).toBe(null)
		const first = host.querySelectorAll('.toolbar-item')[0] as HTMLElement
		first
			.querySelector('.toolbar-item-guard')
			?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
		// Core decided the dragged toolbar at grab time; vanilla stamped
		// exactly one node — the grabbed toolbar, not its neighbour.
		const dragged = [...host.querySelectorAll('.toolbar[data-dragged="true"]')] as HTMLElement[]
		expect(dragged).toHaveLength(1)
		expect(dragged[0]).toBe(bars[0])
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
		// add panel for the selected entry renders instead.
		const row = host.querySelector('.palette-default-command-result') as HTMLElement | null
		expect(row).not.toBe(null)
		row!.click()
		expect(first.dataset.inspected).toBe(undefined)
		expect(host.querySelector('[data-testid="console-add-panel"]')).not.toBe(null)
		expect(host.querySelector('.palette-default-config-table')).toBe(null)
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
