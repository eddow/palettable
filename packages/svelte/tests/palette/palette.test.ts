import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	isEditableTool,
	isEditing,
	isRunTool,
	Palette,
	PaletteError,
	palettes,
	paletteTool,
	paletteToolFamily,
	renderPaletteConfigurator,
	renderPaletteEditor,
	resolvePaletteEditor,
	surfaceContextFromScope,
} from '$lib/palette/edition.svelte'
import type {
	PaletteConfig,
	PaletteConfiguratorComponent,
	PaletteEditorComponent,
	PaletteToolbarItem,
} from '$lib/palette/types'

function createPalette(): Palette {
	return new Palette({
		tools: {
			reset: {
				label: 'Reset',
				get can() {
					return true
				},
				run() {},
			},
			notifications: {
				type: 'boolean',
				label: 'Notifications',
				value: false,
				default: false,
			},
			fontSize: {
				type: 'number',
				label: 'Font Size',
				value: 10,
				default: 10,
				min: 10,
				max: 12,
				step: 1,
			},
			theme: {
				type: 'enum',
				label: 'Theme',
				value: 'dark',
				default: 'dark',
				values: [
					{ value: 'light', label: 'Light', keywords: ['day'] },
					{ value: 'dark', label: 'Dark', can: false },
				],
			},
		},
		keys: {
			R: 'reset',
			N: 'notifications=true',
			'+': 'fontSize:inc',
		},
	})
}

function editableTools(palette: Palette) {
	const notifications = palette.tools.notifications
	if (!isEditableTool(notifications) || notifications.type !== 'boolean')
		throw new Error('Expected boolean notifications tool')
	const fontSize = palette.tools.fontSize
	if (!isEditableTool(fontSize) || fontSize.type !== 'number')
		throw new Error('Expected numeric fontSize tool')
	return { fontSize, notifications }
}

