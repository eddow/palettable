/**
 * `@palettable/vanilla` — slide measuring + add-item builder probes.
 *
 * `clampSlideDelta` lives in core (the single copy of the slide arithmetic);
 * `itemFromAddSelection` builds a `ToolbarItem` from a
 * console add-flow selection without touching layout.
 */

import { describe, expect, it } from 'vitest'
import { itemFromAddSelection } from './add-item.js'
import { extractionGrabOffset, toolbarSlideBounds } from './slide.js'

function slotWithNeighbours(options: {
	before: { left: number; right: number }
	after: { left: number; right: number }
	toolbar: { left: number; width: number }
}): HTMLElement {
	// Real track structure: track > [gap, slot > toolbar, gap] — the gaps
	// are the *slot's* siblings, not the toolbar's.
	const track = document.createElement('div')
	const slot = document.createElement('div')
	const before = document.createElement('div')
	const after = document.createElement('div')
	const toolbar = document.createElement('div')
	// jsdom has no layout: stub the three measured rects. `getBoundingClientRect`
	// is an own-property assignment (no prototype patching).
	const rectOf = (rect: { left: number; top: number; right: number; bottom: number }) =>
		function (this: Element) {
			return {
				...rect,
				x: rect.left,
				y: rect.top,
				width: rect.right - rect.left,
				height: rect.bottom - rect.top,
				toJSON: () => ({}),
			}
		}
	Object.defineProperty(before, 'getBoundingClientRect', {
		value: rectOf({ left: options.before.left, top: 0, right: options.before.right, bottom: 0 }),
		configurable: true,
	})
	Object.defineProperty(after, 'getBoundingClientRect', {
		value: rectOf({ left: 0, top: 0, right: options.after.right, bottom: 0 }),
		configurable: true,
	})
	Object.defineProperty(toolbar, 'getBoundingClientRect', {
		value: rectOf({
			left: options.toolbar.left,
			top: 0,
			right: options.toolbar.left + options.toolbar.width,
			bottom: 20,
		}),
		configurable: true,
	})
	slot.append(toolbar)
	track.append(before, slot, after)
	return toolbar
}

describe('toolbarSlideBounds', () => {
	// Leading gap starts at 0, trailing gap ends at 300, toolbar 60 wide:
	// free span 300 − 60 = 240.
	const span = { before: { left: 0, right: 0 }, after: { left: 0, right: 300 } }
	it('measures the resting span from the live gap edges', () => {
		const bar = slotWithNeighbours({ ...span, toolbar: { left: 100, width: 60 } })
		expect(toolbarSlideBounds(bar, 'horizontal')).toEqual({ start: 0, available: 240 })
	})
	it('follows the live edge when the leading neighbour grows (lit merge DZ)', () => {
		// The neighbour's lit DZ widened its toolbar by 8px, pushing the
		// leading gap's left edge to 8 — no guessing, the edge moved.
		const bar = slotWithNeighbours({
			before: { left: 8, right: 0 },
			after: { left: 0, right: 300 },
			toolbar: { left: 108, width: 60 },
		})
		expect(toolbarSlideBounds(bar, 'horizontal')).toEqual({ start: 8, available: 232 })
	})
	it('follows the live edge when the trailing neighbour grows', () => {
		const bar = slotWithNeighbours({
			before: { left: 0, right: 0 },
			after: { left: 0, right: 292 },
			toolbar: { left: 100, width: 60 },
		})
		expect(toolbarSlideBounds(bar, 'horizontal')).toEqual({ start: 0, available: 232 })
	})
})

describe('extractionGrabOffset', () => {
	// Fresh singleton toolbar at left 200, width 60; the dragged button
	// sits at left 210 (10px inside the toolbar); mousedown was 5px
	// inside the button → grab = 10 + 5 = 15 (pointer stays on the icon).
	const toolbarAt = (left: number, width: number) =>
		({
			getBoundingClientRect: () => ({ left, top: 0, width, height: 20 }),
		}) as unknown as HTMLElement
	const buttonAt = (left: number, width: number) =>
		({
			getBoundingClientRect: () => ({ left, top: 0, width, height: 20 }),
		}) as unknown as HTMLElement
	it('adds the intra-button offset to the button fresh offset', () => {
		expect(
			extractionGrabOffset({
				toolbarElement: toolbarAt(200, 60),
				buttonElement: buttonAt(210, 40),
				buttonGrab: { x: 5, y: 0 },
				direction: 'horizontal',
			})
		).toBe(15)
	})
	it('falls back to the middle when the button is unmeasurable', () => {
		expect(
			extractionGrabOffset({
				toolbarElement: toolbarAt(200, 60),
				buttonElement: undefined,
				buttonGrab: { x: 5, y: 0 },
				direction: 'horizontal',
			})
		).toBe(30)
	})
	it('falls back to the middle when the offset lands outside the toolbar', () => {
		expect(
			extractionGrabOffset({
				toolbarElement: toolbarAt(200, 60),
				buttonElement: buttonAt(500, 40),
				buttonGrab: { x: 5, y: 0 },
				direction: 'horizontal',
			})
		).toBe(30)
	})
})

describe('itemFromAddSelection', () => {
	const points = [
		{ id: 'lamp', label: 'Lamp', type: 'boolean' },
		{
			id: 'speed',
			label: 'Speed',
			type: 'number',
			constraints: { min: 0, max: 10, step: 1 },
		},
	] as never[]
	it('builds a tool item from a set variant (bare tool id — no =value preset)', () => {
		const item = itemFromAddSelection(
			{
				source: { id: 'tool:speed', kind: 'tool', toolId: 'speed', label: 'Speed', meta: '' },
				variant: {
					id: 'tool:speed:set',
					kind: 'set',
					toolId: 'speed',
					label: 'Speed (editor)',
					meta: '',
					valueType: 'number',
					spec: 'speed',
				},
				booleanValue: 'true',
				setValue: '7',
			},
			points as never
		)
		// The draft binds the point and displays the live value — the
		// inline `setValue` is ignored (no `=value` preset is carried).
		expect(item).toMatchObject({ tool: 'speed' })
	})
	it('builds an editor-only item from an item variant', () => {
		const item = itemFromAddSelection(
			{
				source: { id: 'item:status', kind: 'item', editor: 'status', label: 'Status', meta: '' },
				variant: {
					id: 'item:status:item',
					kind: 'item',
					editor: 'status',
					label: 'Status',
					meta: '',
				},
				booleanValue: 'true',
				setValue: '',
			},
			points as never
		)
		expect(item).toMatchObject({ editor: 'status' })
	})
	it('returns undefined for mismatched families', () => {
		const item = itemFromAddSelection(
			{
				source: { id: 'tool:lamp', kind: 'tool', toolId: 'lamp', label: 'Lamp', meta: '' },
				variant: {
					id: 'tool:lamp:set',
					kind: 'set',
					toolId: 'lamp',
					label: 'Lamp (editor)',
					meta: '',
					valueType: 'number',
					spec: 'lamp',
				},
				booleanValue: 'true',
				setValue: '3',
			},
			points as never
		)
		expect(item).toBeUndefined()
	})
})
