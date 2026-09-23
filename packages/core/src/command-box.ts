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
 * - `run` entries are runnables (`{ kind, point, value/delta }`);
 *   adapters execute them via `PaletteCore.run(runnable)`.
 * - Catalogue drag payloads (`PALETTE_CATALOG_DRAG_MIME`,
 *   `serialize/parseCatalogDragPayload`, `paletteToolbarItemFromCatalogPayload`,
 *   `paletteCatalogEntries`) are **deleted per `plans/simplify.md`** (dead
 *   code — zero `draggable=` in `src`): rows are click-to-select, not
 *   draggable. Only runnable payloads survive as plain `{ kind: 'runnable', runnable }`
 *   data (no JSON helpers — adapters serialize if they need to).
 * - `commandBoxEnumCommands` / `per-value` is **deleted per
 *   `plans/simplify.md`** (never set by demo/tools): enum catalog always
 *   collapses to one tool-label row.
 * - `paletteToolbarItemFromSpec` / `paletteToolbarItemFromDerivedVariant`
 *   (which resolve control registries + components) stay adapter-owned —
 *   core has no components. The builders emit runnables + variant descriptors;
 *   adapters map them to items.
 */
import type { IconToken } from './identifiers.js'
import type { KeyBindings } from './keys.js'
import type { AnyPoint } from './points.js'
import { isActionPoint, isNothingPoint, isValuedPoint } from './points.js'
import type { Runnable } from './runnable.js'
import { entryIdOf } from './catalog.js'
import type { EnumOption } from './type.js'

// Shared text/keyword helpers live in `catalog.ts` (single source of truth
// — this module imports them, never the reverse, so there is no runtime
// cycle). Re-exported here so existing imports keep working unchanged.
export {
	type ActionableEntry,
	type AddableEntry,
	actionableEntries,
	addableEntries,
	type BindableEntry,
	bindableEntries,
	type CatalogKind,
	collectKeywords,
	entryMeta,
	humanizeCommandText,
	numberStepEnabled,
	splitCommandWords,
} from './catalog.js'

import type { AddableEntry } from './catalog.js'
import {
	actionableEntries,
	addableEntries,
	collectKeywords,
	normalizeToken,
	splitCommandWords,
	uniqueNormalized,
} from './catalog.js'

/** Search query accepted by `filterCommandEntries`. */
export type CommandBoxQuery = {
	readonly free?: string
	readonly keywords?: readonly string[]
}

/**
 * Command entry built from a point definition. `run` is a runnable for
 * `PaletteCore.run(runnable)` — never a closure (SSR-safe). `can: false`
 * entries are filtered from results; `can: undefined` = enabled.
 */
export type CommandBoxEntry = {
	readonly id: string
	readonly label: string
	readonly meta: string
	readonly icon?: IconToken
	readonly keywords?: readonly string[]
	readonly can?: boolean
	/** Runnable description to execute via `PaletteCore.run(runnable)`. */
	readonly run: Runnable
	/** Optional context bags (Context §2.7 — filter at render, not here). */
	readonly uses?: readonly string[]
}

/** Add-item source — standard addable row (alias kept for compat). */
export type AddItemSource = AddableEntry

/** Concrete variant derived from an add-item source. */
export type DerivedVariant = {
	readonly id: string
	readonly label: string
	readonly meta: string
	readonly icon?: IconToken
	readonly keywords?: readonly string[]
	readonly kind: 'tool' | 'item' | 'set' | 'action'
	readonly pointId?: string
	readonly control?: string
	readonly action?: string
	/** Point id this variant inserts (tools bind the point, value chosen on the bar). */
	readonly spec?: string
	readonly valueType?: 'boolean' | 'number' | 'enum'
	readonly values?: readonly EnumOption[]
}

/** Plain-data context the builders read instead of a live `Palette`. */
export type CommandBoxContext = {
	/** Key bindings for `meta` shortcut labels (`findKeystrokesFor`). */
	readonly keys?: KeyBindings
	/** Current values for `can` computation (e.g. `point.value !== value`). */
	readonly values?: Readonly<Record<string, unknown>>
	/** Static `can` flags for action points (omitted = enabled). */
	readonly actionCan?: Readonly<Record<string, boolean | undefined>>
	/** Control-only item ids for add-item sources (adapter's `controls.item` keys). */
	readonly itemControls?: readonly string[]
}

/**
 * Legacy executable-command builder — thin adapter over `actionableEntries`
 * (same rows, same ids/labels/metas/keywords/`can`). Kept for the frozen
 * svelte adapter + existing tests; new code uses `actionableEntries`.
 * `mode: 'catalog'` keeps the old preset/collapsed rows for catalog display.
 */
