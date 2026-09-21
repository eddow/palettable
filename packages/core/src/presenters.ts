/**
 * `@palettable/core` — presenter view-models + SSR variant/axis resolution (Phase 5).
 *
 * Headless port of the svelte adapter's `presenters.svelte.ts` (which stays
 * adapter-owned until Phase 7). Presenters are pure functions deriving
 * everything a dumb head component needs to render — zero markup, zero CSS.
 * Heads stay dumb: no `tool.value = …` in `.svelte` (see
 * `docs/architecture.md §5`).
 *
 * Deltas from the reference:
 * - Input is plain data (point definition + current value + item config +
 *   surface), not live `PaletteTool` objects with getters/setters — the
 *   presenters never touch `run()` closures or `$state`. Mutation routes
 *   through returned spec strings / value callbacks the adapter wires to
 *   `PaletteCore` (`run(spec)`, `values.set`).
 * - `commandBoxPresenter` (which builds a `$state` model) and
 *   `configuratorPresenter.remove()` (which needs live toolbar/track/border
 *   object identity) stay adapter-owned — core has no runes and no live
 *   layout objects. The configurator's pure parts (label/icon/hint/tone,
 *   editor choices, set-text/tone/editor payloads) land here as
 *   `configuratorModel`.
 * - Presenters take the param-array display shape `(boundValues, boundBags)`
 *   (Context §2.2, §4 step 6); context flows down into drawer child tools
 *   (Context §1.2). `BoundDisplay.bags` carries the bags in `uses` order
 *   (`undefined` = unregistered) — `buttonPresenter` evaluates functional
 *   `can` against them unless an explicit `can` override is passed.
 *
 * SSR (§4.3): this module also lands `resolveEditorVariant()` — the
 * single-id fallback chain the render model needs — alongside the
 * config-surface list `editorChoicesFor()`. Plus `axisForRegion()` and the
 * drawer perpendicular-axis rule (moved from adapters so server/client
 * agree on variant eligibility).
 */
import type { EditorCapability, EditorDefaults, EditorRegistry } from './editors.js'
import { familyOfPoint } from './editors.js'
import type { PaletteRegion, SurfaceContext, ToolbarItem } from './layout.js'
import { isDrawerItem } from './layout.js'
import type { AnyPoint } from './points.js'
import { isActionPoint, isValuedPoint } from './points.js'
import type { EnumOption } from './type.js'
import { matchEnumOption } from './virtual.js'

/** Item `config` payload with head defaults (label/icon/hint/tone). */
export type HeadItemConfig = {
	readonly icon?: string
	readonly label?: string
	readonly hint?: string
	readonly tone?: string
	/** Slider readout opt-out (`slider` / `drawerSlider` only; default shown). */
	readonly showValue?: boolean
	/** Select + segmented label opt-out (`select` / `segmented`; default shown). */
	readonly showText?: boolean
}

/** Resolved head metadata for an item. */
export type HeadMeta = {
	readonly icon: string | undefined
	readonly label: string
	readonly hint: string | undefined
	readonly tone: 'neutral' | 'accent'
	readonly editor: string | undefined
}

/** Read the item `config` payload with head defaults. */
export function headMeta(item: ToolbarItem): HeadMeta {
	const config = ((item as { config?: unknown }).config ?? {}) as HeadItemConfig
	const tool = (item as { tool?: unknown }).tool
	return {
		icon: typeof config.icon === 'string' ? config.icon : undefined,
		label:
			typeof config.label === 'string'
				? config.label
				: typeof tool === 'string'
					? tool
					: (((item as { editor?: unknown }).editor as string | undefined) ?? 'Item'),
		hint: typeof config.hint === 'string' ? config.hint : undefined,
		tone: config.tone === 'accent' ? 'accent' : 'neutral',
		editor: (item as { editor?: unknown }).editor as string | undefined,
	}
}

/** Tooltip text: `label · suffix` (suffix is usually the hint or value). */
export function headTooltip(item: ToolbarItem, suffix?: string): string {
	const meta = headMeta(item)
	return suffix !== undefined ? `${meta.label} · ${suffix}` : meta.label
}

/**
 * Axis for a docking region (`top`/`bottom` → `horizontal`,
 * `left`/`right` → `vertical`, `undefined` → `horizontal`).
 * Moved from adapters (SSR §4.3) so server/client agree on variant
 * eligibility. Replaces the adapter-owned `regionDirection`.
 */
