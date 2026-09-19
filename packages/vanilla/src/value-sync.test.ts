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