export function paletteCommandEntries(
	points: readonly AnyPoint[],
	context: CommandBoxContext = {},
	options: { excludePoints?: readonly string[]; mode?: 'run' | 'catalog' } = {}
): readonly CommandBoxEntry[] {
	if (options.mode === 'catalog') {
		const excluded = new Set(options.excludePoints ?? [])
		return addableEntries(points, context, { excludePoints: [...excluded] }).flatMap(
			(source): readonly CommandBoxEntry[] => {
				if (source.kind === 'item') {
					return []
				}
				const point = points.find((candidate) => candidate.id === source.pointId)
				if (point === undefined) return []
				const run: Runnable = { kind: 'action', point: point.id }
				if (isActionPoint(point)) {
					return [
						{
							id: entryIdOf(run),
							label: source.label,
							meta: 'Run command',
							icon: point.icon,
							keywords: [...source.keywords],
							run,
							uses: point.uses,
						},
					]
				}
				if (isNothingPoint(point)) {
					return [
						{
							id: `tool:${point.id}`,
							label: source.label,
							meta: source.meta,
							icon: point.icon,
							keywords: [...source.keywords],
							run,
							uses: point.uses,
						},
					]
				}
				if (!isValuedPoint(point)) return []
				if (point.type === 'boolean') {
					const presets: readonly Runnable[] = [
						{ kind: 'toggle', point: point.id },
						{ kind: 'set', point: point.id, value: true },
						{ kind: 'set', point: point.id, value: false },
					]
					return presets.map((preset, index) => ({
						id: entryIdOf(preset),
						label: `${source.label} → ${index === 0 ? 'Toggle' : index === 1 ? 'On' : 'Off'} (preset)`,
						meta: 'Preset — toggle on toolbar',
						icon: point.icon,
						keywords: [...source.keywords],
						run: preset,
						uses: point.uses,
					}))
				}
				return [
					{
						id: `${point.id}:catalog-enum`,
						label: source.label,
						meta: 'Control — add to toolbar; value is chosen on the bar or in the inspector',
						icon: point.icon,
						keywords: [...source.keywords],
						run,
						uses: point.uses,
					},
				]
			}
		)
	}
	return actionableEntries(points, context, {
		excludePoints: options.excludePoints,
	}).map((entry) => ({
		id: entry.id,
		label: entry.label,
		meta: entry.meta,
		icon: entry.icon,
		keywords: [...entry.keywords],
		can: entry.can,
		run: entry.run,
		uses: entry.uses,
	}))
}

/**
 * Legacy add-item builder — standard addable list (actions included, so
 * e.g. a Save button can be added). Kept as a named alias for the frozen
 * svelte adapter + existing tests; new code calls `addableEntries` directly.
 */
export function paletteAddItemEntries(
	points: readonly AnyPoint[],
	context: CommandBoxContext = {},
	options: { excludePoints?: readonly string[] } = {}
): readonly AddItemSource[] {
	return addableEntries(points, context, {
		excludePoints: options.excludePoints,
	})
}

/** Split a query into whitespace-separated tokens. */
export function tokenizeQuery(value: string): string[] {
	return value
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0)
}

function matchesAllTerms(haystack: string, terms: readonly string[]): boolean {
	return terms.every((term) => haystack.includes(term))
}

/**
 * Expand an enum value into searchable keywords (dot-separated names split).
 * Keywords are kept for future use (command-box keyword search).
 */
export function trimLastToken(value: string): string {
	const tokens = tokenizeQuery(value)
	tokens.pop()
	return tokens.join(' ')
}