export function axisForRegion(region: PaletteRegion | undefined): 'horizontal' | 'vertical' {
	return region === 'left' || region === 'right' ? 'vertical' : 'horizontal'
}

/**
 * Drawer perpendicular-axis rule: a drawer child toolbar renders
 * perpendicular to its parent (`horizontal` → `vertical` and vice versa).
 * Moved from adapters (was "enforced by adapters, opaque to the core").
 */
export function drawerChildAxis(axis: 'horizontal' | 'vertical'): 'horizontal' | 'vertical' {
	return axis === 'horizontal' ? 'vertical' : 'horizontal'
}

/** Child region following the perpendicular rule (`vertical` → `'left'`, else `'top'`). */
export function drawerChildRegion(axis: 'horizontal' | 'vertical'): PaletteRegion {
	return axis === 'vertical' ? 'left' : 'top'
}

/**
 * Resolve the single editor variant id for a point on a surface.
 * The canonical fallback chain (documented once, here): explicit item
 * `editor` → family default → first eligible registry variant → `undefined`
 * (no eligible variant). SSR §4.3: the render model needs exactly one id,
 * not the choice list adapters interpret themselves.
 */
export function resolveEditorVariant(
	point: AnyPoint | undefined,
	surface: SurfaceContext,
	registry: EditorRegistry | undefined,
	defaults: EditorDefaults | undefined,
	currentEditor: string | undefined
): string | undefined {
	const family = point === undefined ? 'item' : familyOfPoint(point)
	const variants = registry?.[family] ?? {}
	const eligible = Object.values(variants).filter(
		(cap) =>
			!cap.hidden &&
			(cap.supportedAxes === undefined ||
				cap.supportedAxes === 'both' ||
				cap.supportedAxes === surface.axis ||
				surface.axis === 'both')
	)
	if (currentEditor !== undefined) {
		const explicit = eligible.find((cap) => cap.id === currentEditor)
		if (explicit !== undefined) return explicit.id
		// Explicit editor ineligible for this surface → fall through to the
		// first compact eligible variant (mirrors the svelte fallback), else
		// the first eligible variant.
		const compact = eligible.find((cap) => cap.compact)
		return compact?.id ?? eligible[0]?.id
	}
	const fallback = defaults?.[family]
	if (fallback !== undefined && eligible.some((cap) => cap.id === fallback)) return fallback
	return eligible[0]?.id
}

/** Display inputs for one bound point: definition + current value + bags. */
export type BoundDisplay = {
	readonly point: AnyPoint | undefined
	/** Current value (root-bag value, enum-from key, or stash pressed-state — resolved by the adapter). */
	readonly value: unknown
	/**
	 * Context bags in `uses` order (`undefined` = unregistered).
	 * `buttonPresenter` evaluates functional `can` against these when no
	 * explicit `can` override is passed.
	 */
	readonly bags?: readonly (import('./context.js').ValuesBag | undefined)[]
}

// ── Button (action) ─────────────────────────────────────────────────────────

export type ButtonPresenter = {
	readonly label: string
	readonly icon: string | undefined
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	readonly can: boolean
	/** Spec string to execute via `PaletteCore.run(spec)`. */
	readonly run: string
}

/** View-model for an action point: label/icon/hint/tone + `can` + `run` spec. */
export function buttonPresenter(
	item: ToolbarItem,
	bound: BoundDisplay,
	spec: string,
	can?: boolean
): ButtonPresenter {
	const meta = headMeta(item)
	const resolved =
		can ??
		(bound.point !== undefined && isActionPoint(bound.point)
			? (bound.point.can?.(...(bound.bags ?? [])) ?? true)
			: true)
	return {
		label: meta.label,
		icon: meta.icon,
		title: headTooltip(item, meta.hint),
		tone: meta.tone,
		can: resolved,
		run: spec,
	}
}

// ── Toggle (boolean) ────────────────────────────────────────────────────────

export type TogglePresenter = {
	readonly icon: string
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	/** Pressed flag; `undefined` = skeleton (no value yet). */
	readonly pressed: boolean | undefined
	/** Spec string toggling the value (`id=true` / `id=false`). */
	readonly toggle: string
}

/** View-model for a boolean point: resolved icon + pressed flag + toggle spec.
 * Skeleton: `bound.value === undefined` → `pressed: undefined` (no `false`
 * coercion hiding the skeleton — adapters render the unset state).
 */
