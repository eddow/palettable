/**
 * `@palettable/core` — command-box builders + headless query model (Phase 4).
 *
 * Pure over point descriptors: no closures in the SSR path (the entry list
 * itself is client-only — the box shell is SSR, entries are not; see
 * `plans/ssr.md` §8). Entries carry `uses` and the renderer filters/resolves
 * at render time, never build-time precompile (Context §2.7); commands on
 * nothing-points with `uses: []`/`undefined` are always present.
 *
 * Headless port of the svelte adapter's `command-box.svelte.ts` builders
 * (which stay adapter-owned until Phase 7). Deltas from the reference:
 * - Input is `readonly AnyPoint[]` + plain-data context (keystrokes,
 *   current values, `can` flags) instead of a live `Palette` instance —
 *   the builders never touch `run()` closures or `$state`.
 * - `run` specs are strings (`id`, `id=value`, `id:action`, virtual ids);
 *   adapters execute them via `PaletteCore.run(spec)`.
 * - Catalogue drag payloads (`PALETTE_CATALOG_DRAG_MIME`,
 *   `serialize/parseCatalogDragPayload`, `paletteToolbarItemFromCatalogPayload`,
 *   `paletteCatalogEntries`) are **deleted per `plans/simplify.md`** (dead
 *   code — zero `draggable=` in `src`): rows are click-to-select, not
 *   draggable. Only `spec` payloads survive as plain `{ kind: 'spec', spec }`
 *   data (no JSON helpers — adapters serialize if they need to).
 * - `commandBoxEnumCommands` / `per-value` is **deleted per
 *   `plans/simplify.md`** (never set by demo/tools): enum catalog always
 *   collapses to one tool-label row.
 * - `paletteToolbarItemFromSpec` / `paletteToolbarItemFromDerivedVariant`
 *   (which resolve editor registries + components) stay adapter-owned —
 *   core has no components. The builders emit specs + variant descriptors;
 *   adapters map them to items.
 */
import type { IconToken } from './identifiers.js'
import type { KeyBindings } from './keys.js'
import { findKeystrokesFor } from './keys.js'
import type { AnyPoint, NumberPoint } from './points.js'
import { isActionPoint, isValuedPoint } from './points.js'
import type { EnumOption } from './type.js'

/** Search query accepted by `filterCommandEntries`. */
export type CommandBoxQuery = {
	readonly free?: string
	readonly keywords?: readonly string[]
	readonly categories?: readonly string[]
}

/**
 * Command entry built from a point definition. `run` is a spec string for
 * `PaletteCore.run(spec)` — never a closure (SSR-safe). `can: false`
 * entries are filtered from results; `can: undefined` = enabled.
 */
export type CommandBoxEntry = {
	readonly id: string
	readonly label: string
	readonly meta: string
	readonly icon?: IconToken
	readonly keywords?: readonly string[]
	readonly categories?: readonly string[]
	readonly can?: boolean
	/** Spec string to execute via `PaletteCore.run(spec)`. */
	readonly run: string
	/** Optional context bags (Context §2.7 — filter at render, not here). */
	readonly uses?: readonly string[]
}

/** Add-item source: a point or an editor-only item that can seed a toolbar item. */
export type AddItemSource = {
	readonly id: string
	readonly label: string
	readonly meta: string
	readonly icon?: IconToken
	readonly keywords?: readonly string[]
	readonly categories?: readonly string[]
	readonly kind: 'tool' | 'item'
	readonly toolId?: string
	readonly editor?: string
}

/** Concrete variant derived from an add-item source. */
export type DerivedVariant = {
	readonly id: string
	readonly label: string
	readonly meta: string
	readonly icon?: IconToken
	readonly keywords?: readonly string[]
	readonly categories?: readonly string[]
	readonly kind: 'tool' | 'item' | 'set' | 'action'
	readonly toolId?: string
	readonly editor?: string
	readonly action?: string
	/** Spec string this variant inserts (`toolId`, `toolId=value`, `toolId:action`). */
	readonly spec?: string
	readonly valueType?: 'boolean' | 'number' | 'enum'
	readonly values?: readonly EnumOption[]
}

