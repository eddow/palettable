/**
 * `@palettable/core` — unified query catalogs (actionable / addable / bindable).
 *
 * Three thin constructors over one shared row-building core, replacing the
 * overlapping `paletteCommandEntries` / `paletteAddItemEntries` /
 * `paletteDerivedVariants` trio (`command-box.ts` keeps thin adapters over
 * the first two). Shared text/keyword helpers live here as well;
 * `command-box.ts` imports them, never the reverse (no runtime cycle):
 *
 * - `actionableEntries(points, context)` — client-only, for run surfaces
 *   (toolbar command box, console run mode). Concrete executable rows only
 *   (`needsParam: false`, `run` always set), overlaid with live `can` +
 *   `uses` passthrough. Never SSR.
 * - `addableEntries(points, context)` — SSR-safe, for edit surfaces
 *   (console edit mode). One row per point — valued + **action** (the legacy
 *   builder skipped actions, so no Save button could be added) + nothing
 *   (1:1 by name) — plus control-only item fallbacks. No `can` / `uses`.
 * - `bindableEntries(points, context)` — SSR-safe, for key binding.
 *   Actions plus generic parametric identities (`id=?`, `id+=?` with a
 *   default delta — the binding UI prompts for identity + value) plus
 *   concrete per-value shortcuts (enum sets, boolean on/off/toggle)
 *   that bind directly with no prompt. No `can` / `uses`.
 *
 * Shared shape: every row carries `kind` + `point` + optional `value` /
 * `delta` + `keywords` (+ `uses` only on actionable). Generic rows carry
 * the param key present-but-`undefined` (`value: undefined`) so the binding
 * UI knows a value is needed; concrete rows carry it set. Labels, keyword
 * families, default steps and runnable ids are shared helpers — a single
 * implementation, no second scorer: rows filter through the generic
 * `filterCommandEntries` in `command-box.ts`.
 *
 * Registered virtuals are intentionally NOT enumerated: a key or command
 * can still name a virtual id at execution time via `PaletteCore.run` /
 * `PaletteCore.can` (the runnable point names the virtual id).
 */
import type { CommandBoxContext } from './command-box.js'
import type { IconToken } from './identifiers.js'
import { findKeystrokesFor } from './keys.js'
import type { AnyPoint, NumberPoint } from './points.js'
import { isActionPoint, isNothingPoint, isValuedPoint } from './points.js'
import type { Runnable } from './runnable.js'
import { runnableKey } from './runnable.js'
import type { EnumOption } from './type.js'

// ── Shared text + keyword helpers (single source of truth) ─────────────────
// Owned here so the catalog builders below and the legacy `command-box.ts`
// adapters share one implementation (`command-box.ts` imports from this
// module — never the reverse — so there is no runtime cycle). Names stay
// available through the `@palettable/core` barrel exactly as before.

export function normalizeToken(value: string): string {
	return value.trim().toLowerCase()
}

export function uniqueNormalized(values: readonly string[]): string[] {
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

export function splitCommandWords(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[^a-zA-Z0-9]+/g, ' ')
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
}

export function humanizeCommandText(value: string): string {
	const words = splitCommandWords(value)
	if (words.length === 0) return value
	return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}