export function togglePresenter(item: ToolbarItem, bound: BoundDisplay): TogglePresenter {
	const meta = headMeta(item)
	const pressed = bound.value === undefined ? undefined : bound.value === true
	const icon =
		meta.icon ?? (typeof bound.point?.icon === 'string' ? bound.point.icon : pressed ? '●' : '○')
	return {
		icon,
		title: headTooltip(item, meta.hint),
		tone: meta.tone,
		pressed,
		toggle: `${bound.point?.id ?? ''}=${pressed ? 'false' : 'true'}`,
	}
}

// ── Status (nothing-point) ──────────────────────────────────────────────────

export type StatusPresenter = {
	readonly label: string
	readonly icon: string | undefined
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	readonly value: string
	/** False when the context bag is absent (`undefined` slot) — adapter renders disabled + placeholder. */
	readonly can: boolean
}

/**
 * View-model for a status tool bound to a nothing-point (read-only display).
 * Reads display state from the resolved `uses` bags in order (first string
 * value wins); `undefined` slot = context absent → `can: false`, value
 * falls back to the tool label (adapter renders disabled + placeholder).
 */
export function statusPresenter(item: ToolbarItem, bound: BoundDisplay): StatusPresenter {
	const meta = headMeta(item)
	const bags = bound.bags ?? []
	let value: string | undefined
	for (const bag of bags) {
		if (bag === undefined) continue
		for (const key of Object.keys(bag.asObject())) {
			const candidate = bag.get(key)
			if (typeof candidate === 'string' && candidate.length > 0) {
				value = candidate
				break
			}
		}
		if (value !== undefined) break
	}
	const can = bags.length === 0 || bags.some((bag) => bag !== undefined)
	return {
		label: meta.label,
		icon: meta.icon,
		title: headTooltip(item, meta.hint),
		tone: meta.tone,
		value: value ?? meta.label,
		can,
	}
}

// ── Theme (nothing-point) ───────────────────────────────────────────────────────

/** Resolved UI theme: explicit `light`/`dark`, or `system` (adapter resolves via media query). */
export type ThemeValue = 'light' | 'dark' | 'system'

export type ThemePresenter = {
	readonly label: string
	readonly icon: string | undefined
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	/** Current setting (adapter-provided system value); `undefined` = skeleton (no value yet). */
	readonly value: ThemeValue | undefined
	/** Icon of the current option (`light` → ☀️ …), resolved from the bound enum point; falls back to the tool icon. */
	readonly valueIcon: string | undefined
	/** Spec string cycling to the next theme (`id=next`). */
	readonly cycle: string
}

const THEME_ORDER: readonly ThemeValue[] = ['light', 'dark', 'system']

/** View-model for a theme tool bound to an enum-shaped nothing-point: cycles light → dark → system.
 * Skeleton: adapter-provided `bound.value` absent → `value: undefined` (adapters render unset).
 * The adapter owns get/set on the document root (standard `<html>` class toggle). `valueIcon`
 * carries the current option's icon (icon-value, no text needed). */
export function themePresenter(item: ToolbarItem, bound: BoundDisplay): ThemePresenter {
	const meta = headMeta(item)
	const raw = typeof bound.value === 'string' ? bound.value : undefined
	const value = raw === 'light' || raw === 'dark' || raw === 'system' ? raw : undefined
	const options =
		bound.point !== undefined && bound.point.type === 'nothing'
			? ((bound.point.options ?? []) as readonly EnumOption[])
			: []
	const current = options.find((option) => option.value === value)
	const valueIcon = typeof current?.icon === 'string' ? current.icon : meta.icon
	const next = THEME_ORDER[(THEME_ORDER.indexOf(value ?? 'system') + 1) % THEME_ORDER.length]!
	return {
		label: meta.label,
		icon: meta.icon,
		title: headTooltip(item, meta.hint),
		tone: meta.tone,
		value,
		valueIcon,
		cycle: `${bound.point?.id ?? ''}=${next}`,
	}
}

// ── Select (enum) ───────────────────────────────────────────────────────────

export type SelectOption = {
	readonly value: string
	/** Merged display string (`icon label` / `label` / `icon`) — used by segmented tooltips. */
	readonly text: string
	/** Icon part, when the option declares one. */
	readonly icon: string | undefined
	/** Label part; `undefined` when the display mode hides text. */
	readonly label: string | undefined
	/** Option enablement; `false` disables selection. */
	readonly can: boolean
}