/** Plain-data context the builders read instead of a live `Palette`. */
export type CommandBoxContext = {
	/** Key bindings for `meta` shortcut labels (`findKeystrokesFor`). */
	readonly keys?: KeyBindings
	/** Current values for `can` computation (e.g. `tool.value !== value`). */
	readonly values?: Readonly<Record<string, unknown>>
	/** Static `can` flags for action points (omitted = enabled). */
	readonly actionCan?: Readonly<Record<string, boolean | undefined>>
	/** Editor-only item ids for add-item sources (adapter's `editors.item` keys). */
	readonly itemEditors?: readonly string[]
}

function normalizeToken(value: string): string {
	return value.trim().toLowerCase()
}

function uniqueNormalized(values: readonly string[]): string[] {
	const seen = new Set<string>()
	const result: string[] = []
	for (const value of values) {
		const normalized = normalizeToken(value)
		if (normalized === '' || seen.has(normalized)) continue
		seen.add(normalized)
		result.push(value)
	}
	return result
}

/** Split a query into whitespace-separated tokens. */
export function tokenizeQuery(value: string): string[] {
	return value
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0)
}

/** Drop the last whitespace-separated token (suggestion-accept helper). */
export function trimLastToken(value: string): string {
	const tokens = tokenizeQuery(value)
	tokens.pop()
	return tokens.join(' ')
}

function matchesAllTerms(haystack: string, terms: readonly string[]): boolean {
	return terms.every((term) => haystack.includes(term))
}

function splitCommandWords(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[^a-zA-Z0-9]+/g, ' ')
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
}

function humanizeCommandText(value: string): string {
	const words = splitCommandWords(value)
	if (words.length === 0) return value
	return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}

function collectKeywords(...sources: (string | readonly string[] | undefined)[]): string[] {
	const values: string[] = []
	for (const source of sources) {
		if (source === undefined) continue
		if (typeof source === 'string') {
			values.push(source)
			values.push(...splitCommandWords(source).map((word) => word.toLowerCase()))
			continue
		}
		for (const value of source) {
			values.push(value)
			values.push(...splitCommandWords(value).map((word) => word.toLowerCase()))
		}
	}
	return uniqueNormalized(values)
}

function entryMeta(context: CommandBoxContext, spec: string, fallback: string): string {
	const keys =
		context.keys !== undefined ? findKeystrokesFor(context.keys, spec.split(/[=|:]/)[0]!) : []
	return keys.length > 0 ? keys.join(' / ') : fallback
}

function entryCategories(point: AnyPoint, extra?: readonly string[]): string[] {
	const categories = uniqueNormalized([...(point.categories ?? []), ...(extra ?? [])])
	return categories.length > 0 ? categories : [isActionPoint(point) ? 'action' : point.type]
}

function currentValue(context: CommandBoxContext, id: string): unknown {
	return context.values?.[id]
}

function actionEnabled(context: CommandBoxContext, id: string): boolean {
	return context.actionCan?.[id] ?? true
}

/**
 * Bounds `can` for a number `inc` / `dec` entry from plain-data context.
 * Step-aware (`value + step <= max`, `value - step >= min`, epsilon for
 * float drift), mirroring `namedActionCan` in `core.ts` — but lenient:
 * no values context (or a non-number current) = enabled, so adapters
 * without live values keep the old default. Adapters with live values
 * refine via `PaletteCore.canRunAction` at render time.
 */
function numberActionEnabled(
	context: CommandBoxContext,
	point: AnyPoint,
	action: 'inc' | 'dec'
): boolean {
	const current = currentValue(context, point.id)
	if (typeof current !== 'number' || !Number.isFinite(current)) return true
	const constraints = (point as NumberPoint).constraints ?? {}
	const step = constraints.step ?? 1
	const epsilon = Number.EPSILON * Math.max(1, Math.abs(current), Math.abs(step)) * 8
	if (action === 'inc')
		return constraints.max === undefined || current + step <= constraints.max + epsilon
	return constraints.min === undefined || current - step >= constraints.min - epsilon
}

