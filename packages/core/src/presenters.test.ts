import { describe, expect, it } from 'vitest'
import type { EditorRegistry } from './editors.js'
import type { SurfaceContext } from './layout.js'
import {
	axisForRegion,
	buttonPresenter,
	configuratorEditorCleanup,
	configuratorModel,
	configuratorTextPatch,
	configuratorTonePatch,
	drawerChildAxis,
	drawerChildRegion,
	enumFromDisplayKey,
	headMeta,
	headTooltip,
	isPresenterDrawerItem,
	resolveEditorVariant,
	selectPresenter,
	sliderPresenter,
	stashPressedState,
	statusPresenter,
	togglePresenter,
} from './presenters.js'

const surface: SurfaceContext = { axis: 'horizontal', region: 'top' }

const registry: EditorRegistry = {
	boolean: {
		toggle: { id: 'toggle', label: 'Toggle', families: ['boolean'], compact: true },
	},
	number: {
		slider: { id: 'slider', label: 'Slider', families: ['number'], supportedAxes: 'horizontal' },
		stepper: { id: 'stepper', label: 'Stepper', families: ['number'], compact: true },
	},
	enum: {
		select: { id: 'select', label: 'Select', families: ['enum'], compact: true },
	},
	action: {
		button: { id: 'button', label: 'Button', families: ['action'] },
	},
}

describe('axisForRegion / drawer rules', () => {
	it('maps regions to axes (undefined → horizontal)', () => {
		expect(axisForRegion('top')).toBe('horizontal')
		expect(axisForRegion('bottom')).toBe('horizontal')
		expect(axisForRegion('left')).toBe('vertical')
		expect(axisForRegion('right')).toBe('vertical')
		expect(axisForRegion(undefined)).toBe('horizontal')
	})

	it('inverts the axis for drawer children', () => {
		expect(drawerChildAxis('horizontal')).toBe('vertical')
		expect(drawerChildAxis('vertical')).toBe('horizontal')
		expect(drawerChildRegion('vertical')).toBe('left')
		expect(drawerChildRegion('horizontal')).toBe('top')
	})
})

describe('resolveEditorVariant', () => {
	it('follows explicit → default → first-eligible', () => {
		const point = { id: 'n', label: 'N', type: 'number' } as const
		expect(resolveEditorVariant(point, surface, registry, { number: 'stepper' }, undefined)).toBe(
			'stepper'
		)
		expect(resolveEditorVariant(point, surface, registry, undefined, undefined)).toBe('slider')
		expect(resolveEditorVariant(point, surface, registry, undefined, 'stepper')).toBe('stepper')
	})

	it('falls back when the explicit editor is ineligible for the surface', () => {
		const point = { id: 'n', label: 'N', type: 'number' } as const
		const vertical: SurfaceContext = { axis: 'vertical', region: 'left' }
		// `slider` is horizontal-only → compact `stepper` wins.
		expect(resolveEditorVariant(point, vertical, registry, undefined, 'slider')).toBe('stepper')
	})

	it('returns undefined with no eligible variant', () => {
		expect(resolveEditorVariant(undefined, surface, {}, undefined, undefined)).toBeUndefined()
	})
})

describe('headMeta / headTooltip', () => {
	it('reads config with defaults', () => {
		expect(headMeta({ tool: 'a' })).toMatchObject({ label: 'a', tone: 'neutral' })
		expect(
			headMeta({ tool: 'a', config: { label: 'A', tone: 'accent', icon: 'x', hint: 'h' } })
		).toMatchObject({ label: 'A', tone: 'accent', icon: 'x', hint: 'h' })
		expect(headTooltip({ tool: 'a' }, 'hint')).toBe('a · hint')
	})
})

