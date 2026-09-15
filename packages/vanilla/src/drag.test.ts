/**
 * `@palettable/vanilla` — slide math + add-item builder probes.
 *
 * `clampSlideDelta` is pure arithmetic (no DOM): clamp the pointer into the
 * free span, return the shift from resting. `itemFromAddSelection` builds a
 * `ToolbarItem` from a console add-flow selection without touching layout.
 */
import { describe, expect, it } from 'vitest'
import { itemFromAddSelection } from './add-item.js'
import { clampSlideDelta } from './slide.js'

describe('clampSlideDelta', () => {
	const bounds = { start: 100, available: 200 }
	it('returns the shift from resting inside the span', () => {
		// Resting at 40 inside the span; pointer 40px further along.
		expect(clampSlideDelta(bounds, 40, 180, 0)).toBe(40)
	})
	it('clamps at both ends of the free span', () => {
		expect(clampSlideDelta(bounds, 40, -1000, 0)).toBe(-40)
		expect(clampSlideDelta(bounds, 40, 10000, 0)).toBe(160)
	})
	it('accounts for the grab offset', () => {
		expect(clampSlideDelta(bounds, 40, 190, 10)).toBe(40)
	})
})

describe('itemFromAddSelection', () => {
	const points = [
		{ id: 'lamp', label: 'Lamp', type: 'boolean', defaultValue: false },
		{
			id: 'speed',
			label: 'Speed',
			type: 'number',
			defaultValue: 1,
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