/**
 * Build the executable command entries for a point list.
 *
 * In `catalog` mode, entries stay enabled for search and catalogue display;
 * `run` specs are unchanged. Pure over descriptors — no closures.
 */
export function paletteCommandEntries(
	points: readonly AnyPoint[],
	context: CommandBoxContext = {},
	options: { excludeTools?: readonly string[]; mode?: 'run' | 'catalog' } = {}
): readonly CommandBoxEntry[] {
	const catalog = options.mode === 'catalog'
	const excluded = new Set(options.excludeTools ?? [])
	const entries: CommandBoxEntry[] = []
	for (const point of points) {
		if (excluded.has(point.id)) continue
		const label = point.label ?? humanizeCommandText(point.id)
		if (isActionPoint(point)) {
			entries.push({
				id: point.id,
				label,
				meta: entryMeta(context, point.id, 'Run command'),
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords),
				categories: entryCategories(point),
				can: catalog ? undefined : actionEnabled(context, point.id),
				run: point.id,
				uses: point.uses,
			})
			continue
		}
		if (!isValuedPoint(point)) continue
		if (point.type === 'boolean') {
			for (const [value, verb] of [
				[true, 'Enable'],
				[false, 'Disable'],
			] as const) {
				const spec = `${point.id}=${value}`
				const presetLabel = value ? 'On' : 'Off'
				entries.push({
					id: spec,
					label: catalog ? `${label} → ${presetLabel} (preset)` : `${verb} ${label}`,
					meta: catalog
						? 'Preset — fixed on/off on toolbar'
						: entryMeta(context, spec, `Set ${label}`),
					icon: point.icon,
					keywords: collectKeywords(
						point.id,
						label,
						point.keywords,
						value ? ['enable', 'on', 'true'] : ['disable', 'off', 'false']
					),
					categories: entryCategories(point),
					can: catalog ? undefined : currentValue(context, point.id) !== value,
					run: spec,
					uses: point.uses,
				})
			}
			continue
		}
		if (point.type === 'enum') {
			if (catalog) {
				entries.push({
					id: `${point.id}:catalog-enum`,
					label,
					meta: 'Control — add to toolbar; value is chosen on the bar or in the inspector',
					icon: point.icon,
					keywords: collectKeywords(point.id, label, point.keywords, 'set', 'value', 'choose'),
					categories: entryCategories(point),
					run: point.id,
					uses: point.uses,
				})
				continue
			}
			const optionsList =
				(point.constraints as { readonly options?: readonly EnumOption[] } | undefined)?.options ??
				[]
			for (const option of optionsList) {
				const optionLabel = option.label ?? humanizeCommandText(option.value)
				const spec = `${point.id}=${option.value}`
				const current = currentValue(context, point.id)
				entries.push({
					id: spec,
					label: `Set ${label} to ${optionLabel}`,
					meta: entryMeta(context, spec, label),
					icon: option.icon ?? point.icon,
					keywords: collectKeywords(
						point.id,
						label,
						point.keywords,
						option.value,
						optionLabel,
						option.keywords
					),
					categories: entryCategories(point),
					// No values context = enabled (adapters with live values
					// refine via the store); otherwise disable the current value.
					can: option.can !== false && (current === undefined || current !== option.value),
					run: spec,
					uses: point.uses,
				})
			}
			continue
		}
		if (point.type === 'number') {
			for (const [action, actionLabel, actionKeywords] of [
				['inc', `Increase ${label}`, ['increase', 'increment', 'up', 'more']],
				['dec', `Decrease ${label}`, ['decrease', 'decrement', 'down', 'less']],
			] as const) {
				const spec = `${point.id}:${action}`
				entries.push({
					id: spec,
					label: actionLabel,
					meta: entryMeta(context, spec, `Adjust ${label}`),
					icon: point.icon,
					keywords: collectKeywords(point.id, label, point.keywords, actionKeywords),
					categories: entryCategories(point),
					// Bounds-aware when values context is present; enabled
					// by default so adapters without live values keep the
					// old behaviour (they refine via `canRunAction`).
					can: catalog ? undefined : numberActionEnabled(context, point, action),
					run: spec,
					uses: point.uses,
				})
			}
		}
	}
	return entries
}