describe('buttonPresenter / togglePresenter / statusPresenter', () => {
	it('builds action view-models with run specs', () => {
		const view = buttonPresenter(
			{ tool: 'save' },
			{ point: { id: 'save', label: 'Save', type: 'action', run: () => {} }, value: undefined },
			'save'
		)
		expect(view).toMatchObject({ label: 'save', can: true, run: 'save' })
		const disabled = buttonPresenter(
			{ tool: 'save' },
			{
				point: { id: 'save', label: 'Save', type: 'action', run: () => {}, can: () => false },
				value: undefined,
			},
			'save'
		)
		expect(disabled.can).toBe(false)
	})

	it('builds toggle view-models with toggle specs', () => {
		const on = togglePresenter(
			{ tool: 'flag' },
			{ point: { id: 'flag', label: 'Flag', type: 'boolean' }, value: true }
		)
		expect(on).toMatchObject({ pressed: true, toggle: 'flag=false' })
		const off = togglePresenter(
			{ tool: 'flag' },
			{ point: { id: 'flag', label: 'Flag', type: 'boolean' }, value: false }
		)
		expect(off.toggle).toBe('flag=true')
		const skeleton = togglePresenter(
			{ tool: 'flag' },
			{ point: { id: 'flag', label: 'Flag', type: 'boolean' }, value: undefined }
		)
		expect(skeleton.pressed).toBeUndefined()
	})

	it('builds status view-models from config', () => {
		expect(statusPresenter({ editor: 'status', config: { value: 'ok' } }).value).toBe('ok')
		expect(statusPresenter({ editor: 'status' }).value).toBe('status')
	})
})

