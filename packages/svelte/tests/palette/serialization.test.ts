import { mount } from 'svelte'
import { describe, expect, it } from 'vitest'
import {
	findOwnershipViolations,
	hydratePaletteLayout,
	itemFingerprint,
	Palette,
	serializePaletteLayout,
	validatePaletteLayout,
} from '$lib/palette/edition.svelte'
import type { PaletteBorders, SerializedPaletteLayout } from '$lib/palette/types'
import HydratedBordersProbe from './HydratedBordersProbe.svelte'

describe('Palette Layout Serialization', () => {
	// Helper to create a minimal palette for testing
	function createTestPalette(): Palette {
		return new Palette({
			tools: {
				testTool: {
					type: 'boolean',
					value: false,
					default: false,
					label: 'Test Tool',
				},
				anotherTool: {
					type: 'number',
					value: 10,
					default: 10,
					label: 'Another Tool',
				},
			},
			keys: { bindings: {}, findByTool: () => [], resolve: () => undefined },
			editors: {
				boolean: {
					editor: (() => {}) as never,
				},
				number: {
					editor: (() => {}) as never,
				},
				item: {
					editorOnly: {
						editor: (() => {}) as never,
					},
				},
			} as never,
		})
	}

	// Helper to create test borders
	function createTestBorders(): PaletteBorders {
		return {
			top: [
				[
					{
						space: 0.1,
						toolbar: [
							{
								tool: 'testTool',
								editor: 'boolean',
								config: { icon: '🔔', label: 'Test' },
							},
						],
					},
				],
			],
			right: [],
			bottom: [
				[
					{
						space: 0.5,
						toolbar: [
							{
								tool: 'anotherTool',
								editor: 'number',
							},
							{
								editor: 'editorOnly',
								config: { label: 'Editor Only Item' },
							},
						],
					},
				],
			],
			left: [],
		}
	}

	describe('serializePaletteLayout', () => {
		it('should serialize a palette border layout to a stable format', () => {
			const borders = createTestBorders()
			const serialized = serializePaletteLayout(borders)

			expect(serialized).toEqual({
				version: 1,
				borders: {
					top: [
						{
							space: 0.1,
							toolbar: [
								{
									tool: 'testTool',
									editor: 'boolean',
									config: { icon: '🔔', label: 'Test' },
								},
							],
						},
					],
					right: [],
					bottom: [
						{
							space: 0.5,
							toolbar: [
								{
									tool: 'anotherTool',
									editor: 'number',
								},
								{
									editor: 'editorOnly',
									config: { label: 'Editor Only Item' },
								},
							],
						},
					],
					left: [],
				},
			})
		})

		it('should handle empty borders', () => {
			const borders: PaletteBorders = {
				top: [],
				right: [],
				bottom: [],
				left: [],
			}

			const serialized = serializePaletteLayout(borders)

			expect(serialized).toEqual({
				version: 1,
				borders: {
					top: [],
					right: [],
					bottom: [],
					left: [],
				},
			})
		})

		it('should handle complex multi-track layout', () => {
			const borders: PaletteBorders = {
				top: [
					[
						{
							space: 0.1,
							toolbar: [{ tool: 'testTool' }],
						},
						{
							space: 0.2,
							toolbar: [{ tool: 'anotherTool' }],
						},
					],
					[
						{
							space: 0.3,
							toolbar: [{ editor: 'editorOnly' }],
						},
					],
				],
				right: [],
				bottom: [],
				left: [],
			}

			const serialized = serializePaletteLayout(borders)

			expect(serialized.borders.top).toHaveLength(3)
			expect(serialized.borders.top[0].space).toBe(0.1)
			expect(serialized.borders.top[1].space).toBe(0.2)
			expect(serialized.borders.top[2].space).toBe(0.3)
		})
	})

	describe('validatePaletteLayout', () => {
		it('should validate a correct serialized layout', () => {
			const validLayout: SerializedPaletteLayout = {
				version: 1,
				borders: {
					top: [
						{
							space: 0.1,
							toolbar: [
								{
									tool: 'testTool',
									editor: 'boolean',
									config: { icon: '🔔' },
								},
							],
						},
					],
					right: [],
					bottom: [],
					left: [],
				},
			}

			expect(validatePaletteLayout(validLayout)).toBe(true)
		})

		it('should reject invalid version', () => {
			const invalidLayout = {
				version: 2,
				borders: {
					top: [],
					right: [],
					bottom: [],
					left: [],
				},
			}

			expect(validatePaletteLayout(invalidLayout)).toBe(false)
		})

		it('should reject missing borders', () => {
			const invalidLayout = {
				version: 1,
			}

			expect(validatePaletteLayout(invalidLayout)).toBe(false)
		})

		it('should reject invalid toolbar item structure', () => {
			const invalidLayout = {
				version: 1,
				borders: {
					top: [
						{
							space: 0.1,
							toolbar: [
								{
									tool: 123, // Invalid: should be string
								},
							],
						},
					],
					right: [],
					bottom: [],
					left: [],
				},
			}

			expect(validatePaletteLayout(invalidLayout)).toBe(false)
		})

		it('should reject invalid config (array instead of object)', () => {
			const invalidLayout = {
				version: 1,
				borders: {
					top: [
						{
							space: 0.1,
							toolbar: [
								{
									tool: 'testTool',
									config: [], // Invalid: should be object
								},
							],
						},
					],
					right: [],
					bottom: [],
					left: [],
				},
			}

			expect(validatePaletteLayout(invalidLayout)).toBe(false)
		})

		it('should accept valid parking', () => {
			const validLayout: SerializedPaletteLayout = {
				version: 1,
				borders: {
					top: [],
					right: [],
					bottom: [],
					left: [],
				},
				parking: [
					[
						{
							tool: 'testTool',
							editor: 'boolean',
						},
					],
				],
			}

			expect(validatePaletteLayout(validLayout)).toBe(true)
		})

		it('should reject invalid parking structure', () => {
			const invalidLayout = {
				version: 1,
				borders: {
					top: [],
					right: [],
					bottom: [],
					left: [],
				},
				parking: [
					[
						{
							tool: 123, // Invalid
						},
					],
				],
			}

			expect(validatePaletteLayout(invalidLayout)).toBe(false)
		})
	})

	describe('hydratePaletteLayout', () => {
		it('should hydrate a serialized layout into reactive borders', () => {
			const palette = createTestPalette()
			const serialized: SerializedPaletteLayout = {
				version: 1,
				borders: {
					top: [
						{
							space: 0.1,
							toolbar: [
								{
									tool: 'testTool',
									editor: 'boolean',
									config: { icon: '🔔' },
								},
							],
						},
					],
					right: [],
					bottom: [],
					left: [],
				},
			}

			const hydrated = hydratePaletteLayout(palette, serialized)

			expect(hydrated.borders.top).toHaveLength(1)
			expect(hydrated.borders.top[0]).toHaveLength(1)
			expect(hydrated.borders.top[0][0].space).toBe(0.1)
			expect(hydrated.borders.top[0][0].toolbar).toHaveLength(1)
			expect(hydrated.borders.top[0][0].toolbar[0].tool).toBe('testTool')
			expect(hydrated.borders.top[0][0].toolbar[0].editor).toBe('boolean')
			expect(hydrated.borders.top[0][0].toolbar[0].config).toEqual({ icon: '🔔' })
		})

		it('should handle empty borders', () => {
			const palette = createTestPalette()
			const serialized: SerializedPaletteLayout = {
				version: 1,
				borders: {
					top: [],
					right: [],
					bottom: [],
					left: [],
				},
			}

			const hydrated = hydratePaletteLayout(palette, serialized)

			expect(hydrated.borders.top).toEqual([])
			expect(hydrated.borders.right).toEqual([])
			expect(hydrated.borders.bottom).toEqual([])
			expect(hydrated.borders.left).toEqual([])
			expect(hydrated.parking).toEqual([])
		})

		it('should produce borders reactive to structural changes', async () => {
			const palette = createTestPalette()
			const hydrated = hydratePaletteLayout(palette, {
				version: 1,
				borders: { top: [], right: [], bottom: [], left: [] },
			})
			const host = document.createElement('div')
			mount(HydratedBordersProbe, { target: host, props: { borders: hydrated.borders } })
			expect(host.textContent).toContain('tracks:0')
			hydrated.borders.top.push([{ space: 0.1, toolbar: [{ tool: 'testTool' }] }])
			await Promise.resolve()
			expect(host.textContent).toContain('tracks:1')
		})
	})

	describe('Roundtrip: serialize then hydrate', () => {
		it('should preserve structure through serialization and hydration', () => {
			const palette = createTestPalette()
			const originalBorders = createTestBorders()

			// Serialize
			const serialized = serializePaletteLayout(originalBorders)

			// Validate
			expect(validatePaletteLayout(serialized)).toBe(true)

			// Hydrate
			const hydrated = hydratePaletteLayout(palette, serialized)
			const borders = hydrated.borders

			// Verify structure is preserved
			expect(borders.top).toHaveLength(originalBorders.top.length)
			expect(borders.bottom).toHaveLength(originalBorders.bottom.length)
			expect(borders.right).toHaveLength(originalBorders.right.length)
			expect(borders.left).toHaveLength(originalBorders.left.length)

			// Verify top border content
			if (borders.top.length > 0 && originalBorders.top.length > 0) {
				expect(borders.top[0]).toHaveLength(originalBorders.top[0].length)
				if (borders.top[0].length > 0 && originalBorders.top[0].length > 0) {
					expect(borders.top[0][0].space).toBe(originalBorders.top[0][0].space)
					expect(borders.top[0][0].toolbar).toHaveLength(originalBorders.top[0][0].toolbar.length)
				}
			}

			// Verify bottom border content
			if (borders.bottom.length > 0 && originalBorders.bottom.length > 0) {
				expect(borders.bottom[0]).toHaveLength(originalBorders.bottom[0].length)
				if (borders.bottom[0].length > 0 && originalBorders.bottom[0].length > 0) {
					expect(borders.bottom[0][0].space).toBe(originalBorders.bottom[0][0].space)
					expect(borders.bottom[0][0].toolbar).toHaveLength(
						originalBorders.bottom[0][0].toolbar.length
					)
				}
			}
		})

		it('should handle complex multi-track layout roundtrip', () => {
			const palette = createTestPalette()
			const complexBorders: PaletteBorders = {
				top: [
					[
						{
							space: 0.1,
							toolbar: [{ tool: 'testTool' }],
						},
						{
							space: 0.2,
							toolbar: [{ tool: 'anotherTool' }],
						},
					],
					[
						{
							space: 0.3,
							toolbar: [{ editor: 'editorOnly' }],
						},
					],
				],
				right: [],
				bottom: [],
				left: [],
			}

			const serialized = serializePaletteLayout(complexBorders)
			const hydrated = hydratePaletteLayout(palette, serialized).borders

			expect(hydrated.top).toHaveLength(3) // 2 tracks in first border + 1 in second
			expect(hydrated.top[0][0].space).toBe(0.1)
			expect(hydrated.top[1][0].space).toBe(0.2)
			expect(hydrated.top[2][0].space).toBe(0.3)
		})
	})

	describe('parking persistence + ownership', () => {
		it('round-trips parking alongside borders', () => {
			const palette = createTestPalette()
			const borders = createTestBorders()
			const parking = [[{ tool: 'testTool', editor: 'boolean' }]]
			const serialized = serializePaletteLayout(borders, parking as never)
			expect(validatePaletteLayout(serialized)).toBe(true)
			expect(serialized.parking).toHaveLength(1)
			const hydrated = hydratePaletteLayout(palette, serialized)
			expect(hydrated.parking).toHaveLength(1)
			expect(hydrated.parking[0]).toHaveLength(1)
			expect(hydrated.borders.top[0][0].toolbar).toHaveLength(1)
		})

		it('hydrated parking shares no references with borders', () => {
			const palette = createTestPalette()
			const serialized: SerializedPaletteLayout = {
				version: 1,
				borders: {
					top: [{ space: 0, toolbar: [{ tool: 'testTool' }] }],
					right: [],
					bottom: [],
					left: [],
				},
				parking: [[{ tool: 'anotherTool' }]],
			}
			const hydrated = hydratePaletteLayout(palette, serialized)
			const borderToolbar = hydrated.borders.top[0][0].toolbar
			const parkedToolbar = hydrated.parking[0]
			expect(parkedToolbar).not.toBe(borderToolbar)
			expect(parkedToolbar[0]).not.toBe(borderToolbar[0])
			expect(
				findOwnershipViolations({ borders: hydrated.borders, parking: hydrated.parking })
			).toEqual([])
		})
	})

	describe('instance identity', () => {
		it('fingerprints canonical tool + editor + config', () => {
			expect(itemFingerprint({ tool: 'alertLevel' })).toBe(
				itemFingerprint({ tool: 'alertLevel=red' })
			)
			expect(itemFingerprint({ tool: 'alertLevel' })).toBe(
				itemFingerprint({ tool: 'alertLevel|red' })
			)
			expect(itemFingerprint({ tool: 'alertLevel' })).toBe(
				itemFingerprint({ tool: 'alertLevel:inc' })
			)
			expect(itemFingerprint({ tool: 'a', editor: 'toggle' })).not.toBe(
				itemFingerprint({ tool: 'a', editor: 'select' })
			)
			expect(itemFingerprint({ tool: 'a', config: { b: 1, a: 2 } })).toBe(
				itemFingerprint({ tool: 'a', config: { a: 2, b: 1 } })
			)
		})

		it('flags shared references and structural duplicates', () => {
			const shared = { tool: 'a' }
			const borders: PaletteBorders = {
				top: [[{ space: 0, toolbar: [shared] }]],
				right: [],
				bottom: [],
				left: [],
			}
			const parking = [[shared]]
			const violations = findOwnershipViolations({ borders, parking: parking as never })
			expect(violations.some((v) => v.includes('shared'))).toBe(true)
			expect(violations.some((v) => v.includes('duplicate'))).toBe(true)
		})
	})
})