describe('palette engine', () => {
	afterEach(() => {
		palettes.editing = undefined
	})

	it('identifies tool families correctly', () => {
		const palette = createPalette()

		expect(isRunTool(palette.tools.reset)).toBe(true)
		expect(isEditableTool(palette.tools.reset)).toBe(false)
		expect(isEditableTool(palette.tools.notifications)).toBe(true)
		expect(paletteToolFamily(palette.tools.reset)).toBe('run')
		expect(paletteToolFamily(palette.tools.fontSize)).toBe('number')
	})

	it('resolves palette tool specs into runnable helpers', () => {
		const palette = createPalette()
		const { fontSize, notifications } = editableTools(palette)

		expect(palette.tool('reset')).toBe(palette.tools.reset)
		expect(paletteTool(palette, 'reset')).toBe(palette.tools.reset)

		const setterRunner = palette.tool('notifications=true')
		if (!isRunTool(setterRunner)) throw new Error('Expected setter runner')
		setterRunner.run()
		expect(notifications.value).toBe(true)
		setterRunner.run()
		expect(notifications.value).toBe(false)

		// Legacy `|` setter spelling still resolves (fresh runner: false → true).
		const legacySetter = palette.tool('notifications|true')
		if (!isRunTool(legacySetter)) throw new Error('Expected setter runner')
		legacySetter.run()
		expect(notifications.value).toBe(true)

		const actionRunner = palette.tool('fontSize:inc')
		if (!isRunTool(actionRunner)) throw new Error('Expected action runner')
		expect(actionRunner.can).toBe(true)
		actionRunner.run()
		expect(fontSize.value).toBe(11)
	})

	it('restores the previous editable value when the same setter is run twice', () => {
		const palette = createPalette()
		const { notifications } = editableTools(palette)
		notifications.value = true

		const setterRunner = paletteTool(palette, 'notifications=false')
		if (!isRunTool(setterRunner)) throw new Error('Expected setter runner')

		setterRunner.run()
		expect(notifications.value).toBe(false)

		setterRunner.run()
		expect(notifications.value).toBe(true)
	})

	it('exposes numeric action can state at the bounds', () => {
		const palette = createPalette()
		const { fontSize } = editableTools(palette)

		const incRunner = paletteTool(palette, 'fontSize:inc')
		if (!isRunTool(incRunner)) throw new Error('Expected increment runner')
		expect(incRunner.can).toBe(true)

		fontSize.value = 12
		expect(incRunner.can).toBe(false)
	})

	it('applies runner and setter wrappers when provided', () => {
		const runnerHook = vi.fn<(spec: string) => void>()
		const setterHook = vi.fn<(value: unknown) => void>()
		const palette = new Palette({
			...createPalette().config,
			runner(runner, _from, spec) {
				return {
					get can() {
						return runner.can
					},
					run() {
						runnerHook(spec)
						return runner.run()
					},
				}
			},
			setter(runner, _from, value) {
				return {
					get can() {
						return runner.can
					},
					run() {
						setterHook(value)
						return runner.run()
					},
				}
			},
		})

		const setterRunner = paletteTool(palette, 'notifications=true')
		if (!isRunTool(setterRunner)) throw new Error('Expected setter runner')
		setterRunner.run()
		expect(setterHook).toHaveBeenCalledWith(true)

		const actionRunner = paletteTool(palette, 'fontSize:inc=fast')
		if (!isRunTool(actionRunner)) throw new Error('Expected action runner')
		actionRunner.run()
		expect(runnerHook).toHaveBeenCalledWith('inc=fast')
	})

	it('throws palette errors for unknown tools and unsupported actions', () => {
		const palette = createPalette()

		expect(() => paletteTool(palette, 'missing')).toThrow(PaletteError)
		expect(() => paletteTool(palette, 'reset=true')).toThrow(PaletteError)
		expect(() => paletteTool(palette, 'fontSize:missing')).toThrow(PaletteError)
		expect(() => paletteTool(palette, 'theme:missing')).toThrow(PaletteError)
	})

	it('throws palette errors for unsupported editing actions', () => {
		const palette = createPalette()

		expect(() => paletteTool(palette, 'notifications:inc')).toThrow(PaletteError)
		expect(() => paletteTool(palette, 'fontSize=true')).toThrow(PaletteError)
	})

	it('resolves editor specs from item or default variant', () => {
		// Svelte port: editors are components (not JSX factories), so the
		// fixtures are stub components and assertions check identity.
		const RunEditor = (() => {}) as unknown as PaletteEditorComponent
		const palette = new Palette({
			...createPalette().config,
			editors: {
				run: {
					button: {
						editor: RunEditor,
					},
				},
			},
			editorDefaults: {
				run: 'button',
			},
		} satisfies PaletteConfig)
		const item = { tool: 'reset' } satisfies PaletteToolbarItem

		const spec = palette.resolveEditor(item, palette.tools.reset)
		expect(spec?.editor).toBe(RunEditor)
		expect(palette.renderEditor(item, palette.tools.reset, {})).toBe(RunEditor)
		expect(resolvePaletteEditor(palette, item, palette.tools.reset)).toBe(spec)
		expect(renderPaletteEditor(palette, item, palette.tools.reset, {})).toBe(RunEditor)
		expect(palette.renderConfigurator(item, palette.tools.reset, {})).toBeUndefined()
	})

	it('throws clear editor errors when variant configuration is missing or invalid', () => {
		const palette = new Palette({
			...createPalette().config,
			editors: {
				run: {
					button: {
						editor: (() => {}) as unknown as PaletteEditorComponent,
					},
				},
			},
		} satisfies PaletteConfig)

		expect(() => palette.resolveEditor({ tool: 'reset' }, palette.tools.reset)).toThrow(
			'No editor variant configured'
		)
		expect(() =>
			palette.resolveEditor({ tool: 'reset', editor: 'missing' }, palette.tools.reset)
		).toThrow('Unknown palette editor')
	})

	it('falls back to palette.editor when no registry editor is configured', () => {
		const FallbackEditor = (() => {}) as unknown as PaletteEditorComponent
		const render = vi.fn(() => FallbackEditor)
		const palette = new Palette({
			...createPalette().config,
			editor: render,
		} satisfies PaletteConfig)

		const rendered = palette.renderEditor({ tool: 'reset' }, palette.tools.reset, {})
		expect(rendered).toBe(FallbackEditor)
		expect(render).toHaveBeenCalledTimes(1)
	})

	it('renders configurators from editor specs or palette fallback', () => {
		// Svelte port: `configure` IS the component (not a factory returning JSX),
		// so `renderConfigurator` returns it directly without calling it. Only the
		// palette-level `configurator` fallback is a function and gets called.
		// Both paths share `resolveConfiguratorScope`: the fallback receives the
		// augmented scope as its `scope` argument, and adapters rendering a spec
		// component bind the same scope as `context.scope` (so
		// `scope.editorChoices` is populated at render time).
		const Configure = (() => {}) as unknown as PaletteConfiguratorComponent
		const FallbackConfigure = (() => {}) as unknown as PaletteConfiguratorComponent
		const fallback = vi.fn(() => FallbackConfigure)
		const palette = new Palette({
			...createPalette().config,
			editors: {
				run: {
					button: {
						editor: (() => {}) as unknown as PaletteEditorComponent,
						configure: Configure as never,
					},
				},
			} as never,
			editorDefaults: {
				run: 'button',
			},
			configurator: fallback,
		} satisfies PaletteConfig)

		const runItem = { tool: 'reset' } satisfies PaletteToolbarItem
		expect(palette.renderConfigurator(runItem, palette.tools.reset, {})).toBe(Configure)
		expect(renderPaletteConfigurator(palette, runItem, palette.tools.reset, {})).toBe(Configure)

		const fallbackItem = { tool: 'notifications', editor: 'missing' } as PaletteToolbarItem
		expect(palette.renderConfigurator(fallbackItem, palette.tools.notifications, {})).toBe(
			FallbackConfigure
		)
		expect(fallback).toHaveBeenCalledTimes(1)

		const fallbackPalette = new Palette({
			...createPalette().config,
			configurator: fallback,
		} satisfies PaletteConfig)
		expect(
			fallbackPalette.renderConfigurator({ tool: 'reset' }, fallbackPalette.tools.reset, {})
		).toBe(FallbackConfigure)
		expect(fallback).toHaveBeenCalledTimes(2)
	})

	it('tracks the editing palette identity', () => {
		const first = createPalette()
		const second = createPalette()

		expect(first.editing).toBe(false)
		expect(isEditing(first)).toBe(false)
		palettes.editing = first
		expect(first.editing).toBe(true)
		expect(isEditing(first)).toBe(true)
		expect(second.editing).toBe(false)
		expect(isEditing(second)).toBe(false)
	})

	it('derives editability from config instead of maintained instance state', () => {
		const popup = { open: false }
		const palette = new Palette({
			...createPalette().config,
			get editable() {
				return popup.open
			},
		} satisfies PaletteConfig)

		palettes.editing = palette
		expect(palette.editing).toBe(false)
		expect(isEditing(palette)).toBe(false)

		popup.open = true
		expect(palette.editing).toBe(true)
		expect(isEditing(palette)).toBe(true)

		popup.open = false
		expect(palette.editing).toBe(false)
		expect(isEditing(palette)).toBe(false)
	})

	it('injects editorChoices into the configurator scope on both paths', () => {
		const palette = new Palette({
			...createPalette().config,
			editors: {
				run: {
					button: {
						editor: (() => {}) as unknown as PaletteEditorComponent,
						configure: (() => {}) as unknown as PaletteConfiguratorComponent as never,
					},
				},
			} as never,
			editorDefaults: { run: 'button' },
		} satisfies PaletteConfig)
		const item = { tool: 'reset' } satisfies PaletteToolbarItem
		const scope = palette.resolveConfiguratorScope(item, {})
		expect(scope.editorChoices?.map((choice) => choice.id)).toContain('button')
		const context = palette.resolveEditorContext(item, palette.tools.reset, {})
		expect(context.surface?.axis).toBe('horizontal')
		expect(context.scope).toEqual({})
	})

	it('derives surface axis from scope region', () => {
		expect(surfaceContextFromScope({ region: 'left' }).axis).toBe('vertical')
		expect(surfaceContextFromScope({ region: 'top' }).axis).toBe('horizontal')
		expect(surfaceContextFromScope({}).axis).toBe('horizontal')
	})

	it('documents the multi-setter restore divergence from sursaut', () => {
		// Verified against `ui/src/palette/palette.ts` `setter`: sursaut's
		// `mutts.effect` deletes the stored restore value when another setter
		// overwrites it with a value equal to the first setter's target.
		// Without the effect this port keeps the stale entry.
		const palette = createPalette()
		const { fontSize } = editableTools(palette)
		const to11 = paletteTool(palette, 'fontSize=11')
		const to12 = paletteTool(palette, 'fontSize=12')
		if (!isRunTool(to11) || !isRunTool(to12)) throw new Error('Expected setter runners')

		// fontSize starts at 10 (default 10).
		to11.run() // stores 10, sets 11
		expect(fontSize.value).toBe(11)
		to12.run() // stores 11, sets 12 (sursaut's first effect would drop the entry)
		expect(fontSize.value).toBe(12)
		to12.run() // restores: stale 11 here, `default` (10) in sursaut
		expect(fontSize.value).toBe(11)
	})
})