describe('selectPresenter / sliderPresenter', () => {
	it('resolves current icon/value + options with select specs', () => {
		const view = selectPresenter(
			{ tool: 'theme' },
			{
				point: {
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [
							{ value: 'light', label: 'Light' },
							{ value: 'dark', label: 'Dark', can: false },
						],
					},
				},
				value: 'dark',
			},
			surface
		)
		expect(view.value).toBe('dark')
		expect(view.options).toHaveLength(2)
		expect(view.options[1]?.can).toBe(false)
		expect(view.select('light')).toBe('theme=light')
		const skeleton = selectPresenter(
			{ tool: 'theme' },
			{
				point: {
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: { options: [{ value: 'light' }, { value: 'dark' }] },
				},
				value: undefined,
			},
			surface
		)
		expect(skeleton.value).toBeUndefined()
		const nonString = selectPresenter(
			{ tool: 'theme' },
			{
				point: {
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: { options: [{ value: 'light' }, { value: 'dark' }] },
				},
				value: 42,
			},
			surface
		)
		expect(nonString.value).toBeUndefined()
	})

	it('resolves bounds with defaults', () => {
		const view = sliderPresenter(
			{ tool: 'n' },
			{
				point: {
					id: 'n',
					label: 'N',
					type: 'number',
					constraints: { min: 1, max: 10, step: 2 },
				},
				value: 5,
			},
			surface
		)
		expect(view).toMatchObject({ min: 1, max: 10, step: 2, value: 5 })
		const bare = sliderPresenter({ tool: 'n' }, { point: undefined, value: undefined }, surface)
		expect(bare).toMatchObject({ min: 0, max: 100, step: 1, value: undefined })
		const nonNumber = sliderPresenter(
			{ tool: 'n' },
			{ point: { id: 'n', label: 'N', type: 'number' }, value: 'x' },
			surface
		)
		expect(nonNumber.value).toBeUndefined()
	})

	it('exposes a formatted value readout', () => {
		const view = sliderPresenter(
			{ tool: 'n' },
			{ point: { id: 'n', label: 'N', type: 'number' }, value: 1.5 },
			surface
		)
		expect(view.text).toBe('1.5')
		expect(view.showValue).toBe(true)
		const skeleton = sliderPresenter(
			{ tool: 'n' },
			{ point: { id: 'n', label: 'N', type: 'number' }, value: undefined },
			surface
		)
		expect(skeleton.text).toBe('')
	})

	it('hides the slider readout on `config.showValue === false`', () => {
		const point = { id: 'n', label: 'N', type: 'number' as const }
		expect(
			sliderPresenter({ tool: 'n', config: { showValue: false } }, { point, value: 1 }, surface)
				.showValue
		).toBe(false)
		expect(
			sliderPresenter(
				{ tool: 'n', editor: 'drawerSlider', config: { showValue: false } },
				{ point, value: 1 },
				surface
			).showValue
		).toBe(false)
		// Any other value (including absent) keeps the readout.
		expect(
			sliderPresenter({ tool: 'n', config: { showValue: true } }, { point, value: 1 }, surface)
				.showValue
		).toBe(true)
	})

	it('defaults the range layout to inline on both axes', () => {
		const point = { id: 'n', label: 'N', type: 'number' as const }
		expect(
			sliderPresenter({ tool: 'n' }, { point, value: 1 }, { axis: 'horizontal', region: 'top' })
				.variant
		).toBe('inline')
		expect(
			sliderPresenter({ tool: 'n' }, { point, value: 1 }, { axis: 'vertical', region: 'left' })
				.variant
		).toBe('inline')
	})

	it('runs the range along the toolbar axis inline, perpendicular in a drawer', () => {
		const point = { id: 'n', label: 'N', type: 'number' as const }
		const axes = (item: Record<string, unknown>, axis: 'horizontal' | 'vertical') => {
			const view = sliderPresenter(
				{ tool: 'n', ...item },
				{ point, value: 1 },
				{
					axis,
					region: axis === 'vertical' ? 'left' : 'top',
				}
			)
			return [view.variant, view.rangeAxis]
		}
		// Inline follows the toolbar axis.
		expect(axes({}, 'horizontal')).toEqual(['inline', 'horizontal'])
		expect(axes({}, 'vertical')).toEqual(['inline', 'vertical'])
		// Drawer uses the perpendicular axis, so it never looks inline.
		expect(axes({ editor: 'drawerSlider' }, 'horizontal')).toEqual(['drawer', 'vertical'])
		expect(axes({ editor: 'drawerSlider' }, 'vertical')).toEqual(['drawer', 'horizontal'])
	})

	it('honours the drawerSlider editor and an explicit sliderVariant config', () => {
		const point = { id: 'n', label: 'N', type: 'number' as const }
		expect(
			sliderPresenter(
				{ tool: 'n', editor: 'drawerSlider' },
				{ point, value: 1 },
				{ axis: 'horizontal', region: 'top' }
			).variant
		).toBe('drawer')
		expect(
			sliderPresenter(
				{ tool: 'n', config: { sliderVariant: 'drawer' } },
				{ point, value: 1 },
				{ axis: 'horizontal', region: 'top' }
			).variant
		).toBe('drawer')
		// The editor id is the configurator's own choice, so it wins over a
		// stale `sliderVariant` left in config.
		expect(
			sliderPresenter(
				{ tool: 'n', editor: 'slider', config: { sliderVariant: 'drawer' } },
				{ point, value: 1 },
				{ axis: 'horizontal', region: 'top' }
			).variant
		).toBe('inline')
		expect(
			sliderPresenter(
				{ tool: 'n', editor: 'drawerSlider', config: { sliderVariant: 'inline' } },
				{ point, value: 1 },
				{ axis: 'horizontal', region: 'top' }
			).variant
		).toBe('drawer')
	})

	it('splits select option icon/label for axis-aware rendering', () => {
		const view = selectPresenter(
			{ tool: 'theme' },
			{
				point: {
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: {
						options: [{ value: 'mars', label: 'Mars', icon: '🔴' }, { value: 'void' }],
					},
				},
				value: 'mars',
			},
			surface
		)
		expect(view.options[0]).toMatchObject({
			value: 'mars',
			icon: '🔴',
			label: 'Mars',
			text: '🔴 Mars',
		})
		// No icon declared → icon is undefined, label falls back to the value.
		expect(view.options[1]).toMatchObject({ value: 'void', icon: undefined, label: 'void' })
		// `choiceDisplay: 'icon'` hides the label; `'text'` hides the icon.
		const iconOnly = selectPresenter(
			{ tool: 'theme', config: { choiceDisplay: 'icon' } },
			{
				point: {
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: { options: [{ value: 'mars', label: 'Mars', icon: '🔴' }] },
				},
				value: 'mars',
			},
			surface
		)
		expect(iconOnly.options[0]).toMatchObject({ icon: '🔴', label: undefined })
		const textOnly = selectPresenter(
			{ tool: 'theme', config: { choiceDisplay: 'text' } },
			{
				point: {
					id: 'theme',
					label: 'Theme',
					type: 'enum',
					constraints: { options: [{ value: 'mars', label: 'Mars', icon: '🔴' }] },
				},
				value: 'mars',
			},
			surface
		)
		expect(textOnly.options[0]).toMatchObject({ icon: undefined, label: 'Mars' })
	})

	it('reports the region so overlays can pick their side', () => {
		const view = selectPresenter(
			{ tool: 'theme' },
			{ point: { id: 'theme', label: 'T', type: 'enum' }, value: 'x' },
			{ axis: 'vertical', region: 'left' }
		)
		expect(view.region).toBe('left')
		expect(view.direction).toBe('vertical')
	})

	it('shows segmented labels by default, hides them on `config.showText === false`', () => {
		const point = { id: 'theme', label: 'T', type: 'enum' as const }
		expect(selectPresenter({ tool: 'theme' }, { point, value: 'x' }, surface).showText).toBe(true)
		expect(
			selectPresenter(
				{ tool: 'theme', config: { showText: false } },
				{ point, value: 'x' },
				surface
			).showText
		).toBe(false)
		expect(
			selectPresenter({ tool: 'theme', config: { showText: true } }, { point, value: 'x' }, surface)
				.showText
		).toBe(true)
	})
})

