/**
 * Headless presenter view-models for palette tools (toolbar components).
 *
 * Vocabulary (see `docs/core-concepts.md`): **point** = the data definition of
 * what is controlled by the palette, one entry of `PaletteConfig.tools` (no
 * layout); **tool** = a toolbar-bound control that modifies a point (the
 * presenter + head component pair below); **editor** = the configuration panel
 * (`configuratorPresenter` → `BaseConfigurator`, rendered in the console
 * *Details* panel). `status` / `commandBox` / `drawer` are **pointless tools**:
 * `item`-family variants binding no point (no bound value). Code names keep
 * the historical `*Presenter` / `*Editor` suffixes.
 *
 * The palette core owns state, a11y semantics, tool resolution, editing, and
 * drag/drop — **not** styling. A "head" owns markup + CSS only. These
 * presenters are the contract between the two: pure functions that derive
 * everything a dumb head component needs to render from a
 * `PaletteEditorContext`, with **zero** markup and **zero** CSS.
 *
 * - `buttonPresenter` (run) → `{ label, icon, hint, tone, can, run }`
 * - `togglePresenter` (boolean) → `{ icon, hint, tone, pressed, toggle }`
 * - `selectPresenter` (enum) → `{ hint, tone, icon, value, options, select }`
 * - `sliderPresenter` (number) → `{ label, icon, hint, tone, direction, region,
 *   min, max, step, value, set }`
 * - `commandBoxPresenter` (item) → `{ title, icon, label, hint, model }` — a
 *   real commands-combo-box (text input + results popup) running commands
 *   inline on the toolbar. Call it once at component init, NOT inside `$derived`
 *   (the returned `model` holds `$state` and must be created during init).
 * - `configuratorPresenter` → `{ label, icon, hint, tone, editor, editorChoices,
 *   setText, setTone, setEditor }` (the editor: generic configuration panel;
 *   enum-subset fields stay in the demo `EnumSubsetConfigurator`, not the minimal head)
 *
 * Heads must be dumb: no `tool.value = …`, no `tool.run()`, no
 * `paletteCommandEntries` calls inside `.svelte` files. All mutation lives
 * here (or in the tool itself); the head only calls the presenter callbacks.
 */
import {
	type PaletteCommandBoxModel,
	paletteCommandBoxModel,
	paletteCommandEntries,
} from './command-box.svelte'
import { removePaletteItem, removeParkedToolbar } from './layout.svelte'
import type {
	PaletteBorder,
	PaletteEditorChoice,
	PaletteEditorContext,
	PaletteParking,
	PaletteSchema,
	PaletteToolBool,
	PaletteToolbar,
	PaletteToolbarItem,
	PaletteToolEnum,
	PaletteToolNumber,
	PaletteToolRun,
	PaletteTrack,
} from './types'

export type HeadItemConfigBase = {
	icon?: string
	label?: string
	hint?: string
	tone?: 'neutral' | 'accent'
}

export type HeadChoiceDisplay = 'icon' | 'text' | 'both'

export type HeadEnumSubsetConfig = HeadItemConfigBase & {
	choiceDisplay?: HeadChoiceDisplay
	values?: readonly string[]
	keywords?: readonly string[]
}

type AnyItem = PaletteToolbarItem<string, string, unknown>

/** Read the item `config` payload with head defaults (label/icon/hint/tone). */
export function headMeta(item: AnyItem) {
	const config = ((item as { config?: unknown }).config ?? {}) as HeadItemConfigBase
	return {
		config,
		editor: item.editor,
		icon: typeof config.icon === 'string' ? config.icon : undefined,
		label: typeof config.label === 'string' ? config.label : (item.tool ?? item.editor ?? 'Item'),
		hint: typeof config.hint === 'string' ? config.hint : undefined,
		tone: config.tone === 'accent' ? 'accent' : 'neutral',
	} as const
}

/** Tooltip text: `label · suffix` (suffix is usually the hint or value). */
export function headTooltip(item: AnyItem, suffix?: string): string {
	const meta = headMeta(item)
	return suffix ? `${meta.label} · ${suffix}` : meta.label
}

