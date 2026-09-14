/**
 * `@palettable/core` — extensible point-value type map (declaration merging).
 *
 * Consumers register custom types (e.g. `color`, `date`) via declaration
 * merging:
 *
 * ```ts
 * declare module '@palettable/core' {
 *   interface TypeMap { color: string }
 *   interface TypeConstraints { color: { swatches?: readonly string[] } }
 * }
 * ```
 */
import type { IconToken } from './identifiers.js'

export type EnumOption<T extends string = string> = {
	readonly value: T
	readonly label?: string
	readonly icon?: IconToken
	/** Categories for grouping (e.g. `['flex', 'grid']`) — both group filtering and keyword search. */
	readonly categories?: readonly string[]
	readonly keywords?: readonly string[]
	readonly can?: boolean
}

/**
 * Built-in point-value foundation. Consumers register custom types
 * (e.g. `color`, `date`) via declaration merging (see above).
 */
export interface DefaultTypeMap {
	boolean: boolean
	number: number
	string: string
	/** Enum points store one option value (a string). Options live on the definition. */
	enum: string
	/** Action points hold no value. */
	action: void
	/** Nothing-points hold no value (context + enablement only). */
	nothing: void
}

/** Extension point — augment, never rewrite. */
export interface TypeMap extends DefaultTypeMap {}

/** Every known point type id. */
export type PointType = keyof TypeMap

/** Per-type constraint payloads (min/max, option lists, …). */
export interface DefaultTypeConstraints {
	boolean: Record<string, never>
	number: { readonly min?: number; readonly max?: number; readonly step?: number }
	string: { readonly minLength?: number; readonly maxLength?: number; readonly pattern?: string }
	enum: { readonly options: readonly EnumOption[] }
	action: Record<string, never>
	nothing: Record<string, never>
}

/** Extension point for custom-type constraints. */
export interface TypeConstraints extends DefaultTypeConstraints {}
