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
		expect(configuratorEditorCleanup('select')).toEqual([])
		expect(configuratorEditorCleanup('slider')).toEqual(['values', 'keywords', 'choiceDisplay'])
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
