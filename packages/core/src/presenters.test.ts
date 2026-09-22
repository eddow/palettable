import { describe, expect, it } from 'vitest'
import { ValuesBag } from './context.js'
import type { ControlRegistry } from './controls.js'
import type { SurfaceContext } from './layout.js'
import {
	axisForRegion,
	buttonPresenter,
	configuratorControlCleanup,
	configuratorModel,
	configuratorTextPatch,
	configuratorTonePatch,
	drawerChildAxis,
	drawerChildRegion,
	drawerOpenOf,
	enumFromDisplayKey,
	headMeta,
	headTooltip,
	isPresenterDrawerItem,
	resolveControl,
	selectClosedLabel,
	selectPresenter,
	sliderPresenter,
	stashPressedState,
	statusPresenter,
	themePresenter,
	togglePresenter,
} from './presenters.js'

const surface: SurfaceContext = { axis: 'horizontal', region: 'top' }

const registry: ControlRegistry = {
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

describe('resolveControl', () => {
	it('follows explicit → default → first-eligible', () => {
		const point = { id: 'n', label: 'N', type: 'number' } as const
		expect(resolveControl(point, surface, registry, { number: 'stepper' }, undefined)).toBe(
			'stepper'
		)
		expect(resolveControl(point, surface, registry, undefined, undefined)).toBe('slider')
		expect(resolveControl(point, surface, registry, undefined, 'stepper')).toBe('stepper')
	})

	it('falls back when the explicit control is ineligible for the surface', () => {
		const point = { id: 'n', label: 'N', type: 'number' } as const
		const vertical: SurfaceContext = { axis: 'vertical', region: 'left' }
		// `slider` is horizontal-only → compact `stepper` wins.
		expect(resolveControl(point, vertical, registry, undefined, 'slider')).toBe('stepper')
	})

	it('returns undefined with no eligible control', () => {
		expect(resolveControl(undefined, surface, {}, undefined, undefined)).toBeUndefined()
	})
})

describe('headMeta / headTooltip', () => {
	it('reads config with defaults', () => {
		expect(headMeta({ point: 'a' })).toMatchObject({ label: 'a', tone: 'neutral' })
		expect(
			headMeta({ point: 'a', config: { label: 'A', tone: 'accent', icon: 'x', hint: 'h' } })
		).toMatchObject({ label: 'A', tone: 'accent', icon: 'x', hint: 'h' })
		expect(headTooltip({ point: 'a' }, 'hint')).toBe('a · hint')
	})
})

describe('buttonPresenter / togglePresenter / statusPresenter', () => {
	it('builds action view-models with run specs', () => {
		const view = buttonPresenter(
			{ point: 'save' },
			{ point: { id: 'save', label: 'Save', type: 'action', run: () => {} }, value: undefined },
			'save'
		)
		expect(view).toMatchObject({ label: 'save', can: true, run: 'save' })
		const disabled = buttonPresenter(
			{ point: 'save' },
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
			{ point: 'flag' },
			{ point: { id: 'flag', label: 'Flag', type: 'boolean' }, value: true }
		)
		expect(on).toMatchObject({ pressed: true, toggle: 'flag=false' })
		const off = togglePresenter(
			{ point: 'flag' },
			{ point: { id: 'flag', label: 'Flag', type: 'boolean' }, value: false }
		)
		expect(off.toggle).toBe('flag=true')
		const skeleton = togglePresenter(
			{ point: 'flag' },
			{ point: { id: 'flag', label: 'Flag', type: 'boolean' }, value: undefined }
		)
		expect(skeleton.pressed).toBeUndefined()
	})
	it('disables a context toggle on skeleton, enables it on hydration', () => {
		const point = { id: 'shipShields', label: 'Shields', type: 'boolean' as const, uses: ['ship'] }
		const bag = new ValuesBag<Record<string, unknown>>()
		const skeleton = togglePresenter(
			{ point: 'shipShields' },
			{ point, value: undefined, bags: [bag] }
		)
		expect(skeleton.can).toBe(false)
		const hydrated = togglePresenter({ point: 'shipShields' }, { point, value: true, bags: [bag] })
		expect(hydrated.can).toBe(true)
	})

	it('keeps root-only valued tools enabled on skeleton', () => {
		const point = { id: 'flag', label: 'Flag', type: 'boolean' as const }
		expect(togglePresenter({ point: 'flag' }, { point, value: undefined }).can).toBe(true)
	})

	it('lets an explicit functional can override the skeleton default', () => {
		const point = {
			id: 'shipShields',
			label: 'Shields',
			type: 'boolean' as const,
			uses: ['ship'],
			can: () => true,
		}
		expect(togglePresenter({ point: 'shipShields' }, { point, value: undefined }).can).toBe(true)
		const denied = {
			id: 'shipShields',
			label: 'Shields',
			type: 'boolean' as const,
			uses: ['ship'],
			can: () => false,
		}
		expect(togglePresenter({ point: 'shipShields' }, { point: denied, value: true }).can).toBe(
			false
		)
	})
	it('builds status view-models from context bags', () => {
		const bag = new ValuesBag({ fileName: 'a.ts' })
		const bound = statusPresenter(
			{ point: 'missionTime', control: 'status' },
			{ point: undefined, value: undefined, bags: [bag] },
			surface
		)
		expect(bound.value).toBe('a.ts')
		expect(bound.can).toBe(true)
		expect(bound.direction).toBe('horizontal')
		expect(bound.region).toBe('top')
		const absent = statusPresenter(
			{ point: 'missionTime', control: 'status' },
			{ point: undefined, value: undefined, bags: [undefined] },
			surface
		)
		expect(absent.value).toBe('missionTime')
		expect(absent.can).toBe(false)
		const named = statusPresenter(
			{ point: 'shipStatus', control: 'status', config: { statusKey: 'shipName' } },
			{
				point: undefined,
				value: undefined,
				bags: [new ValuesBag({ shipId: 'aurora', shipName: '🚀 Aurora' })],
			},
			surface
		)
		expect(named.value).toBe('🚀 Aurora')
		expect(named.can).toBe(true)
		const namedAbsent = statusPresenter(
			{ point: 'shipStatus', control: 'status', config: { statusKey: 'shipName' } },
			{ point: undefined, value: undefined, bags: [new ValuesBag({ shipId: 'aurora' })] },
			surface
		)
		expect(namedAbsent.value).toBe('shipStatus')
		expect(namedAbsent.can).toBe(true)
		const vertical = statusPresenter(
			{ point: 'missionTime', control: 'status' },
			{ point: undefined, value: undefined, bags: [bag] },
			{ axis: 'vertical', region: 'left' }
		)
		expect(vertical.direction).toBe('vertical')
		expect(vertical.region).toBe('left')
	})

	it('builds theme view-models cycling light → dark → system', () => {
		const point = {
			id: 'theme',
			label: 'Theme',
			type: 'nothing',
			options: [
				{ value: 'light', icon: '☀️', label: 'Light' },
				{ value: 'dark', icon: '🌙', label: 'Dark' },
				{ value: 'system', icon: '💻', label: 'System' },
			],
		} as const
		expect(
			themePresenter({ point: 'theme', control: 'theme' }, { point, value: 'light' })
		).toMatchObject({ value: 'light', valueIcon: '☀️', cycle: 'theme=dark' })
		expect(
			themePresenter({ point: 'theme', control: 'theme' }, { point, value: 'dark' })
		).toMatchObject({ value: 'dark', valueIcon: '🌙', cycle: 'theme=system' })
		expect(
			themePresenter({ point: 'theme', control: 'theme' }, { point, value: 'system' })
		).toMatchObject({ value: 'system', valueIcon: '💻', cycle: 'theme=light' })
		const skeleton = themePresenter(
			{ point: 'theme', control: 'theme' },
			{ point, value: undefined }
		)
		expect(skeleton.value).toBeUndefined()
		expect(skeleton.cycle).toBe('theme=light')
	})
})

describe('selectPresenter / sliderPresenter', () => {
	it('resolves current icon/value + options with select specs', () => {
		const view = selectPresenter(
			{ point: 'theme' },
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
			{ point: 'theme' },
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
			{ point: 'theme' },
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
			{ point: 'n' },
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
		const bare = sliderPresenter({ point: 'n' }, { point: undefined, value: undefined }, surface)
		expect(bare).toMatchObject({ min: 0, max: 100, step: 1, value: undefined })
		const nonNumber = sliderPresenter(
			{ point: 'n' },
			{ point: { id: 'n', label: 'N', type: 'number' }, value: 'x' },
			surface
		)
		expect(nonNumber.value).toBeUndefined()
	})

	it('disables a context slider on skeleton, enables it on hydration', () => {
		const point = { id: 'shipPower', label: 'Reactor', type: 'number' as const, uses: ['ship'] }
		const bag = new ValuesBag<Record<string, unknown>>()
		expect(
			sliderPresenter({ point: 'shipPower' }, { point, value: undefined, bags: [bag] }, surface).can
		).toBe(false)
		expect(
			sliderPresenter({ point: 'shipPower' }, { point, value: 3, bags: [bag] }, surface).can
		).toBe(true)
	})

	it('disables a context select on skeleton, enables it on hydration', () => {
		const point = {
			id: 'shipMode',
			label: 'Mode',
			type: 'enum' as const,
			uses: ['ship'],
			constraints: { options: [{ value: 'a' }, { value: 'b' }] },
		}
		const bag = new ValuesBag<Record<string, unknown>>()
		expect(
			selectPresenter({ point: 'shipMode' }, { point, value: undefined, bags: [bag] }, surface).can
		).toBe(false)
		expect(
			selectPresenter({ point: 'shipMode' }, { point, value: 'a', bags: [bag] }, surface).can
		).toBe(true)
	})

	it('exposes a formatted value readout', () => {
		const view = sliderPresenter(
			{ point: 'n' },
			{ point: { id: 'n', label: 'N', type: 'number' }, value: 1.5 },
			surface
		)
		expect(view.text).toBe('1.5')
		expect(view.showValue).toBe(true)
		const skeleton = sliderPresenter(
			{ point: 'n' },
			{ point: { id: 'n', label: 'N', type: 'number' }, value: undefined },
			surface
		)
		expect(skeleton.text).toBe('')
	})

	it('hides the slider readout on `config.showValue === false`', () => {
		const point = { id: 'n', label: 'N', type: 'number' as const }
		expect(
			sliderPresenter({ point: 'n', config: { showValue: false } }, { point, value: 1 }, surface)
				.showValue
		).toBe(false)
		expect(
			sliderPresenter(
				{ point: 'n', control: 'drawerSlider', config: { showValue: false } },
				{ point, value: 1 },
				surface
			).showValue
		).toBe(false)
		// Any other value (including absent) keeps the readout.
		expect(
			sliderPresenter({ point: 'n', config: { showValue: true } }, { point, value: 1 }, surface)
				.showValue
		).toBe(true)
	})

	it('defaults the range layout to inline on both axes', () => {
		const point = { id: 'n', label: 'N', type: 'number' as const }
		expect(
			sliderPresenter({ point: 'n' }, { point, value: 1 }, { axis: 'horizontal', region: 'top' })
				.variant
		).toBe('inline')
		expect(
			sliderPresenter({ point: 'n' }, { point, value: 1 }, { axis: 'vertical', region: 'left' })
				.variant
		).toBe('inline')
	})

	it('runs the range along the toolbar axis inline, perpendicular in a drawer', () => {
		const point = { id: 'n', label: 'N', type: 'number' as const }
		const axes = (item: Record<string, unknown>, axis: 'horizontal' | 'vertical') => {
			const view = sliderPresenter(
				{ point: 'n', ...item },
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
		expect(axes({ control: 'drawerSlider' }, 'horizontal')).toEqual(['drawer', 'vertical'])
		expect(axes({ control: 'drawerSlider' }, 'vertical')).toEqual(['drawer', 'horizontal'])
	})

	it('honours the drawerSlider control and an explicit sliderVariant config', () => {
		const point = { id: 'n', label: 'N', type: 'number' as const }
		expect(
			sliderPresenter(
				{ point: 'n', control: 'drawerSlider' },
				{ point, value: 1 },
				{ axis: 'horizontal', region: 'top' }
			).variant
		).toBe('drawer')
		expect(
			sliderPresenter(
				{ point: 'n', config: { sliderVariant: 'drawer' } },
				{ point, value: 1 },
				{ axis: 'horizontal', region: 'top' }
			).variant
		).toBe('drawer')
		// The control id is the configurator's own choice, so it wins over a
		// stale `sliderVariant` left in config.
		expect(
			sliderPresenter(
				{ point: 'n', control: 'slider', config: { sliderVariant: 'drawer' } },
				{ point, value: 1 },
				{ axis: 'horizontal', region: 'top' }
			).variant
		).toBe('inline')
		expect(
			sliderPresenter(
				{ point: 'n', control: 'drawerSlider', config: { sliderVariant: 'inline' } },
				{ point, value: 1 },
				{ axis: 'horizontal', region: 'top' }
			).variant
		).toBe('drawer')
	})

	it('splits select option icon/label for axis-aware rendering', () => {
		const view = selectPresenter(
			{ point: 'theme' },
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
		// `showText: false` hides the label (icon-only).
		const iconOnly = selectPresenter(
			{ point: 'theme', config: { showText: false } },
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
		// Shown text keeps icon + label.
		const textShown = selectPresenter(
			{ point: 'theme' },
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
		expect(textShown.options[0]).toMatchObject({ icon: '🔴', label: 'Mars' })
	})

	it('reports the region so overlays can pick their side', () => {
		const view = selectPresenter(
			{ point: 'theme' },
			{ point: { id: 'theme', label: 'T', type: 'enum' }, value: 'x' },
			{ axis: 'vertical', region: 'left' }
		)
		expect(view.region).toBe('left')
		expect(view.direction).toBe('vertical')
	})

	it('shows segmented labels by default, hides them on `config.showText === false`', () => {
		const point = { id: 'theme', label: 'T', type: 'enum' as const }
		expect(selectPresenter({ point: 'theme' }, { point, value: 'x' }, surface).showText).toBe(true)
		expect(
			selectPresenter(
				{ point: 'theme', config: { showText: false } },
				{ point, value: 'x' },
				surface
			).showText
		).toBe(false)
		expect(
			selectPresenter(
				{ point: 'theme', config: { showText: true } },
				{ point, value: 'x' },
				surface
			).showText
		).toBe(true)
	})

	it('hides the select filter by default, shows it on `config.showFilter === true`', () => {
		const point = { id: 'theme', label: 'T', type: 'enum' as const }
		expect(selectPresenter({ point: 'theme' }, { point, value: 'x' }, surface).showFilter).toBe(
			false
		)
		expect(
			selectPresenter(
				{ point: 'theme', config: { showFilter: true } },
				{ point, value: 'x' },
				surface
			).showFilter
		).toBe(true)
		expect(
			selectPresenter(
				{ point: 'theme', config: { showFilter: false } },
				{ point, value: 'x' },
				surface
			).showFilter
		).toBe(false)
	})

	it('exposes raw current + full-text list rows for the select listbox', () => {
		const point = {
			id: 'theme',
			label: 'T',
			type: 'enum' as const,
			constraints: {
				options: [
					{ value: 'mars', label: 'Mars', icon: '🔴' },
					{ value: 'void', label: 'Void' },
				],
			},
		}
		const view = selectPresenter({ point: 'theme' }, { point, value: 'mars' }, surface)
		expect(view.current).toMatchObject({ value: 'mars', icon: '🔴', label: 'Mars' })
		expect(view.toolIcon).toBeUndefined()
		expect(view.icon).toBe('🔴')
		expect(
			selectPresenter({ point: 'theme', config: { icon: '🪐' } }, { point, value: 'mars' }, surface)
				.toolIcon
		).toBe('🪐')
		expect(view.listOptions).toEqual([
			{ value: 'mars', icon: '🔴', label: 'Mars', can: true },
			{ value: 'void', icon: undefined, label: 'Void', can: true },
		])
		// The list ignores `showText`: rows stay full text.
		const hidden = selectPresenter(
			{ point: 'theme', config: { showText: false } },
			{ point, value: 'mars' },
			surface
		)
		expect(hidden.listOptions).toEqual(view.listOptions)
		expect(hidden.current).toMatchObject({ value: 'mars', icon: '🔴', label: 'Mars' })
		// Unknown value / skeleton → no current.
		expect(
			selectPresenter({ point: 'theme' }, { point, value: 'nope' }, surface).current
		).toBeUndefined()
		expect(
			selectPresenter({ point: 'theme' }, { point, value: undefined }, surface).current
		).toBeUndefined()
	})

	it('derives the closed select-box label from showText', () => {
		const point = {
			id: 'theme',
			label: 'T',
			type: 'enum' as const,
			constraints: { options: [{ value: 'mars', label: 'Mars', icon: '🔴' }] },
		}
		const shown = selectPresenter({ point: 'theme' }, { point, value: 'mars' }, surface)
		expect(selectClosedLabel(shown)).toBe('Mars')
		const hidden = selectPresenter(
			{ point: 'theme', config: { showText: false } },
			{ point, value: 'mars' },
			surface
		)
		expect(selectClosedLabel(hidden)).toBeUndefined()
		// Icon-less option keeps its label so the trigger is never empty.
		const bare = selectPresenter(
			{ point: 'theme', config: { showText: false } },
			{
				point: {
					id: 'theme',
					label: 'T',
					type: 'enum' as const,
					constraints: { options: [{ value: 'void', label: 'Void' }] },
				},
				value: 'void',
			},
			surface
		)
		expect(selectClosedLabel(bare)).toBe('Void')
		expect(selectClosedLabel({ ...shown, current: undefined })).toBeUndefined()
	})
})

describe('configuratorModel + patches', () => {
	it('builds pure configurator view-models', () => {
		expect(configuratorModel({ point: 'a', control: 'toggle' })).toMatchObject({
			control: 'toggle',
			removable: true,
		})
		expect(configuratorTextPatch('label', 'A')).toEqual({ label: 'A' })
		expect(configuratorTonePatch('accent')).toEqual({ tone: 'accent' })
		expect(configuratorTonePatch('x')).toEqual({ tone: 'neutral' })
		expect(configuratorControlCleanup('select')).toEqual(['showValue'])
		expect(configuratorControlCleanup('segmented')).toEqual(['showValue', 'showFilter'])
		expect(configuratorControlCleanup('slider')).toEqual(['showText', 'showFilter'])
		expect(configuratorControlCleanup('drawerSlider')).toEqual(['showText', 'showFilter'])
		expect(configuratorControlCleanup('button')).toEqual(['showValue', 'showText', 'showFilter'])
		expect(configuratorControlCleanup('drawer')).toEqual([
			'showValue',
			'showText',
			'showFilter',
			'sliderVariant',
			'statusKey',
		])
		expect(configuratorControlCleanup('status')).toEqual([
			'showValue',
			'showText',
			'showFilter',
			'sliderVariant',
			'open',
		])
	})

	it('reads drawer open with default', () => {
		expect(drawerOpenOf({ point: 'd', control: 'drawer', toolbar: [] })).toBe('click')
		expect(
			drawerOpenOf({ point: 'd', control: 'drawer', toolbar: [], config: { open: 'hover' } })
		).toBe('hover')
		expect(
			drawerOpenOf({ point: 'd', control: 'drawer', toolbar: [], config: { open: 'press' } })
		).toBe('press')
		expect(
			drawerOpenOf({ point: 'd', control: 'drawer', toolbar: [], config: { open: 'nope' } })
		).toBe('click')
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
		expect(isPresenterDrawerItem({ point: 'drawer', control: 'drawer', toolbar: [] })).toBe(true)
		expect(isPresenterDrawerItem({ point: 'a' })).toBe(false)
	})
})