/** Horizontal/vertical layout from surface axis, falling back to region. */
export function headLayoutFromSurface(
	scope: PaletteEditorContext['scope'],
	surface?: PaletteEditorContext['surface']
): 'horizontal' | 'vertical' {
	if (surface) return surface.axis === 'vertical' ? 'vertical' : 'horizontal'
	const region = (scope.region as string | undefined) ?? undefined
	return region === 'left' || region === 'right' ? 'vertical' : 'horizontal'
}

/** Region name, defaulting to `'top'`. */
export function headRegionFromScope(scope: PaletteEditorContext['scope']): string {
	return (scope.region as string | undefined) ?? 'top'
}

function normalizeSubsetToken(value: string): string {
	return value.trim().toLowerCase()
}

function headEnumSubsetConfig(item: AnyItem): HeadEnumSubsetConfig | undefined {
	const config = (item as { config?: unknown }).config
	if (!config || typeof config !== 'object') return undefined
	return config as HeadEnumSubsetConfig
}

function headEnumChoiceDisplay(item: AnyItem): HeadChoiceDisplay {
	const value = headEnumSubsetConfig(item)?.choiceDisplay
	return value === 'icon' || value === 'text' || value === 'both' ? value : 'both'
}

function headResolveEnumValues<T extends string>(
	item: AnyItem,
	values: readonly {
		readonly value: T
		readonly label?: string
		readonly keywords?: readonly string[]
	}[]
): readonly {
	readonly value: T
	readonly label?: string
	readonly keywords?: readonly string[]
}[] {
	const config = headEnumSubsetConfig(item)
	const explicitValues = config?.values
	if (explicitValues?.length) {
		const allowed = new Set(explicitValues.map(normalizeSubsetToken))
		return values.filter((value) => allowed.has(normalizeSubsetToken(value.value)))
	}
	const keywords = config?.keywords
	if (!keywords?.length) return values
	const wanted = new Set(keywords.map(normalizeSubsetToken))
	return values.filter((value) => {
		const haystack = [value.value, value.label ?? '', ...(value.keywords ?? [])]
			.join(' ')
			.toLowerCase()
		for (const keyword of wanted) if (haystack.includes(keyword)) return true
		return false
	})
}

function headEnumChoiceText(
	value: { readonly value: string; readonly label?: string; readonly icon?: unknown },
	display: HeadChoiceDisplay
): string {
	const label = value.label ?? value.value
	const icon = typeof value.icon === 'string' ? value.icon : undefined
	if (display === 'icon') return icon ?? label
	if (display === 'text') return label
	return icon ? `${icon} ${label}` : label
}

export type ButtonPresenter = {
	readonly label: string
	readonly icon: string | undefined
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	readonly can: boolean
	run(): void
}

/** View-model for a run tool: label/icon/hint/tone + `can` + `run`. */
export function buttonPresenter(
	context: PaletteEditorContext<PaletteToolRun, PaletteToolbarItem, PaletteSchema>
): ButtonPresenter {
	const meta = headMeta(context.item)
	const tool = context.tool
	return {
		label: meta.label,
		icon: meta.icon,
		title: headTooltip(context.item, meta.hint),
		tone: meta.tone,
		get can() {
			return tool.can
		},
		run() {
			tool.run()
		},
	}
}

export type TogglePresenter = {
	readonly icon: string
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	readonly pressed: boolean
	toggle(): boolean
}

export type StatusPresenter = {
	readonly label: string
	readonly icon: string | undefined
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	readonly value: string
}

export type StatusItemConfig = HeadItemConfigBase & {
	value?: string
}