describe('configuratorModel + patches', () => {
	it('builds pure configurator view-models', () => {
		expect(configuratorModel({ tool: 'a', editor: 'toggle' })).toMatchObject({
			editor: 'toggle',
			removable: true,
		})
		expect(configuratorTextPatch('label', 'A')).toEqual({ label: 'A' })
		expect(configuratorTonePatch('accent')).toEqual({ tone: 'accent' })
		expect(configuratorTonePatch('x')).toEqual({ tone: 'neutral' })
		expect(configuratorEditorCleanup('select')).toEqual(['showValue', 'showText'])
		expect(configuratorEditorCleanup('segmented')).toEqual(['showValue'])
		expect(configuratorEditorCleanup('slider')).toEqual([
			'values',
			'keywords',
			'choiceDisplay',
			'showText',
		])
		expect(configuratorEditorCleanup('drawerSlider')).toEqual([
			'values',
			'keywords',
			'choiceDisplay',
			'showText',
		])
		expect(configuratorEditorCleanup('button')).toEqual([
			'values',
			'keywords',
			'choiceDisplay',
			'showValue',
			'showText',
		])
	})
})

describe('enum-from / stash display helpers', () => {
	it('resolves display keys and pressed state', () => {
		expect(
			enumFromDisplayKey(
				[
					{ key: 'slow', value: 0.5 },
					{ key: 'fast', value: 2 },
				],
				2
			)
		).toBe('fast')
		expect(enumFromDisplayKey([{ key: 'slow', value: 0.5 }], 9)).toBeUndefined()
		expect(stashPressedState(0, 0)).toBe(true)
		expect(stashPressedState(1, 0)).toBe(false)
	})

	it('detects drawer items', () => {
		expect(isPresenterDrawerItem({ editor: 'drawer', toolbar: [] })).toBe(true)
		expect(isPresenterDrawerItem({ tool: 'a' })).toBe(false)
	})
})