export function collectKeywords(...sources: (string | readonly string[] | undefined)[]): string[] {
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

export function entryMeta(
	context: CommandBoxContext,
	runnable: Runnable,
	fallback: string
): string {
	if (context.keys === undefined) return fallback
	const keys = findKeystrokesFor(context.keys, runnable.point)
	return keys.length > 0 ? keys.join(' / ') : fallback
}

/** Stable row id for a runnable (selection, dedup, test assertions). */
export function entryIdOf(runnable: Runnable): string {
	return runnableKey(runnable)
}

/**
 * Bounds `can` for a number step entry from plain-data context.
 * (`value + delta <= max`, `value + delta >= min`, epsilon for float drift),
 * mirroring `stepCan` in `core.ts` — but lenient: no values context (or a
 * non-number current) = enabled, so adapters without live values keep the
 * old default. Adapters with live values refine via `PaletteCore.can`
 * at render time.
 */
export function numberStepEnabled(
	context: Pick<CommandBoxContext, 'values'>,
	point: AnyPoint,
	delta: number
): boolean {
	const current = currentValue(context, point.id)
	if (typeof current !== 'number' || !Number.isFinite(current)) return true
	const constraints = (point as NumberPoint).constraints ?? {}
	const epsilon = Number.EPSILON * Math.max(1, Math.abs(current), Math.abs(delta)) * 8
	if (delta >= 0)
		return constraints.max === undefined || current + delta <= constraints.max + epsilon
	return constraints.min === undefined || current + delta >= constraints.min - epsilon
}

/** Executable activity of a catalog row. */
export type CatalogKind = 'action' | 'set' | 'toggle' | 'inc' | 'dec'

type CatalogBase = {
	readonly id: string
	readonly kind: CatalogKind
	/** Owning point id (use `id`/`run` for the runnable identity). */
	readonly point: string
	/**
	 * Concrete value for `set` rows (enum option value, boolean, …).
	 * Present-but-`undefined` on generic rows = the binding UI must prompt.
	 */
	readonly value?: unknown
	/** Signed step amount for `inc` / `dec` rows (default prefilled, binding may override). */
	readonly delta?: number
	/** True for generic/parametric rows (binding UI prompts for the value). */
	readonly needsParam: boolean
	readonly label: string
	readonly meta: string
	readonly icon?: IconToken
	readonly keywords: readonly string[]
}

/**
 * Concrete executable row (run surfaces). `run` is always a `Runnable` for
 * `PaletteCore.run(runnable)` — never a closure (SSR-safe by shape, though
 * the list itself is client-only: `can` needs live values). `can: false`
 * rows are filtered from results; `can: undefined` = enabled.
 */
export type ActionableEntry = CatalogBase & {
	readonly needsParam: false
	/** Runnable description to execute via `PaletteCore.run(runnable)`. */
	readonly run: Runnable
	readonly can?: boolean
	/** Context bags (filter at render, never build-time precompile). */
	readonly uses?: readonly string[]
}

/**
 * Binding identity (key editor). Generic rows (`needsParam: true`) carry
 * `id` as a parametric identity (`point=?`, `point+=?` — display-only,
 * never passed to `run`) with the default prefilled (`delta` for steps);
 * concrete rows carry an executable `run` runnable and bind with no prompt.
 * No `can` / `uses` — configuration-time, SSR-safe.
 */
export type BindableEntry = CatalogBase & {
	readonly run?: Runnable
}

/** Point + activity identity for the add flow (edit surfaces). No `can` / `uses`. */
export type AddableEntry = {
	readonly id: string
	readonly label: string
	readonly meta: string
	readonly icon?: IconToken
	readonly keywords: readonly string[]
	readonly kind: 'tool' | 'item'
	readonly pointId?: string
	readonly control?: string
	/** What adding this row creates (action button, valued control, nothing tool, control-only). */
	readonly activity: 'action' | 'valued' | 'nothing' | 'item'
}

// ── Shared helpers (single implementation for all three lists) ──────────────

function pointLabel(point: AnyPoint): string {
	return point.label ?? humanizeCommandText(point.id)
}

function defaultStepOf(point: AnyPoint): number {
	return (point as { constraints?: { readonly step?: number } }).constraints?.step ?? 1
}

function enumOptionsOf(point: AnyPoint): readonly EnumOption[] {
	return (
		(point as { constraints?: { readonly options?: readonly EnumOption[] } }).constraints
			?.options ?? []
	)
}

function currentValue(context: CommandBoxContext, id: string): unknown {
	return context.values?.[id]
}

function actionEnabled(context: CommandBoxContext, id: string): boolean {
	return context.actionCan?.[id] ?? true
}

/** Boolean keyword families. No `unset` (shell confusion) — `clear` / `deactivate` instead. */
const TOGGLE_KEYWORDS = ['toggle', 'switch', 'flip'] as const
const ON_KEYWORDS = ['enable', 'on', 'true', 'activate', 'set'] as const
const OFF_KEYWORDS = ['disable', 'off', 'false', 'deactivate', 'clear'] as const
const STEP_UP_KEYWORDS = ['increase', 'increment', 'up', 'more'] as const
const STEP_DOWN_KEYWORDS = ['decrease', 'decrement', 'down', 'less'] as const

// ── Actionable (run surfaces: command box, console run mode) ────────────────
// Mirrors the `paletteCommandEntries` run branch row-for-row (same ids,
// labels, metas, keywords, `can`), plus `kind` / `point` / `value` / `delta`.

/**
 * Build the executable command rows for a point list. Concrete rows only —
 * every entry runs directly via `PaletteCore.run(entry.run)`. Live `can`
 * overlaid from plain-data context (values bounds, action flags); `uses`
 * passed through for render-time filtering. Client-only (never SSR).
 */
export function actionableEntries(
	points: readonly AnyPoint[],
	context: CommandBoxContext = {},
	options: { excludePoints?: readonly string[] } = {}
): readonly ActionableEntry[] {
	const excluded = new Set(options.excludePoints ?? [])
	const entries: ActionableEntry[] = []
	for (const point of points) {
		if (excluded.has(point.id)) continue
		const label = pointLabel(point)
		if (isActionPoint(point)) {
			const run: Runnable = { kind: 'action', point: point.id }
			entries.push({
				id: entryIdOf(run),
				kind: 'action',
				point: point.id,
				value: undefined,
				needsParam: false,
				label,
				meta: entryMeta(context, run, 'Run command'),
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords),
				run,
				can: actionEnabled(context, point.id),
				uses: point.uses,
			})
			continue
		}
		if (!isValuedPoint(point)) continue
		if (point.type === 'boolean') {
			const toggleRun: Runnable = { kind: 'toggle', point: point.id }
			entries.push({
				id: entryIdOf(toggleRun),
				kind: 'toggle',
				point: point.id,
				value: undefined,
				needsParam: false,
				label: `Toggle ${label}`,
				meta: entryMeta(context, toggleRun, `Toggle ${label}`),
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords, [...TOGGLE_KEYWORDS]),
				run: toggleRun,
				can: currentValue(context, point.id) !== undefined,
				uses: point.uses,
			})
			for (const [value, verb, family] of [
				[true, 'Enable', ON_KEYWORDS],
				[false, 'Disable', OFF_KEYWORDS],
			] as const) {
				const run: Runnable = { kind: 'set', point: point.id, value }
				entries.push({
					id: entryIdOf(run),
					kind: 'set',
					point: point.id,
					value,
					needsParam: false,
					label: `${verb} ${label}`,
					meta: entryMeta(context, run, `Set ${label}`),
					icon: point.icon,
					keywords: collectKeywords(point.id, label, point.keywords, [...family]),
					run,
					can: currentValue(context, point.id) !== value,
					uses: point.uses,
				})
			}
			continue
		}
		if (point.type === 'enum') {
			for (const option of enumOptionsOf(point)) {
				const optionLabel = option.label ?? humanizeCommandText(option.value)
				const run: Runnable = { kind: 'set', point: point.id, value: option.value }
				const current = currentValue(context, point.id)
				entries.push({
					id: entryIdOf(run),
					kind: 'set',
					point: point.id,
					value: option.value,
					needsParam: false,
					label: `Set ${label} to ${optionLabel}`,
					meta: entryMeta(context, run, label),
					icon: option.icon ?? point.icon,
					keywords: collectKeywords(
						point.id,
						label,
						point.keywords,
						option.value,
						optionLabel,
						option.keywords
					),
					run,
					can: option.can !== false && (current === undefined || current !== option.value),
					uses: point.uses,
				})
			}
			continue
		}
		if (point.type === 'number') {
			const step = defaultStepOf(point)
			for (const [delta, actionLabel, family] of [
				[step, `Increase ${label}`, STEP_UP_KEYWORDS],
				[-step, `Decrease ${label}`, STEP_DOWN_KEYWORDS],
			] as const) {
				const run: Runnable =
					delta >= 0
						? { kind: 'inc', point: point.id, delta }
						: { kind: 'dec', point: point.id, delta: Math.abs(delta) }
				entries.push({
					id: entryIdOf(run),
					kind: delta >= 0 ? 'inc' : 'dec',
					point: point.id,
					value: undefined,
					delta: Math.abs(delta),
					needsParam: false,
					label: actionLabel,
					meta: entryMeta(context, run, `Adjust ${label}`),
					icon: point.icon,
					keywords: collectKeywords(point.id, label, point.keywords, [...family]),
					run,
					can: numberStepEnabled(context, point, delta),
					uses: point.uses,
				})
			}
		}
		// string / custom types: no concrete row (value is free-form — the
		// binding UI covers them via the generic `set` identity instead).
	}
	return entries
}

