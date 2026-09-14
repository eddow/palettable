/**
 * `@palettable/core` — point definitions (no layout, no DOM).
 *
 * Vocabulary: **point** = a data definition, either runnable (an action) or
 * valued (state with a restorable default). Points carry no layout; toolbar
 * binding lives in `layout.ts`, value state in `store.ts`.
 */
import type { IconToken } from './identifiers.js'
import type { EnumOption, PointType, TypeConstraints, TypeMap } from './type.js'

/** Shared metadata for every point. Arrays are readonly — points are definitions. */
export type PointBase<K extends PointType = PointType> = {
	readonly id: string
	readonly label: string
	readonly type: K
	readonly description?: string
	readonly categories?: readonly string[]
	readonly keywords?: readonly string[]
	readonly icon?: IconToken
}

/** Runnable point: an imperative action (e.g. `saveGame`, `console`). */
export type ActionPoint = PointBase<'action'> & {
	readonly defaultValue?: undefined
	/** Execute the action. May return a promise; core never awaits it. */
	run(): void | Promise<void>
	/** Static enablement flag. Reactive enablement lives in adapters. */
	readonly can?: boolean
}

/** Valued point: runtime state with a restorable default. */
export type ValuedPoint<K extends PointType = Exclude<PointType, 'action'>> = PointBase<K> & {
	readonly defaultValue: TypeMap[K]
	/** Constraint payload; custom types without a `TypeConstraints` entry use `unknown`. */
	readonly constraints?: K extends keyof TypeConstraints ? TypeConstraints[K] : unknown
}

/** Narrow helpers for the built-ins (docs + narrowing; custom types use `ValuedPoint<K>`). */
export type BooleanPoint = ValuedPoint<'boolean'>
export type NumberPoint = ValuedPoint<'number'>
export type StringPoint = ValuedPoint<'string'>
export type EnumPoint<T extends string = string> = Omit<
	ValuedPoint<'enum'>,
	'defaultValue' | 'constraints'
> & {
	readonly defaultValue: T
	readonly constraints: { readonly options: readonly EnumOption<T>[] }
}

/** Any valued point (excludes `'action'` so `defaultValue` is always present). */
export type AnyValuedPoint = ValuedPoint<Exclude<PointType, 'action'>>
/** Any point the core accepts. */
export type AnyPoint = ActionPoint | AnyValuedPoint

/** Points map — heterogeneous by design (`Record<string, AnyPoint>`). */
export type PointsMap = Record<string, AnyPoint>

/** Type guards (null-safe; an action point never carries `defaultValue`). */
export function isActionPoint(point: AnyPoint | null | undefined): point is ActionPoint {
	return point != null && point.type === 'action' && 'run' in point
}

export function isValuedPoint(point: AnyPoint | null | undefined): point is AnyValuedPoint {
	return point != null && point.type !== 'action' && 'defaultValue' in point
}
