/**
 * `@palettable/core` — point definitions (no layout, no DOM).
 *
 * Vocabulary: **point** = a data definition, either runnable (an action) or
 * valued (state held in the root bag). Points carry no layout and no
 * defaults; toolbar binding lives in `layout.ts`, value state in `store.ts`
 * (single source, starts empty — absent key = skeleton `undefined`).
 * Consumer-owned defaults live outside core (e.g. demo `setMany`).
 */
import type { IconToken } from './identifiers.js'
import type { EnumOption, PointType, TypeConstraints } from './type.js'

/**
 * Root context name — the core-owned bag (`PaletteCore.values`).
 * `isRootContext` also accepts the `'root'` alias for ergonomics;
 * adapters/demos must use this constant, never bare `''` literals.
 */
export const ROOT_CONTEXT = '' as const

/** True for the root bag name (`''`) or its `'root'` alias. */
export function isRootContext(name: string): boolean {
	return name === ROOT_CONTEXT || name === 'root'
}

/** Shared metadata for every point. Arrays are readonly — points are definitions. */
export type PointBase<K extends PointType = PointType> = {
	readonly id: string
	readonly label: string
	readonly type: K
	readonly description?: string
	readonly categories?: readonly string[]
	readonly keywords?: readonly string[]
	readonly icon?: IconToken
	/**
	 * Optional context bags this point operates on.
	 * Each name resolves to `ValuesBag | undefined` (`undefined` = bag not
	 * registered). `undefined` uses = root bag only, as before.
	 * `ROOT_CONTEXT` may appear explicitly to receive the root bag as an
	 * argument.
	 */
	readonly uses?: readonly string[]
	/**
	 * Functional enablement: called with the resolved bags in `uses` order
	 * (each `ValuesBag | undefined`). Omitted = always enabled. Must be
	 * pure and cheap — it runs on every context notify for points using
	 * that bag, plus on demand via `PaletteCore.evaluateCan`.
	 */
	readonly can?: (...bags: readonly (import('./context.js').ValuesBag | undefined)[]) => boolean
}

/** Runnable point: an imperative action (e.g. `saveGame`, `console`). */
export type ActionPoint = PointBase<'action'> & {
	readonly defaultValue?: undefined
	/**
	 * Execute the action. May return a promise; core never awaits it.
	 * Receives the used bags in `uses` order (each `ValuesBag | undefined`)
	 * — the context-aware path; the root-bag `PaletteCore.run(spec)` sugar
	 * calls it with no arguments.
	 */
	run(...bags: readonly (import('./context.js').ValuesBag | undefined)[]): void | Promise<void>
}

/** Valued point: runtime state held in the root bag (absent = skeleton). */
export type ValuedPoint<K extends PointType = Exclude<PointType, 'action' | 'nothing'>> =
	PointBase<K> & {
		/** Constraint payload; custom types without a `TypeConstraints` entry use `unknown`. */
		readonly constraints?: K extends keyof TypeConstraints ? TypeConstraints[K] : unknown
	}

/** Narrow helpers for the built-ins (docs + narrowing; custom types use `ValuedPoint<K>`). */
export type BooleanPoint = ValuedPoint<'boolean'>
export type NumberPoint = ValuedPoint<'number'>
export type StringPoint = ValuedPoint<'string'>
export type EnumPoint<T extends string = string> = Omit<ValuedPoint<'enum'>, 'constraints'> & {
	readonly constraints: { readonly options: readonly EnumOption<T>[] }
}

/** Any valued point (excludes `'action'` / `'nothing'`). */
export type AnyValuedPoint = ValuedPoint<Exclude<PointType, 'action' | 'nothing'>>

/**
 * Nothing-point: context plus optional enablement, no value of its own.
 * How `status`, `command-box`, and `drawer` tools bind 1:1 — each tool binds
 * the nothing-point whose `uses` names its context.
 * Core semantics: `values.get` → `undefined`, `values.set` throws
 * `PaletteError`, `reset` is a no-op, excluded from value serialization
 * (only the binding itself serializes).
 * System-variable rule: display state lives adapter-side (context bags,
 * document root class, …), never in `core.values`. `theme` is the
 * enum-shaped example: options `light`/`dark`/`system`, adapter get/set
 * toggling the document root class.
 */
export type NothingPoint = PointBase<'nothing'> & {
	readonly defaultValue?: undefined
	readonly constraints?: undefined
	/**
	 * Enum-shaped options for nothing-points presenting a fixed choice
	 * (e.g. `theme`: `light`/`dark`/`system`). Display-only: the adapter
	 * owns get/set (document root class, …), core never stores the value.
	 */
	readonly options?: readonly import('./type.js').EnumOption[]
	/**
	 * Allowed editor ids for this point (1:1 binding — e.g. `theme`
	 * allows `['theme']`, a drawer point allows `['drawer']`). Restricts
	 * `editorChoicesFor` / `resolveEditorVariant` to this subset of the
	 * `item` family. Omitted = all `item`-family editors (legacy).
	 */
	readonly editors?: readonly string[]
}

/** Any point the core accepts. */
export type AnyPoint = ActionPoint | AnyValuedPoint | NothingPoint

/** Points map — heterogeneous by design (`Record<string, AnyPoint>`). */
export type PointsMap = Record<string, AnyPoint>

/** Type guards (null-safe; valued = any non-action, non-nothing type). */
export function isActionPoint(point: AnyPoint | null | undefined): point is ActionPoint {
	return point != null && point.type === 'action' && 'run' in point
}

export function isValuedPoint(point: AnyPoint | null | undefined): point is AnyValuedPoint {
	return point != null && point.type !== 'action' && point.type !== 'nothing'
}

/** Narrow guard for nothing-points (`status` / `command-box` / `drawer` / `theme` bindings). */
export function isNothingPoint(point: AnyPoint | null | undefined): point is NothingPoint {
	return point != null && point.type === 'nothing'
}