/** View-model for a pointless status tool (read-only display, no bound point). */
export function statusPresenter(
	context: PaletteEditorContext<undefined, PaletteToolbarItem, PaletteSchema>
): StatusPresenter {
	const meta = headMeta(context.item)
	const config = (context.item.config ?? {}) as StatusItemConfig
	const value =
		typeof config.value === 'string' && config.value.length > 0 ? config.value : meta.label
	return {
		label: meta.label,
		icon: meta.icon,
		title: headTooltip(context.item, meta.hint),
		tone: meta.tone,
		get value() {
			return value
		},
	}
}

/** View-model for a boolean tool: resolved icon + pressed flag + `toggle()`. */
export function togglePresenter(
	context: PaletteEditorContext<PaletteToolBool, PaletteToolbarItem, PaletteSchema>
): TogglePresenter {
	const meta = headMeta(context.item)
	const tool = context.tool
	const icon = meta.icon ?? (typeof tool.icon === 'string' ? tool.icon : tool.value ? '●' : '○')
	return {
		icon,
		title: headTooltip(context.item, meta.hint),
		tone: meta.tone,
		get pressed() {
			return tool.value
		},
		toggle() {
			tool.value = !tool.value
			return tool.value
		},
	}
}

export type SelectOption = {
	readonly value: string
	readonly text: string
	/** Option enablement; `false` disables selection (radio/segmented honor it). */
	readonly can: boolean
}

export type SelectPresenter = {
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	readonly label: string
	readonly icon: string
	readonly direction: 'horizontal' | 'vertical'
	readonly value: string
	readonly options: readonly SelectOption[]
	select(value: string): void
}

/** View-model for an enum tool: current icon/value + display-filtered options. */
export function selectPresenter(
	context: PaletteEditorContext<PaletteToolEnum<string>, PaletteToolbarItem, PaletteSchema>
): SelectPresenter {
	const meta = headMeta(context.item)
	const tool = context.tool
	const values = headResolveEnumValues(context.item, tool.values)
	const display = headEnumChoiceDisplay(context.item)
	const current = values.find((value) => value.value === tool.value)
	const currentIcon = (current as { readonly icon?: unknown } | undefined)?.icon
	return {
		title: headTooltip(context.item, meta.hint),
		tone: meta.tone,
		label: meta.label,
		icon: typeof currentIcon === 'string' ? currentIcon : (meta.icon ?? tool.value),
		direction: headLayoutFromSurface(context.scope, context.surface),
		get value() {
			return tool.value
		},
		options: values.map((value) => ({
			value: value.value,
			text: headEnumChoiceText(
				value as { readonly value: string; readonly label?: string; readonly icon?: unknown },
				display
			),
			can: (value as { readonly can?: boolean }).can !== false,
		})),
		select(value: string) {
			tool.value = value
		},
	}
}

export type SliderPresenter = {
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	readonly icon: string
	readonly direction: 'horizontal' | 'vertical'
	readonly region: string
	readonly min: number
	readonly max: number
	readonly step: number
	readonly value: number
	set(value: number): void
}

/** View-model for a number tool: bounds + value + `set()`. */
export function sliderPresenter(
	context: PaletteEditorContext<PaletteToolNumber, PaletteToolbarItem, PaletteSchema>
): SliderPresenter {
	const meta = headMeta(context.item)
	const tool = context.tool
	return {
		title: headTooltip(context.item, `${meta.label} ${tool.value}`),
		tone: meta.tone,
		icon: meta.icon ?? 'A',
		direction: headLayoutFromSurface(context.scope, context.surface),
		region: headRegionFromScope(context.scope),
		min: tool.min ?? 0,
		max: tool.max ?? 100,
		step: tool.step ?? 1,
		get value() {
			return tool.value
		},
		set(value: number) {
			tool.value = value
		},
	}
}

export type CommandBoxPresenter = {
	readonly title: string
	readonly icon: string
	readonly label: string
	readonly hint: string | undefined
	readonly model: PaletteCommandBoxModel
}

/**
 * View-model for the command-box item: a real commands-combo-box (text input +
 * results popup) that runs commands inline on the toolbar. This is a **run**
 * surface, independent of the console — it builds its own
 * `paletteCommandBoxModel` from the palette resolved in `context.scope.palette`.
 *
 * IMPORTANT: create during component init only (the model holds `$state`); do
 * not wrap this in `$derived`.
 */
