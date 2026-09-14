/**
 * `@palettable/core` — point specs (`tool:` strings, kept nomenclature).
 *
 * The string form binding a toolbar item (or key) to a point. Parsing is pure
 * and registry-free; adapters resolve the parsed id against definitions.
 */

/**
 * String form binding a toolbar item (or key) to a point.
 *
 * - `pointId` → the point itself
 * - `pointId=value` → setter runner (legacy `pointId|value` still accepted)
 * - `pointId:action` → action runner (e.g. `fontSize:inc`)
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