// ── Addable (edit surfaces: console edit mode) ───────────────────────────────
// One row per point (valued + action + nothing) plus control-only fallbacks.
// SSR-safe: no `can`, no `uses`, no closures.

/**
 * Build the add-item rows for a point list. Every point is addable —
 * including actions (the legacy builder skipped them, so e.g. no Save
 * button could be added). Nothing-points list by point name (1:1 binding);
 * `context.itemControls` survives only as a fallback for controls no
 * nothing-point claims. Sorted by label.
 */
export function addableEntries(
	points: readonly AnyPoint[],
	context: Pick<CommandBoxContext, 'itemControls'> = {},
	options: { excludePoints?: readonly string[] } = {}
): readonly AddableEntry[] {
	const excluded = new Set(options.excludePoints ?? [])
	const entries: AddableEntry[] = []
	for (const point of points) {
		if (excluded.has(point.id)) continue
		const label = pointLabel(point)
		if (isActionPoint(point)) {
			entries.push({
				id: `tool:${point.id}`,
				label,
				meta: 'Add action',
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords, 'add', 'tool'),
				kind: 'tool',
				pointId: point.id,
				activity: 'action',
			})
			continue
		}
		if (isNothingPoint(point)) {
			entries.push({
				id: `tool:${point.id}`,
				label,
				meta: 'Add tool',
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords, 'add', 'tool'),
				kind: 'tool',
				pointId: point.id,
				activity: 'nothing',
			})
			continue
		}
		if (!isValuedPoint(point)) continue
		entries.push({
			id: `tool:${point.id}`,
			label,
			meta: `Add ${point.type} tool`,
			icon: point.icon,
			keywords: collectKeywords(point.id, label, point.keywords, 'add', 'tool'),
			kind: 'tool',
			pointId: point.id,
			activity: 'valued',
		})
	}
	for (const control of context.itemControls ?? []) {
		const claimed = points.some(
			(point) =>
				isNothingPoint(point) && !excluded.has(point.id) && point.controls?.includes(control)
		)
		if (claimed) continue
		entries.push({
			id: `item:${control}`,
			label: humanizeCommandText(control),
			meta: 'Add control-only item',
			keywords: collectKeywords(control, 'add', 'control', 'toolbox'),
			kind: 'item',
			control,
			activity: 'item',
		})
	}
	return [...entries].sort((left, right) => left.label.localeCompare(right.label))
}

