/**
 * `@palettable/core` — virtual points (end-user-defined derived points).
 *
 * Virtual points bind no layout and hold no value in the store. They are
 * computed views over a **source** valued point:
 *
 * - **`enum-from`** — present any valued point (a number, a string, a custom
 *   `color`, …) as an enum: a fixed option list where each option carries the
 *   source value to write. Also covers enum subsets (source is an `enum`
 *   point, options are an allow-list).
 *
 * Matching uses `Object.is` (same contract as `PaletteStateStore.set`).
 * All helpers here are pure (values in → values out); `PaletteCore` wires
 * them to the store. Zero DOM.
 */
import { PaletteError } from './errors.js'
import type { IconToken } from './identifiers.js'
import type { AnyPoint, AnyValuedPoint } from './points.js'
import { isValuedPoint } from './points.js'

/** One `enum-from` option: `key` is the virtual enum value, `value` the source value written. */
export type VirtualEnumOption<V = unknown> = {
	readonly key: string
	readonly value: V
	readonly label?: string
	readonly icon?: IconToken
	readonly keywords?: readonly string[]
	readonly can?: boolean
}

/** Shared metadata for virtual points (mirrors `PointBase`, plus `source`). */
export type VirtualPointBase = {
	readonly id: string
	readonly label: string
	readonly description?: string
	readonly keywords?: readonly string[]
	readonly icon?: IconToken
	/** Source valued-point id this virtual point derives from. */
	readonly source: string
}

/**
 * Virtual enum over any valued point.
 *
 * @example number presets — `{ id: 'speedPreset', kind: 'enum-from', source: 'gameSpeed',
 *   options: [{ key: 'slow', value: 0.5 }, { key: 'normal', value: 1 }] }`
 * @example enum subset — source is an `enum` point, `options` list the allowed
 *   subset (each option `value` must equal a source option value).
 */
export type EnumFromDefinition<V = unknown> = VirtualPointBase & {
	readonly kind: 'enum-from'
	readonly options: readonly VirtualEnumOption<V>[]
}

export type VirtualPoint<V = unknown> = EnumFromDefinition<V>

export function isEnumFromPoint(
	point: VirtualPoint | null | undefined
): point is EnumFromDefinition {
	return point != null && point.kind === 'enum-from'
}

/** Narrow guard: an inline virtual definition (vs a point id string). */
export function isInlineSpec(spec: unknown): spec is VirtualPoint {
	return (
		typeof spec === 'object' && spec !== null && (spec as { kind?: unknown }).kind === 'enum-from'
	)
}

/**
 * Validate a virtual definition against the point registry.
 * Throws `PaletteError` on id collision, unknown/action source, empty or
 * duplicate option keys. Callers pass every id already in use (point ids +
 * virtual ids, minus the definition itself when re-defining).
 */
export function assertValidVirtual(
	virtual: VirtualPoint,
	definitions: ReadonlyMap<string, AnyPoint>,
	idsInUse: ReadonlySet<string>
): void {
	if (idsInUse.has(virtual.id)) throw new PaletteError(`duplicate point id "${virtual.id}"`)
	const source = definitions.get(virtual.source)
	if (source === undefined)
		throw new PaletteError(`virtual "${virtual.id}": unknown source point "${virtual.source}"`)
	if (!isValuedPoint(source))
		throw new PaletteError(`virtual "${virtual.id}": source "${virtual.source}" is an action`)
	if (virtual.source === virtual.id)
		throw new PaletteError(`virtual "${virtual.id}": source cannot be itself`)
	if (isEnumFromPoint(virtual)) {
		if (virtual.options.length === 0)
			throw new PaletteError(`virtual "${virtual.id}": enum-from needs at least one option`)
		const keys = new Set<string>()
		for (const option of virtual.options) {
			if (keys.has(option.key))
				throw new PaletteError(`virtual "${virtual.id}": duplicate option key "${option.key}"`)
			keys.add(option.key)
		}
	}
}

/** First option whose source `value` `Object.is`-matches (options order wins). */
export function matchEnumOption<V>(
	virtual: EnumFromDefinition<V>,
	sourceValue: unknown
): VirtualEnumOption<V> | undefined {
	return virtual.options.find((option) => Object.is(option.value, sourceValue))
}

/** Option key for a source value, or `undefined` when no option matches. */
export function readEnumFrom<V>(
	virtual: EnumFromDefinition<V>,
	sourceValue: unknown
): string | undefined {
	return matchEnumOption(virtual, sourceValue)?.key
}

/** Source value for an option key. Throws `PaletteError` on unknown key. */
export function resolveEnumSourceValue<V>(virtual: EnumFromDefinition<V>, key: string): V {
	const option = virtual.options.find((entry) => entry.key === key)
	if (option === undefined)
		throw new PaletteError(`virtual "${virtual.id}": unknown option "${key}"`)
	return option.value
}

/** Resolve + narrow the source definition of a virtual point (throws on misuse). */
export function resolveVirtualSource(
	virtual: VirtualPoint,
	definitions: ReadonlyMap<string, AnyPoint>
): AnyValuedPoint {
	const source = definitions.get(virtual.source)
	if (!isValuedPoint(source))
		throw new PaletteError(`virtual "${virtual.id}": unknown source point "${virtual.source}"`)
	return source
}