export function commandBoxPresenter(options: {
	context: PaletteEditorContext<undefined, PaletteToolbarItem, PaletteSchema>
}): CommandBoxPresenter {
	const meta = headMeta(options.context.item)
	const palette = options.context.scope.palette
	const model = paletteCommandBoxModel({
		entries: palette ? paletteCommandEntries({ palette: palette as never }) : [],
		placeholder: 'Command…',
	})
	return {
		title: headTooltip(options.context.item, meta.hint),
		icon: meta.icon ?? '⌘',
		label: meta.label,
		hint: meta.hint,
		model: model as unknown as PaletteCommandBoxModel,
	}
}

export type ConfiguratorPresenter = {
	readonly label: string
	readonly icon: string
	readonly hint: string
	readonly tone: 'neutral' | 'accent'
	readonly editor: string | undefined
	readonly editorChoices: readonly PaletteEditorChoice[]
	/** Item-level deletion (G2): always true — every editor is removable. */
	readonly removable: boolean
	setText(key: 'icon' | 'label' | 'hint', value: string): void
	setTone(value: string): void
	setEditor(value: string): void
	/** Remove the item from its toolbar, pruning empty toolbar/track. */
	remove(): boolean
}

/** View-model for the generic configure panel (label/icon/hint/editor/tone). */
export function configuratorPresenter(
	context: PaletteEditorContext<
		PaletteToolBool | PaletteToolNumber | PaletteToolEnum<string> | PaletteToolRun | undefined,
		PaletteToolbarItem,
		PaletteSchema
	>
): ConfiguratorPresenter {
	const item = context.item
	const meta = headMeta(item)
	const editorChoices =
		(context.scope.editorChoices as readonly PaletteEditorChoice[] | undefined) ?? []
	// The live container rides on the scope when the console builds the
	// configurator context from `palettes.inspecting`: border items carry
	// toolbar/track/border, parking items carry toolbar/parking. Without them
	// the presenter still renders, but `remove()` no-ops.
	const scope = context.scope as Record<string, unknown>
	const toolbar = scope.toolbar as PaletteToolbar | undefined
	const parking = scope.parking as PaletteParking | undefined
	const track = scope.track as PaletteTrack | undefined
	const border = scope.border as PaletteBorder | undefined
	type Location =
		| { readonly toolbar: PaletteToolbar; readonly parking: PaletteParking }
		| {
				readonly toolbar: PaletteToolbar
				readonly track: PaletteTrack
				readonly border: PaletteBorder
		  }
	const location: Location | undefined =
		toolbar !== undefined && parking !== undefined
			? { toolbar, parking }
			: toolbar !== undefined && track !== undefined && border !== undefined
				? { toolbar, track, border }
				: undefined
	function ensureConfig(): Record<string, unknown> {
		if (!item.config || typeof item.config !== 'object') item.config = {}
		return item.config as Record<string, unknown>
	}
	return {
		label: meta.label,
		icon: meta.icon ?? '',
		hint: meta.hint ?? '',
		tone: meta.tone,
		editor: meta.editor,
		editorChoices,
		setText(key, value) {
			ensureConfig()[key] = value
		},
		setTone(value) {
			ensureConfig().tone = value === 'accent' ? 'accent' : 'neutral'
		},
		setEditor(value) {
			item.editor = value
			const config = item.config as Record<string, unknown> | undefined
			if (
				value !== 'flip' &&
				value !== 'radio' &&
				value !== 'select' &&
				value !== 'segmented' &&
				value !== 'splitRadio' &&
				config
			) {
				delete config.values
				delete config.keywords
				delete config.choiceDisplay
			}
		},
		removable: true,
		remove() {
			if (!location) return false
			if ('parking' in location) return removeParkedToolbar(location.parking, location.toolbar) >= 0
			return removePaletteItem(item, location.toolbar, location.track, location.border)
		},
	}
}
