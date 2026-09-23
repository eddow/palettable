/**
 * `@palettable/core` — localizable catalog strings (intl seam).
 *
 * All user-visible English sentence templates + search keyword families
 * live here as a default-and-overridable table. `defaultCatalogStrings`
 * holds today's English verbatim; consumers pass a full or partial table
 * via `PaletteCoreOptions.strings` or per-call `CommandBoxContext.strings`.
 * Builders never fall back to hard-coded English — they read the resolved
 * table (`resolveCatalogStrings(context.strings)`).
 *
 * Point `label` / `hint` / option `label` are optional on the definition:
 * the render-time dictionaries below win when present, else the definition
 * field, else `humanize(id)` as the last-resort fallback. A consumer may
 * rely on dictionaries alone and leave definition fields unset.
 * `humanizeCommandText` stays the last-resort fallback for ids with no
 * label anywhere.
 */
export type CatalogStrings = {
	/** Sentence builders (verb + label composition — word order varies by locale). */
	readonly toggle: (label: string) => string
	readonly enable: (label: string) => string
	readonly disable: (label: string) => string
	/** `Set ${label}` meta fallback (boolean set rows). */
	readonly setValue: (label: string) => string
	readonly setTo: (label: string, valueLabel: string) => string
	/** `Set ${label}…` generic binding-identity label. */
	readonly setGeneric: (label: string) => string
	readonly increase: (label: string) => string
	readonly decrease: (label: string) => string
	/** `Increase/Decrease ${label}…` generic step-identity labels. */
	readonly increaseGeneric: (label: string) => string
	readonly decreaseGeneric: (label: string) => string
	/** `Adjust ${label}` number-step meta fallback. */
	readonly adjust: (label: string) => string
	readonly incrementBy: (label: string, delta: number) => string
	readonly decrementBy: (label: string, delta: number) => string
	/** `Run command` action meta fallback. */
	readonly runCommand: string
	/** Add-flow metas. */
	readonly addAction: string
	readonly addTool: string
	readonly addValued: (type: string) => string
	readonly addControlOnly: string
	/** Key-editor generic metas. */
	readonly chooseValue: string
	readonly chooseStep: string
	/** Catalog-mode preset rows (`paletteCommandEntries mode: 'catalog'`). */
	readonly presetToggle: string
	readonly presetOn: string
	readonly presetOff: string
	readonly presetRow: (label: string, preset: string) => string
	readonly presetMeta: string
	readonly controlAddToolbar: string
	/** Derived-variant metas (`paletteDerivedVariants`). */
	readonly controlOnlyItem: string
	readonly toolbarCommand: string
	readonly configureInInspector: string
	readonly controlParen: (label: string) => string
	readonly configureOnOff: string
	readonly chooseMode: string
	readonly numericField: string
	/** Search keyword families (also user-visible in the key editor). */
	readonly toggleKeywords: readonly string[]
	readonly onKeywords: readonly string[]
	readonly offKeywords: readonly string[]
	readonly stepUpKeywords: readonly string[]
	readonly stepDownKeywords: readonly string[]
	/** Generic single-word keywords composed into rows. */
	readonly setValueKeywords: readonly string[]
	readonly chooseKeyword: string
	readonly addToolKeywords: readonly string[]
	readonly addControlKeywords: readonly string[]
	readonly consoleKeywords: readonly string[]
	/** Render-time dictionaries by point id (win over the definition fields). */
	readonly pointLabels?: Readonly<Record<string, string>>
	readonly pointHints?: Readonly<Record<string, string>>
	/** Render-time option-label overrides by point id + option value. */
	readonly optionLabels?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Per-locale bundle: chrome + catalog tables plus the point dictionaries.
 *
 * Single source for the render-time dictionaries: the top-level
 * `pointLabels` / `pointHints` / `optionLabels` are authoritative.
 * `catalog.pointLabels` / `catalog.optionLabels` remain accepted as a
 * legacy alias (read by `bundleCatalogStrings` as a fallback) so existing
 * bundles keep working, but new code should set the top-level fields only.
 */
export type LocaleBundle = {
	readonly catalog?: Partial<CatalogStrings>
	readonly pointLabels?: Readonly<Record<string, string>>
	readonly pointHints?: Readonly<Record<string, string>>
	readonly optionLabels?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Today's English, verbatim — the default every builder used before the seam. */
export const defaultCatalogStrings: CatalogStrings = {
	toggle: (label) => `Toggle ${label}`,
	enable: (label) => `Enable ${label}`,
	disable: (label) => `Disable ${label}`,
	setValue: (label) => `Set ${label}`,
	setTo: (label, valueLabel) => `Set ${label} to ${valueLabel}`,
	setGeneric: (label) => `Set ${label}…`,
	increase: (label) => `Increase ${label}`,
	decrease: (label) => `Decrease ${label}`,
	increaseGeneric: (label) => `Increase ${label}…`,
	decreaseGeneric: (label) => `Decrease ${label}…`,
	adjust: (label) => `Adjust ${label}`,
	incrementBy: (label, delta) => `Increment ${label} by ${delta}`,
	decrementBy: (label, delta) => `Decrement ${label} by ${delta}`,
	runCommand: 'Run command',
	addAction: 'Add action',
	addTool: 'Add tool',
	addValued: (type) => `Add ${type} tool`,
	addControlOnly: 'Add control-only item',
	chooseValue: 'Choose value when binding',
	chooseStep: 'Choose step when binding',
	presetToggle: 'Toggle',
	presetOn: 'On',
	presetOff: 'Off',
	presetRow: (label, preset) => `${label} → ${preset} (preset)`,
	presetMeta: 'Preset — toggle on toolbar',
	controlAddToolbar: 'Control — add to toolbar; value is chosen on the bar or in the inspector',
	controlOnlyItem: 'Control-only item',
	toolbarCommand: 'Toolbar command',
	configureInInspector: 'Control — configure in inspector',
	controlParen: (label) => `${label} (control)`,
	configureOnOff: 'Control — configure on/off in inspector',
	chooseMode: 'Control — choose mode in inspector',
	numericField: 'Control — numeric field in inspector',
	toggleKeywords: ['toggle', 'switch', 'flip'],
	onKeywords: ['enable', 'on', 'true', 'activate', 'set'],
	offKeywords: ['disable', 'off', 'false', 'deactivate', 'clear'],
	stepUpKeywords: ['increase', 'increment', 'up', 'more'],
	stepDownKeywords: ['decrease', 'decrement', 'down', 'less'],
	setValueKeywords: ['set', 'value'],
	chooseKeyword: 'choose',
	addToolKeywords: ['add', 'tool'],
	addControlKeywords: ['add', 'control', 'toolbox'],
	consoleKeywords: ['console', 'terminal', 'command', 'cli', 'shell'],
}

/** Merge a partial override over the English default.
 *
 * Top-level scalar/function/array fields replace; nested dictionaries
 * (`pointLabels`, `pointHints`, `optionLabels`, `controlNames` via the
 * vanilla resolver) merge per key so a consumer can override a single
 * entry without repeating the whole map. Per-point `optionLabels[point]`
 * maps merge per option value. Arrays (`toggleKeywords`, …) replace
 * wholesale — keyword families are searched as a set, so merging would
 * leak English synonyms into every locale.
 */
export function resolveCatalogStrings(override?: Partial<CatalogStrings>): CatalogStrings {
	if (override === undefined) return defaultCatalogStrings
	return {
		...defaultCatalogStrings,
		...override,
		...(override.pointLabels !== undefined
			? { pointLabels: { ...defaultCatalogStrings.pointLabels, ...override.pointLabels } }
			: {}),
		...(override.pointHints !== undefined
			? { pointHints: { ...defaultCatalogStrings.pointHints, ...override.pointHints } }
			: {}),
		...(override.optionLabels !== undefined
			? {
					optionLabels: mergeOptionLabels(
						defaultCatalogStrings.optionLabels,
						override.optionLabels
					),
				}
			: {}),
	}
}

/**
 * Resolve the effective catalog override for a locale bundle.
 * Top-level dictionaries win; `catalog.pointLabels` / `catalog.optionLabels`
 * are a legacy alias read only when the top-level field is absent.
 */
export function bundleCatalogStrings(
	bundle: LocaleBundle | undefined
): Partial<CatalogStrings> | undefined {
	if (bundle === undefined) return undefined
	const { catalog, pointLabels, pointHints, optionLabels } = bundle
	if (
		catalog === undefined &&
		pointLabels === undefined &&
		pointHints === undefined &&
		optionLabels === undefined
	)
		return undefined
	return {
		...catalog,
		...(pointLabels !== undefined || catalog?.pointLabels !== undefined
			? { pointLabels: { ...catalog?.pointLabels, ...pointLabels } }
			: {}),
		...(pointHints !== undefined || catalog?.pointHints !== undefined
			? { pointHints: { ...catalog?.pointHints, ...pointHints } }
			: {}),
		...(optionLabels !== undefined || catalog?.optionLabels !== undefined
			? {
					optionLabels: mergeOptionLabels(catalog?.optionLabels, optionLabels),
				}
			: {}),
	}
}

function mergeOptionLabels(
	base: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined,
	override: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined
): Readonly<Record<string, Readonly<Record<string, string>>>> {
	const next: Record<string, Readonly<Record<string, string>>> = { ...(base ?? {}) }
	for (const [pointId, options] of Object.entries(override ?? {})) {
		next[pointId] = { ...(base?.[pointId] ?? {}), ...options }
	}
	return next
}

/**
 * Canonical id → words fallback (`myPoint` → `My Point`).
 * Single implementation — `catalog.ts` (`humanizeCommandText`) and
 * `runnable.ts` share the same word-splitting; this helper is the
 * non-command-text variant used for point ids.
 */
export function humanizeId(value: string): string {
	const words = value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[^a-zA-Z0-9]+/g, ' ')
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
	if (words.length === 0) return value
	return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}