/** Build the add-item entries used when creating new toolbar items. */
export function paletteAddItemEntries(
	points: readonly AnyPoint[],
	context: CommandBoxContext = {},
	options: { excludeTools?: readonly string[] } = {}
): readonly AddItemSource[] {
	const excluded = new Set(options.excludeTools ?? [])
	const entries: AddItemSource[] = []
	for (const point of points) {
		if (excluded.has(point.id)) continue
		if (isActionPoint(point)) continue
		if (!isValuedPoint(point)) continue
		// Enum points collapse to one catalog row (no per-option add source).
		if (point.type === 'enum') continue
		const label = point.label ?? humanizeCommandText(point.id)
		entries.push({
			id: `tool:${point.id}`,
			kind: 'tool',
			toolId: point.id,
			label,
			meta: `Add ${point.type} tool`,
			icon: point.icon,
			keywords: collectKeywords(point.id, label, point.keywords, 'add', 'tool'),
			categories: entryCategories(point, ['tools']),
		})
	}
	for (const editor of context.itemEditors ?? []) {
		entries.push({
			id: `item:${editor}`,
			kind: 'item',
			editor,
			label: humanizeCommandText(editor),
			meta: 'Add editor-only item',
			keywords: collectKeywords(editor, 'add', 'editor', 'toolbox'),
			categories: ['editors', 'items'],
		})
	}
	return [...entries].sort((left, right) => left.label.localeCompare(right.label))
}

/** Expand an add-item source into the concrete variants a user can insert. */
export function paletteDerivedVariants(
	source: AddItemSource,
	points: readonly AnyPoint[] = []
): readonly DerivedVariant[] {
	if (source.kind === 'item') {
		return [
			{
				id: `${source.id}:item`,
				kind: 'item',
				editor: source.editor,
				label: source.label,
				meta: 'Editor-only item',
				icon: source.icon,
				keywords: source.keywords,
				categories: source.categories,
			},
		]
	}
	if (source.toolId === undefined) return []
	const point = points.find((candidate) => candidate.id === source.toolId)
	const label = source.label
	if (point !== undefined && isActionPoint(point)) {
		return [
			{
				id: `${source.id}:tool`,
				kind: 'tool',
				toolId: source.toolId,
				label,
				meta: 'Toolbar command',
				icon: source.icon,
				keywords: collectKeywords(source.toolId, label, point.keywords),
				categories: [...(source.categories ?? []), 'tool'],
				spec: source.toolId,
			},
		]
	}
	if (point === undefined || !isValuedPoint(point)) {
		// No point metadata (adapter passed sources without points): fall back
		// to a generic `set` variant carrying the bare tool spec.
		return [
			{
				id: `${source.id}:set`,
				kind: 'set',
				toolId: source.toolId,
				label: `${label} (editor)`,
				meta: 'Control — configure in inspector',
				icon: source.icon,
				keywords: collectKeywords(source.toolId, label, 'set', 'value'),
				categories: [...(source.categories ?? []), 'derived'],
				spec: source.toolId,
			},
		]
	}
	if (point.type === 'boolean') {
		return [
			{
				id: `${source.id}:set`,
				kind: 'set',
				toolId: source.toolId,
				label: `${label} (editor)`,
				meta: 'Control — configure on/off in inspector',
				icon: source.icon,
				keywords: collectKeywords(source.toolId, label, point.keywords, 'set', 'toggle'),
				categories: [...(source.categories ?? []), 'derived'],
				valueType: 'boolean',
				spec: source.toolId,
			},
		]
	}
	if (point.type === 'enum') {
		return [
			{
				id: `${source.id}:set`,
				kind: 'set',
				toolId: source.toolId,
				label: `${label} (editor)`,
				meta: 'Control — choose mode in inspector',
				icon: source.icon,
				keywords: collectKeywords(source.toolId, label, point.keywords, 'set', 'value'),
				categories: [...(source.categories ?? []), 'derived'],
				valueType: 'enum',
				values:
					(point.constraints as { readonly options?: readonly EnumOption[] } | undefined)
						?.options ?? [],
				spec: source.toolId,
			},
		]
	}
	return [
		{
			id: `${source.id}:set`,
			kind: 'set',
			toolId: source.toolId,
			label: `${label} (editor)`,
			meta: 'Control — numeric field in inspector',
			icon: source.icon,
			keywords: collectKeywords(source.toolId, label, point.keywords, 'set', 'value'),
			categories: [...(source.categories ?? []), 'derived'],
			valueType: 'number',
			spec: source.toolId,
		},
	]
}

