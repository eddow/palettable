/**
 * `@palettable/core` — point specs (bindings to a point, direct or virtual).
 *
 * A spec is either a string or an inline virtual definition:
 *
 * - **string** — the serializable reference form used by toolbar items and
 *   key bindings: `pointId`, `pointId=value` (setter runner, legacy
 *   `pointId|value` still accepted), or `pointId:action` (action runner,
 *   e.g. `fontSize:inc`). The id may name a point *or* a virtual point
 *   (`pause`, `speedPreset=fast`). Parsing is pure and registry-free;
 *   adapters resolve the parsed id against definitions + virtuals.
 * - **inline virtual** (`EnumFromDefinition` / `StashDefinition`) — a
 *   self-contained derived point carried directly in the spec. It behaves
 *   exactly like the same definition registered under its `id` (same
 *   validation, same run semantics), except its lifetime is the spec itself:
 *   no registry entry, no `defineVirtual` / `removeVirtual`, no id-collision
 *   check against the registry. Serialized data keeps the full definition
 *   object, so configuration + points-list rebuild the run-time structures
 *   without a separate virtuals list.
 */

/**
 * String form binding a toolbar item (or key) to a point.
 *
 * - `pointId` → the point itself
 * - `pointId=value` → setter runner (legacy `pointId|value` still accepted)
 * - `pointId:action` → action runner (e.g. `fontSize:inc`)
 *
 * The id may name a point or a virtual point.
 */
export type PointSpec<TPoint extends string = string> =
	| TPoint
	| `${TPoint}=${string}`
	| `${TPoint}|${string}`
	| `${TPoint}:${string}`

export type ParsedPointSpec =
	| { readonly kind: 'point'; readonly pointId: string }
	| { readonly kind: 'setter'; readonly pointId: string; readonly value: string }
	| { readonly kind: 'action'; readonly pointId: string; readonly action: string }

/** Parse a spec without touching the registry (adapters resolve against definitions). */
export function parsePointSpec(spec: string): ParsedPointSpec {
	const setter = spec.match(/^([^=:|]+)(=|\|)(.*)$/)
	if (setter) return { kind: 'setter', pointId: setter[1]!, value: setter[3]! }
	const action = spec.match(/^([^=:|]+):(.*)$/)
	if (action) return { kind: 'action', pointId: action[1]!, action: action[2]! }
	return { kind: 'point', pointId: spec }
}

/** Strip a setter (`=`/`|`) or action (`:`) suffix → the canonical point id. */
export function canonicalPointId(spec: string): string {
	return parsePointSpec(spec).pointId
}

/**
 * Binding to a point: either a direct/virtual reference by string spec, or an
 * inline virtual definition (`EnumFromDefinition` / `StashDefinition`).
 *
 * Serialized data uses this union wherever a point is specified
 * (`ToolToolbarItem.point`, `KeyBindings` values): a string is a reference
 * into the points-list + virtuals, an inline definition carries its own
 * derivation (`source` + options / `stashedValue`) and needs no registry
 * entry. Both forms rebuild the same run-time structures from configuration
 * (serialized) + points-list.
 *
 * The virtual payload is intentionally opaque here (`VirtualPoint` imported
 * as a type only) so this module stays dependency-light; resolution helpers
 * (`isInlineSpec`, `canonicalSpecId`) narrow without importing `virtual.ts`
 * values.
 */
export type PointTarget<TPoint extends string = string, V = unknown> =
	| PointSpec<TPoint>
	| import('./virtual.js').VirtualPoint<V>

/** Narrow guard: an inline virtual definition (vs a string reference). */
export function isInlineSpec(spec: unknown): spec is import('./virtual.js').VirtualPoint {
	return (
		typeof spec === 'object' &&
		spec !== null &&
		(spec as { kind?: unknown }).kind !== undefined &&
		((spec as { kind?: unknown }).kind === 'enum-from' ||
			(spec as { kind?: unknown }).kind === 'stash')
	)
}

/**
 * Canonical id of a binding: the string spec's point id, or the inline
 * definition's own `id`. Key-shortcut lookup (`findKeystrokesFor`) and item
 * fingerprints match on this, so a key bound to an inline stash resolves to
 * the same id as the same stash registered under that id.
 */
export function canonicalSpecId(spec: PointTarget<string, unknown>): string {
	if (typeof spec === 'string') return canonicalPointId(spec)
	return spec.id
}