/** Current option in raw (unfiltered) form — the closed select box source. */
export type SelectCurrent = {
	readonly value: string
	/** Raw declared icon (ignores `choiceDisplay`); `undefined` when none. */
	readonly icon: string | undefined
	/** Raw label (`option.label ?? option.value`); always defined. */
	readonly label: string
}

/** Listbox row — always icon (when declared) + full text, ignoring `showText`/`choiceDisplay`. */
export type SelectListOption = {
	readonly value: string
	readonly icon: string | undefined
	readonly label: string
	readonly can: boolean
}

export type SelectPresenter = {
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	readonly label: string
	/** Tool icon (`config.icon`); renders before the value icon, like numerics. */
	readonly toolIcon: string | undefined
	/** Current value icon (raw declared option icon, ignores `choiceDisplay`). */
	readonly icon: string
	readonly direction: 'horizontal' | 'vertical'
	/** Docking region, so axis-aware editors can pick the overlay side. */
	readonly region: PaletteRegion | undefined
	/** Closed-box + segmented label visibility (`config.showText === false` hides it → icon-only). */
	readonly showText: boolean
	/** Display mode (`config.choiceDisplay`, default `'both'`); gates the closed-box label. */
	readonly display: ChoiceDisplay
	/** Current value; `undefined` = skeleton (no option selected). */
	readonly value: string | undefined
	/** Current option in raw form; `undefined` = skeleton or unknown value. */
	readonly current: SelectCurrent | undefined
	/** Display-filtered options for `segmented` (honours `choiceDisplay`). */
	readonly options: readonly SelectOption[]
	/** Unfiltered rows for the select listbox (always full text). */
	readonly listOptions: readonly SelectListOption[]
	/** Spec string selecting a value (`id=value`). */
	readonly select: (value: string) => string
}

export type ChoiceDisplay = 'icon' | 'text' | 'both'

function choiceDisplayOf(item: ToolbarItem): ChoiceDisplay {
	const config = (item as { config?: unknown }).config as { choiceDisplay?: unknown } | undefined
	const value = config?.choiceDisplay
	return value === 'icon' || value === 'text' || value === 'both' ? value : 'both'
}

/** Icon part of an option under a display mode (`undefined` when hidden). */
function choiceIcon(option: EnumOption, display: ChoiceDisplay): string | undefined {
	if (display === 'text') return undefined
	return typeof option.icon === 'string' ? option.icon : undefined
}

/** Label part of an option under a display mode (`undefined` when hidden). */
function choiceLabel(option: EnumOption, display: ChoiceDisplay): string | undefined {
	if (display === 'icon') return undefined
	return option.label ?? option.value
}

/** Merged display string for a single-node renderer (segmented tooltips). */
function choiceText(option: EnumOption, display: ChoiceDisplay): string {
	const label = option.label ?? option.value
	const icon = choiceIcon(option, display)
	if (display === 'icon') return icon ?? label
	if (display === 'text') return label
	return icon !== undefined ? `${icon} ${label}` : label
}

/**
 * Whether a select closed box / segmented shows its option labels. Opt-out
 * via `config.showText === false` (`select` / `segmented`; default shown, so
 * existing layouts are unchanged). Mirrors `showValueOf` for sliders. The
 * select *list* always shows full text regardless of this flag.
 */
function showTextOf(item: ToolbarItem): boolean {
	const config = (item as { config?: unknown }).config as { showText?: unknown } | undefined
	return config?.showText !== false
}

/**
 * Closed select-box label: `undefined` = icon-only trigger. The label shows
 * when text is enabled (`showText` and `display !== 'icon'`); an option with
 * no icon keeps its label as a fallback so the trigger is never empty
 * (mirrors the segmented icon-less fallback).
 */
export function selectClosedLabel(
	view: Pick<SelectPresenter, 'showText' | 'display' | 'current'>
): string | undefined {
	const current = view.current
	if (current === undefined) return undefined
	if (view.showText && view.display !== 'icon') return current.label
	if (current.icon === undefined) return current.label
	return undefined
}

/** View-model for an enum point: current icon/value + display-filtered options.
 * Skeleton: non-string `bound.value` (incl. `undefined`) → `value: undefined`.
 */