/**
 * Filter enum values using keyword matches derived from option keywords.
 * Pure helper for enum-subset editors (dot-separated names split into words).
 */
export function paletteEnumSubsetValues<TValue extends string>(options: {
	values: readonly EnumOption<TValue>[]
	keywords?: readonly string[]
}): readonly EnumOption<TValue>[] {
	const keywords = options.keywords?.map((entry) => normalizeToken(entry)).filter(Boolean)
	if (keywords === undefined || keywords.length === 0) return options.values
	return options.values.filter((value) => {
		const actual = new Set(enumValueKeywords(value).map((entry) => normalizeToken(entry)))
		for (const keyword of keywords) {
			if (actual.has(keyword)) return true
		}
		return false
	})
}

/**
 * Expand an enum value into searchable keywords (dot-separated names split).
 * Categories are included alongside value/label/keywords so `#categoryName`
 * filters match option-level categories too, not just point-level.
 */
export function enumValueKeywords<TValue extends string>(value: EnumOption<TValue>): string[] {
	const result = new Set<string>()
	for (const entry of [
		value.value,
		value.label,
		...(value.categories ?? []),
		...(value.keywords ?? []),
	]) {
		if (typeof entry !== 'string') continue
		const normalized = entry.trim()
		if (normalized === '') continue
		result.add(normalized)
		for (const part of splitCommandWords(normalized)) result.add(part)
	}
	return [...result]
}

// ── Headless query model (vanilla `(entries, query) => results`) ────────────
// The svelte adapter wraps these in `$derived`; core stays rune-free.

function entrySearchData(
	entry: Pick<CommandBoxEntry, 'id' | 'label' | 'meta' | 'keywords' | 'categories'>
): {
	keywords: string[]
	categories: string[]
	searchable: string
	label: string
} {
	const keywords = uniqueNormalized(entry.keywords ?? [])
	const categories = uniqueNormalized(entry.categories ?? [])
	const searchable = normalizeToken(
		[entry.id, entry.label, entry.meta ?? '', ...keywords, ...categories].join(' ')
	)
	return {
		keywords: keywords.map((keyword) => normalizeToken(keyword)),
		categories: categories.map((category) => normalizeToken(category)),
		searchable,
		label: normalizeToken(entry.label),
	}
}

function entryScore(
	entry: Pick<CommandBoxEntry, 'id' | 'label' | 'meta' | 'keywords' | 'categories'>,
	freeTerms: readonly string[]
): number {
	const data = entrySearchData(entry)
	let score = 0
	for (const term of freeTerms) {
		if (data.label === term) score += 8
		else if (data.label.startsWith(term)) score += 5
		else if (data.searchable.includes(term)) score += 2
	}
	return score
}

/**
 * Filter + rank entries for a query. `can: false` entries are excluded.
 * Pure `(entries, query) => results` — the svelte `resultsValue`
 * `$derived.by` chain without the runes.
 */