// ── Bindable (key editor) ────────────────────────────────────────────────────
// Actions + generic parametric identities + concrete per-value shortcuts.
// SSR-safe: no `can`, no `uses`, no closures.

/**
 * Build the bindable rows for a point list. Generic affectations carry the
 * param key present-but-unset (`value: undefined`, step identities carry
 * the default `delta`) with `needsParam: true` — the key editor prompts
 * for identity + value. Concrete per-value shortcuts (enum `id=value`,
 * boolean on/off/toggle) carry `needsParam: false` + `run` and bind with
 * no prompt. Nothing-points are excluded (not runnable — binding one
 * would throw in `run`).
 */
export function bindableEntries(
	points: readonly AnyPoint[],
	context: Pick<CommandBoxContext, 'keys'> = {},
	options: { excludePoints?: readonly string[] } = {}
): readonly BindableEntry[] {
	const excluded = new Set(options.excludePoints ?? [])
	const entries: BindableEntry[] = []
	const keyContext: CommandBoxContext = { keys: context.keys }
	for (const point of points) {
		if (excluded.has(point.id)) continue
		const label = pointLabel(point)
		if (isActionPoint(point)) {
			const run: Runnable = { kind: 'action', point: point.id }
			entries.push({
				id: entryIdOf(run),
				kind: 'action',
				point: point.id,
				value: undefined,
				needsParam: false,
				label,
				meta: entryMeta(keyContext, run, 'Run command'),
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords),
				run,
			})
			continue
		}
		if (!isValuedPoint(point)) continue
		if (point.type === 'boolean') {
			entries.push({
				id: `${point.id}=?`,
				kind: 'set',
				point: point.id,
				value: undefined,
				needsParam: true,
				label: `Set ${label}…`,
				meta: 'Choose value when binding',
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords, [
					'set',
					'value',
					...ON_KEYWORDS,
					...OFF_KEYWORDS,
					...TOGGLE_KEYWORDS,
				]),
			})
			const toggleRun: Runnable = { kind: 'toggle', point: point.id }
			entries.push({
				id: entryIdOf(toggleRun),
				kind: 'toggle',
				point: point.id,
				value: undefined,
				needsParam: false,
				label: `Toggle ${label}`,
				meta: entryMeta(keyContext, toggleRun, `Toggle ${label}`),
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords, [...TOGGLE_KEYWORDS]),
				run: toggleRun,
			})
			for (const [value, verb, family] of [
				[true, 'Enable', ON_KEYWORDS],
				[false, 'Disable', OFF_KEYWORDS],
			] as const) {
				const run: Runnable = { kind: 'set', point: point.id, value }
				entries.push({
					id: entryIdOf(run),
					kind: 'set',
					point: point.id,
					value,
					needsParam: false,
					label: `${verb} ${label}`,
					meta: entryMeta(keyContext, run, `Set ${label}`),
					icon: point.icon,
					keywords: collectKeywords(point.id, label, point.keywords, [...family]),
					run,
				})
			}
			continue
		}
		if (point.type === 'enum') {
			entries.push({
				id: `${point.id}=?`,
				kind: 'set',
				point: point.id,
				value: undefined,
				needsParam: true,
				label: `Set ${label}…`,
				meta: 'Choose value when binding',
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords, 'set', 'value', 'choose'),
			})
			for (const option of enumOptionsOf(point)) {
				const optionLabel = option.label ?? humanizeCommandText(option.value)
				const run: Runnable = { kind: 'set', point: point.id, value: option.value }
				entries.push({
					id: entryIdOf(run),
					kind: 'set',
					point: point.id,
					value: option.value,
					needsParam: false,
					label: `Set ${label} to ${optionLabel}`,
					meta: entryMeta(keyContext, run, label),
					icon: option.icon ?? point.icon,
					keywords: collectKeywords(
						point.id,
						label,
						point.keywords,
						option.value,
						optionLabel,
						option.keywords
					),
					run,
				})
			}
			continue
		}
		if (point.type === 'number') {
			entries.push({
				id: `${point.id}=?`,
				kind: 'set',
				point: point.id,
				value: undefined,
				needsParam: true,
				label: `Set ${label}…`,
				meta: 'Choose value when binding',
				icon: point.icon,
				keywords: collectKeywords(point.id, label, point.keywords, 'set', 'value'),
			})
			const step = defaultStepOf(point)
			for (const [delta, actionLabel, family] of [
				[step, `Increase ${label}…`, STEP_UP_KEYWORDS],
				[-step, `Decrease ${label}…`, STEP_DOWN_KEYWORDS],
			] as const) {
				entries.push({
					id: `${point.id}${delta >= 0 ? '+=' : '-='}?`,
					kind: delta >= 0 ? 'inc' : 'dec',
					point: point.id,
					value: undefined,
					delta,
					needsParam: true,
					label: actionLabel,
					meta: 'Choose step when binding',
					icon: point.icon,
					keywords: collectKeywords(point.id, label, point.keywords, [...family]),
				})
			}
			continue
		}
		// string / custom types: generic `set` identity only.
		entries.push({
			id: `${point.id}=?`,
			kind: 'set',
			point: point.id,
			value: undefined,
			needsParam: true,
			label: `Set ${label}…`,
			meta: 'Choose value when binding',
			icon: point.icon,
			keywords: collectKeywords(point.id, label, point.keywords, 'set', 'value'),
		})
	}
	return entries
}