export function selectPresenter(
	item: ToolbarItem,
	bound: BoundDisplay,
	surface: SurfaceContext
): SelectPresenter {
	const meta = headMeta(item)
	const pointId = bound.point?.id ?? ''
	const value = typeof bound.value === 'string' ? bound.value : undefined
	const optionsList =
		bound.point !== undefined && isValuedPoint(bound.point) && bound.point.type === 'enum'
			? ((bound.point.constraints as { readonly options?: readonly EnumOption[] } | undefined)
					?.options ?? [])
			: []
	const display = choiceDisplayOf(item)
	const current = optionsList.find((option) => option.value === value)
	const currentIcon = current !== undefined ? current.icon : undefined
	const toolIcon = meta.icon
	const currentEntry: SelectCurrent | undefined =
		current !== undefined
			? {
					value: current.value,
					icon: typeof current.icon === 'string' ? current.icon : undefined,
					label: current.label ?? current.value,
				}
			: undefined
	return {
		title: headTooltip(item, meta.hint),
		tone: meta.tone,
		label: meta.label,
		toolIcon,
		icon: typeof currentIcon === 'string' ? currentIcon : (meta.icon ?? value ?? ''),
		direction: surface.axis === 'vertical' ? 'vertical' : 'horizontal',
		region: surface.region,
		showText: showTextOf(item),
		display,
		value,
		current: currentEntry,
		options: optionsList.map((option) => ({
			value: option.value,
			text: choiceText(option, display),
			icon: choiceIcon(option, display),
			label: choiceLabel(option, display),
			can: option.can !== false,
		})),
		listOptions: optionsList.map((option) => ({
			value: option.value,
			icon: typeof option.icon === 'string' ? option.icon : undefined,
			label: option.label ?? option.value,
			can: option.can !== false,
		})),
		select: (next: string) => `${pointId}=${next}`,
	}
}

// ── Slider (number) ─────────────────────────────────────────────────────────

/**
 * How a slider exposes its range control.
 * - `inline`: the range is always visible in the toolbar.
 * - `drawer`: only the icon (and the value readout) show at rest; the range
 *   is revealed as an overlay beside the icon on hover/focus, so the toolbar
 *   never resizes.
 */
export type SliderVariant = 'inline' | 'drawer'

export type SliderPresenter = {
	readonly title: string
	readonly tone: 'neutral' | 'accent'
	readonly icon: string
	readonly direction: 'horizontal' | 'vertical'
	readonly region: PaletteRegion | undefined
	/** Range layout: `inline` in-toolbar, or `drawer` revealed on hover/focus. */
	readonly variant: SliderVariant
	/**
	 * Axis the range control runs along. An `inline` slider follows the
	 * toolbar axis (horizontal in a horizontal toolbar, vertical in a vertical
	 * one); a `drawer` slider uses the perpendicular axis, so the two variants
	 * never look alike.
	 */
	readonly rangeAxis: 'horizontal' | 'vertical'
	/** Value readout text (formatted for display, e.g. `1.5`). */
	readonly text: string
	/** Whether the numeric readout renders (`config.showValue === false` hides it). */
	readonly showValue: boolean
	readonly min: number
	readonly max: number
	readonly step: number
	/** Current value; `undefined` = skeleton (adapters render the unset state). */
	readonly value: number | undefined
}

/**
 * Resolve the slider range layout. An explicit slider editor variant id
 * (`slider` → inline, `drawerSlider` → drawer) is authoritative — it is the
 * user's choice in the configurator. Otherwise `config.sliderVariant` applies,
 * and the default is `inline` (the range runs along the toolbar axis).
 */
function sliderVariantOf(item: ToolbarItem): SliderVariant {
	const editor = (item as { editor?: unknown }).editor
	if (editor === 'drawerSlider') return 'drawer'
	if (editor === 'slider') return 'inline'
	const config = (item as { config?: unknown }).config as { sliderVariant?: unknown } | undefined
	const value = config?.sliderVariant
	if (value === 'inline' || value === 'drawer') return value
	return 'inline'
}

/**
 * Whether a slider shows its numeric readout. Opt-out via
 * `config.showValue === false` (slider / drawerSlider only; steppers always
 * show, stars never do). Default is shown, so existing layouts are unchanged.
 */
function showValueOf(item: ToolbarItem): boolean {
	const config = (item as { config?: unknown }).config as { showValue?: unknown } | undefined
	return config?.showValue !== false
}

/** View-model for a number point: bounds + value (adapter writes via `values.set`).
 * Skeleton: non-number `bound.value` (incl. `undefined`) → `value: undefined`
 * (no `0` fallback); `min`/`max`/`step` defaults from constraints stay.
 */
