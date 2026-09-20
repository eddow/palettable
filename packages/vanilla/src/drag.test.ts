/**
 * `@palettable/vanilla` — slide measuring + add-item builder probes.
 *
 * `clampSlideDelta` lives in core (the single copy of the slide arithmetic);
 * `itemFromAddSelection` builds a `ToolbarItem` from a
 * console add-flow selection without touching layout.
 */

import { describe, expect, it } from 'vitest'
import { itemFromAddSelection } from './add-item.js'
import { extractionGrabOffset } from './slide.js'

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
	it('builds a tool item from a set variant', () => {
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
		expect(item).toMatchObject({ tool: 'speed=7' })
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