export function filterCommandEntries(
	entries: readonly CommandBoxEntry[],
	query: CommandBoxQuery
): readonly CommandBoxEntry[] {
	const freeTerms = tokenizeQuery(query.free ?? '').map((term) => normalizeToken(term))
	const categoryTerms = (query.categories ?? []).map((term) => normalizeToken(term))
	const keywordTerms = (query.keywords ?? []).map((term) => normalizeToken(term))
	return [...entries]
		.filter((entry) => {
			if (entry.can === false) return false
			const data = entrySearchData(entry)
			if (!matchesAllTerms(data.searchable, freeTerms)) return false
			if (
				!keywordTerms.every(
					(term) => data.keywords.includes(term) || data.searchable.includes(term)
				)
			) {
				return false
			}
			if (!categoryTerms.every((term) => data.categories.includes(term))) return false
			return true
		})
		.sort((left, right) => {
			const score = entryScore(right, freeTerms) - entryScore(left, freeTerms)
			if (score !== 0) return score
			return left.label.localeCompare(right.label)
		})
}

/** Keyword suggestion presented while typing. */
export type CommandBoxKeywordSuggestion = {
	readonly keyword: string
	readonly isActive: boolean
}

/**
 * Suggest keywords completing the last input word from the current results.
 * Pure — the svelte `suggestionsValue` `$derived.by` chain without the runes.
 */
export function suggestCommandKeywords(
	entries: readonly CommandBoxEntry[],
	input: string,
	activeKeywords: readonly string[] = []
): readonly CommandBoxKeywordSuggestion[] {
	const currentWord = tokenizeQuery(input).at(-1)
	const prefix = currentWord !== undefined ? normalizeToken(currentWord.replace(/^#/, '')) : ''
	if (prefix === '' || currentWord?.startsWith('#')) return []
	const active = new Set(activeKeywords.map((keyword) => normalizeToken(keyword)))
	const remaining = new Set<string>()
	for (const entry of entries) {
		for (const keyword of entry.keywords ?? []) {
			const normalized = normalizeToken(keyword)
			if (!active.has(normalized)) remaining.add(keyword)
		}
	}
	return [...remaining]
		.filter((keyword) => normalizeToken(keyword).startsWith(prefix))
		.sort((left, right) => left.localeCompare(right))
		.map((keyword) => ({ keyword, isActive: false }))
}

/**
 * Parse raw input into categories (`#name`), known keywords, and free text.
 * Pure — the svelte `parsedInput` `$derived.by` chain without the runes.
 */
export function parseCommandInput(
	input: string,
	availableCategories: readonly string[],
	availableKeywords: readonly string[]
): { categories: string[]; keywords: string[]; text: string } {
	const categoryAliases: Record<string, string> = {}
	for (const category of availableCategories) categoryAliases[normalizeToken(category)] = category
	const keywordAliases: Record<string, string> = {}
	for (const keyword of availableKeywords) keywordAliases[normalizeToken(keyword)] = keyword
	const categories: string[] = []
	const keywords: string[] = []
	const textTokens: string[] = []
	for (const token of tokenizeQuery(input)) {
		const categoryToken = token.startsWith('#') ? token.slice(1) : token
		const category = categoryAliases[normalizeToken(categoryToken)]
		if (category !== undefined && token.startsWith('#')) {
			if (!categories.includes(category)) categories.push(category)
			continue
		}
		const keyword = keywordAliases[normalizeToken(token)]
		if (keyword !== undefined) {
			if (!keywords.includes(keyword)) keywords.push(keyword)
			continue
		}
		textTokens.push(token)
	}
	return { categories, keywords, text: textTokens.join(' ') }
}

/** Available categories across entries (sorted, de-duplicated). */
export function availableEntryCategories(entries: readonly CommandBoxEntry[]): readonly string[] {
	return uniqueNormalized(entries.flatMap((entry) => entry.categories ?? [])).sort((left, right) =>
		left.localeCompare(right)
	)
}

/** Available keywords across entries (sorted, de-duplicated). */
export function availableEntryKeywords(entries: readonly CommandBoxEntry[]): readonly string[] {
	return uniqueNormalized(entries.flatMap((entry) => entry.keywords ?? [])).sort((left, right) =>
		left.localeCompare(right)
	)
}
