import { describe, expect, it } from 'vitest'
import { resolveItemPlacementTarget } from '$lib/palette/edition.svelte'
import type { PaletteBorders, PaletteRegion, PaletteToolbarItem } from '$lib/palette/types'

// Verbatim port of `ui/src/palette/item-movement.spec.ts`: `resolveItemPlacementTarget`
// already lives in `palette.svelte.ts` (Phase 3); this file locks its contract in place
// as part of the Phase 5 definition of done.
describe('resolveItemPlacementTarget', () => {
	const createBorders = (config: Record<PaletteRegion, PaletteToolbarItem[][]>): PaletteBorders => {
		return {
			top: config.top.map((toolbar) => [{ space: 0, toolbar }]),
			right: config.right.map((toolbar) => [{ space: 0, toolbar }]),
			bottom: config.bottom.map((toolbar) => [{ space: 0, toolbar }]),
			left: config.left.map((toolbar) => [{ space: 0, toolbar }]),
		}
	}

	const item: PaletteToolbarItem = { tool: 'test' }

	describe('same-toolbar moves', () => {
		it('moves forward within the same toolbar', () => {
			const borders = createBorders({
				top: [
					[{ tool: 'a' }, { tool: 'b' }, { tool: 'c' }],
					[{ tool: 'd' }, { tool: 'e' }],
				],
				right: [],
				bottom: [],
				left: [],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 0 },
				'forward'
			)
			expect(result).toEqual({ region: 'top', trackIndex: 1 })
		})

		it('moves backward within the same toolbar', () => {
			const borders = createBorders({
				top: [
					[{ tool: 'a' }, { tool: 'b' }, { tool: 'c' }],
					[{ tool: 'd' }, { tool: 'e' }],
				],
				right: [],
				bottom: [],
				left: [],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 1 },
				'backward'
			)
			expect(result).toEqual({ region: 'top', trackIndex: 0 })
		})
	})

	describe('cross-toolbar moves', () => {
		it('moves forward from last toolbar to next region', () => {
			const borders = createBorders({
				top: [[{ tool: 'a' }]],
				right: [[{ tool: 'b' }]],
				bottom: [],
				left: [],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 0 },
				'forward'
			)
			expect(result).toEqual({ region: 'right', trackIndex: 0 })
		})

		it('moves backward from first toolbar to previous region', () => {
			const borders = createBorders({
				top: [[{ tool: 'a' }]],
				right: [[{ tool: 'b' }]],
				bottom: [],
				left: [],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'right', trackIndex: 0 },
				'backward'
			)
			expect(result).toEqual({ region: 'top', trackIndex: 0 })
		})

		it('moves forward through multiple regions', () => {
			const borders = createBorders({
				top: [[{ tool: 'a' }]],
				right: [[{ tool: 'b' }]],
				bottom: [[{ tool: 'c' }]],
				left: [],
			})

			const result1 = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 0 },
				'forward'
			)
			expect(result1).toEqual({ region: 'right', trackIndex: 0 })

			const result2 = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'right', trackIndex: 0 },
				'forward'
			)
			expect(result2).toEqual({ region: 'bottom', trackIndex: 0 })
		})

		it('wraps from last region back to first when moving backward', () => {
			const borders = createBorders({
				top: [[{ tool: 'a' }]],
				right: [[{ tool: 'b' }]],
				bottom: [[{ tool: 'c' }]],
				left: [[{ tool: 'd' }]],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'left', trackIndex: 0 },
				'backward'
			)
			expect(result).toEqual({ region: 'bottom', trackIndex: 0 })
		})
	})

	describe('edge cases', () => {
		it('returns null when moving forward from last toolbar in last region', () => {
			const borders = createBorders({
				top: [],
				right: [],
				bottom: [],
				left: [[{ tool: 'a' }]],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'left', trackIndex: 0 },
				'forward'
			)
			expect(result).toBeNull()
		})

		it('returns null when moving backward from first toolbar in first region', () => {
			const borders = createBorders({
				top: [[{ tool: 'a' }]],
				right: [],
				bottom: [],
				left: [],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 0 },
				'backward'
			)
			expect(result).toBeNull()
		})

		it('handles empty borders', () => {
			const borders = createBorders({
				top: [],
				right: [],
				bottom: [],
				left: [],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 0 },
				'forward'
			)
			expect(result).toBeNull()
		})

		it('handles multiple tracks per region', () => {
			const borders = createBorders({
				top: [[{ tool: 'a' }], [{ tool: 'b' }], [{ tool: 'c' }]],
				right: [],
				bottom: [],
				left: [],
			})

			const result1 = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 0 },
				'forward'
			)
			expect(result1).toEqual({ region: 'top', trackIndex: 1 })

			const result2 = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 1 },
				'forward'
			)
			expect(result2).toEqual({ region: 'top', trackIndex: 2 })

			const result3 = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 2 },
				'backward'
			)
			expect(result3).toEqual({ region: 'top', trackIndex: 1 })
		})

		it('handles mixed region configurations', () => {
			const borders = createBorders({
				top: [[{ tool: 'a' }], [{ tool: 'b' }]],
				right: [],
				bottom: [[{ tool: 'c' }]],
				left: [[{ tool: 'd' }], [{ tool: 'e' }]],
			})

			const result1 = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 1 },
				'forward'
			)
			expect(result1).toEqual({ region: 'bottom', trackIndex: 0 })

			const result2 = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'bottom', trackIndex: 0 },
				'forward'
			)
			expect(result2).toEqual({ region: 'left', trackIndex: 0 })

			const result3 = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'left', trackIndex: 0 },
				'backward'
			)
			expect(result3).toEqual({ region: 'bottom', trackIndex: 0 })
		})
	})

	describe('invalid inputs', () => {
		it('returns null for invalid region', () => {
			const borders = createBorders({
				top: [[{ tool: 'a' }]],
				right: [],
				bottom: [],
				left: [],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'invalid' as PaletteRegion, trackIndex: 0 },
				'forward'
			)
			expect(result).toBeNull()
		})

		it('returns null for non-existent track index', () => {
			const borders = createBorders({
				top: [[{ tool: 'a' }]],
				right: [],
				bottom: [],
				left: [],
			})

			const result = resolveItemPlacementTarget(
				borders,
				item,
				{ region: 'top', trackIndex: 99 },
				'forward'
			)
			expect(result).toBeNull()
		})
	})
})