export function sliderPresenter(
	item: ToolbarItem,
	bound: BoundDisplay,
	surface: SurfaceContext
): SliderPresenter {
	const meta = headMeta(item)
	const constraints =
		bound.point !== undefined && isValuedPoint(bound.point) && bound.point.type === 'number'
			? ((bound.point.constraints as
					| { readonly min?: number; readonly max?: number; readonly step?: number }
					| undefined) ?? {})
			: {}
	const value = typeof bound.value === 'number' ? bound.value : undefined
	const direction = surface.axis === 'vertical' ? 'vertical' : 'horizontal'
	const variant = sliderVariantOf(item)
	return {
		title: headTooltip(item, `${meta.label} ${value}`),
		tone: meta.tone,
		icon: meta.icon ?? 'A',
		direction,
		region: surface.region,
		variant,
		rangeAxis:
			variant === 'inline' ? direction : direction === 'vertical' ? 'horizontal' : 'vertical',
		text: value === undefined ? '' : String(value),
		showValue: showValueOf(item),
		min: constraints.min ?? 0,
		max: constraints.max ?? 100,
		step: constraints.step ?? 1,
		value,
	}
}

// ── Configurator (pure parts) ───────────────────────────────────────────────

export type ConfiguratorModel = {
	readonly label: string
	readonly icon: string
	readonly hint: string
	readonly tone: 'neutral' | 'accent'
	readonly editor: string | undefined
	readonly removable: boolean
}

/** Pure configurator view-model (label/icon/hint/tone/editor; mutation stays adapter-owned). */
export function configuratorModel(item: ToolbarItem): ConfiguratorModel {
	const meta = headMeta(item)
	return {
		label: meta.label,
		icon: meta.icon ?? '',
		hint: meta.hint ?? '',
		tone: meta.tone,
		editor: meta.editor,
		removable: true,
	}
}

/** Config payload patch for `setText` / `setTone` (adapter applies to `item.config`). */
export function configuratorTextPatch(
	key: 'icon' | 'label' | 'hint',
	value: string
): Record<string, string> {
	return { [key]: value }
}

/** Config payload patch for tone (adapter applies to `item.config`). */
export function configuratorTonePatch(value: string): Record<string, string> {
	return { tone: value === 'accent' ? 'accent' : 'neutral' }
}

/**
 * Prune config keys when switching editors (mirrors the svelte `setEditor`
 * cleanup for `values`/`keywords`/`choiceDisplay`).
 * - slider / drawerSlider keep `showValue`, prune the enum-subset keys + `showText`.
 * - select / segmented keep `showText` + the enum-subset keys, prune `showValue`.
 * - other enum editors keep the enum-subset keys, prune `showValue` + `showText`.
 * - everything else prunes both.
 * Returns the keys to delete (adapter deletes them from `item.config`).
 */
export function configuratorEditorCleanup(nextEditor: string): readonly string[] {
	const isSlider = nextEditor === 'slider' || nextEditor === 'drawerSlider'
	const isEnum =
		nextEditor === 'flip' ||
		nextEditor === 'radio' ||
		nextEditor === 'select' ||
		nextEditor === 'segmented' ||
		nextEditor === 'splitRadio'
	if (isSlider) return ['values', 'keywords', 'choiceDisplay', 'showText']
	if (nextEditor === 'select' || nextEditor === 'segmented') return ['showValue']
	if (isEnum) return ['showValue', 'showText']
	return ['values', 'keywords', 'choiceDisplay', 'showValue', 'showText']
}

// ── Enum-from / stash display helpers ───────────────────────────────────────

/**
 * Resolve the display key of an `enum-from` virtual for a source value
 * (options order wins; `undefined` when no option matches).
 */
export function enumFromDisplayKey(
	options: readonly { readonly key: string; readonly value: unknown }[],
	sourceValue: unknown
): string | undefined {
	return matchEnumOption({ options } as never, sourceValue)?.key
}

/** Pressed state of a `stash` virtual (current `Object.is`-equals the stashed value). */
export function stashPressedState(current: unknown, stashedValue: unknown): boolean {
	return Object.is(current, stashedValue)
}

/** Whether a toolbar item is a drawer (re-export for presenter consumers). */
export function isPresenterDrawerItem(item: ToolbarItem): boolean {
	return isDrawerItem(item)
}

export type { EditorCapability }