/** Expand an add-item source into the concrete variants a user can insert. */
export function paletteDerivedVariants(
	source: AddableEntry,
	points: readonly AnyPoint[] = []
): readonly DerivedVariant[] {
	if (source.kind === 'item') {
		return [
			{
				id: `${source.id}:item`,
				kind: 'item',
				control: source.control,
				label: source.label,
				meta: 'Control-only item',
				icon: source.icon,
				keywords: source.keywords,
			},
		]
	}
	if (source.pointId === undefined) return []
	const point = points.find((candidate) => candidate.id === source.pointId)
	const label = source.label
	if (point !== undefined && isActionPoint(point)) {
		return [
			{
				id: `${source.id}:tool`,
				kind: 'tool',
				pointId: source.pointId,
				label,
				meta: 'Toolbar command',
				icon: source.icon,
				keywords: collectKeywords(source.pointId, label, point.keywords),
				spec: source.pointId,
			},
		]
	}
	if (point === undefined || (!isValuedPoint(point) && !isNothingPoint(point))) {
		// No point metadata (adapter passed sources without points): fall back
		// to a generic `set` variant carrying the bare point spec.
		return [
			{
				id: `${source.id}:set`,
				kind: 'set',
				pointId: source.pointId,
				label: `${label} (control)`,
				meta: 'Control — configure in inspector',
				icon: source.icon,
				keywords: collectKeywords(source.pointId, label, 'set', 'value'),
				spec: source.pointId,
			},
		]
	}
	if (isNothingPoint(point)) {
		// Nothing-point tool: one variant bound to the point id, control is
		// the point's 1:1 control (`point.controls[0]` when declared).
		const control = point.controls?.[0]
		return [
			{
				id: `${source.id}:tool`,
				kind: 'tool',
				pointId: source.pointId,
				control,
				label,
				meta: 'Add tool',
				icon: source.icon,
				keywords: collectKeywords(source.pointId, label, point.keywords),
				spec: source.pointId,
			},
		]
	}
	if (point.type === 'boolean') {
		return [
			{
				id: `${source.id}:set`,
				kind: 'set',
				pointId: source.pointId,
				label: `${label} (control)`,
				meta: 'Control — configure on/off in inspector',
				icon: source.icon,
				keywords: collectKeywords(source.pointId, label, point.keywords, 'set', 'toggle'),
				valueType: 'boolean',
				spec: source.pointId,
			},
		]
	}
	if (point.type === 'enum') {
		return [
			{
				id: `${source.id}:set`,
				kind: 'set',
				pointId: source.pointId,
				label: `${label} (control)`,
				meta: 'Control — choose mode in inspector',
				icon: source.icon,
				keywords: collectKeywords(source.pointId, label, point.keywords, 'set', 'value'),
				valueType: 'enum',
				values:
					(point.constraints as { readonly options?: readonly EnumOption[] } | undefined)
						?.options ?? [],
				spec: source.pointId,
			},
		]
	}
	return [
		{
			id: `${source.id}:set`,
			kind: 'set',
			pointId: source.pointId,
			label: `${label} (control)`,
			meta: 'Control — numeric field in inspector',
			icon: source.icon,
			keywords: collectKeywords(source.pointId, label, point.keywords, 'set', 'value'),
			valueType: 'number',
			spec: source.pointId,
		},
	]
}

/**
 * Filter enum values using keyword matches derived from option keywords.
 * Pure helper for enum-subset controls (dot-separated names split into words).
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
 * Keywords are kept for future use (command-box keyword search).
 */
export function enumValueKeywords<TValue extends string>(value: EnumOption<TValue>): string[] {
	const result = new Set<string>()
	for (const entry of [value.value, value.label, ...(value.keywords ?? [])]) {
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

function entrySearchData(entry: Pick<CommandBoxEntry, 'id' | 'label' | 'meta' | 'keywords'>): {
	keywords: string[]
	searchable: string
	label: string
} {
	const keywords = uniqueNormalized(entry.keywords ?? [])
	const searchable = normalizeToken(
		[entry.id, entry.label, entry.meta ?? '', ...keywords].join(' ')
	)
	return {
		keywords: keywords.map((keyword) => normalizeToken(keyword)),
		searchable,
		label: normalizeToken(entry.label),
	}
}

function entryScore(
	entry: Pick<CommandBoxEntry, 'id' | 'label' | 'meta' | 'keywords'>,
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
 * Generic over the searchable shape so unified catalog entries
 * (`catalog.ts`) filter through the same implementation — no second scorer.
 */
export function filterCommandEntries<
	T extends Pick<CommandBoxEntry, 'id' | 'label' | 'meta' | 'keywords' | 'can'>,
>(entries: readonly T[], query: CommandBoxQuery): readonly T[] {
	const freeTerms = tokenizeQuery(query.free ?? '').map((term) => normalizeToken(term))
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
	entries: readonly Pick<CommandBoxEntry, 'keywords'>[],
	input: string,
	activeKeywords: readonly string[] = []
): readonly CommandBoxKeywordSuggestion[] {
	const currentWord = tokenizeQuery(input).at(-1)
	const prefix = currentWord !== undefined ? normalizeToken(currentWord) : ''
	if (prefix === '') return []
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
 * Parse raw input into known keywords and free text.
 * Pure — the svelte `parsedInput` `$derived.by` chain without the runes.
 */
export function parseCommandInput(
	input: string,
	availableKeywords: readonly string[]
): { keywords: string[]; text: string } {
	const keywordAliases: Record<string, string> = {}
	for (const keyword of availableKeywords) keywordAliases[normalizeToken(keyword)] = keyword
	const keywords: string[] = []
	const textTokens: string[] = []
	for (const token of tokenizeQuery(input)) {
		const keyword = keywordAliases[normalizeToken(token)]
		if (keyword !== undefined) {
			if (!keywords.includes(keyword)) keywords.push(keyword)
			continue
		}
		textTokens.push(token)
	}
	return { keywords, text: textTokens.join(' ') }
}

/** Available keywords across entries (sorted, de-duplicated). */
export function availableEntryKeywords(
	entries: readonly Pick<CommandBoxEntry, 'keywords'>[]
): readonly string[] {
	return uniqueNormalized(entries.flatMap((entry) => entry.keywords ?? [])).sort((left, right) =>
		left.localeCompare(right)
	)
}
