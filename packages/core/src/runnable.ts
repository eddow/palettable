/**
 * `@palettable/core` — runnable commands (structured, no spec strings).
 *
 * A `Runnable` is the serializable, executable description of one command:
 * which point, which activity, and the concrete parameter. It replaces the
 * legacy `"id=value"` / `"id!"` / `"id+=x"` spec-string encoding
 * (`specs.ts`, deleted): no parsing, no canonicalization, no placeholder
 * identities like `"blup+=x"`. Runnables are plain JSON-safe data
 * (`point` string + `kind` + `value`/`delta`), so the same object flows
 * through API interaction, serialization (`KeyBindings`, layout snapshots)
 * and end-user textualization.
 *
 * - API interaction: `KeyBindings` maps keystrokes to runnables;
 *   `PaletteCore.run(runnable)` executes, `PaletteCore.canRun(runnable)`
 *   gates (beside `run`, same shape in).
 * - Serialization: runnables are `JSON.stringify`-stable (values must be
 *   JSON-safe — booleans, numbers, strings, option keys).
 * - Textualization: `describeRunnable` renders `"Increment thatValue by X"`
 *   style text from the point definitions; consumers override it via
 *   `PaletteCoreOptions.describeRunnable`.
 */
import type { AnyPoint } from './points.js'
import { type CatalogStrings, humanizeId, resolveCatalogStrings } from './strings.js'
import type { VirtualPoint } from './virtual.js'

/** Executable activity of a runnable. */
export type RunnableKind = 'action' | 'set' | 'toggle' | 'inc' | 'dec'

/**
 * Overridable end-user textualization
 * (`PaletteCoreOptions.textualise`): renders a description out of an
 * action description (`"Increment thatValue by X"` style). Receives the
 * runnable + definitions lookup; defaults to `describeRunnable`.
 */
export type RunnableTextualise = (runnable: Runnable, definitions: RunnableDefinitions) => string

/** Structured executable command (concrete — no placeholders). */
export type Runnable =
	| { readonly kind: 'action'; readonly point: string }
	| { readonly kind: 'set'; readonly point: string; readonly value: unknown }
	| { readonly kind: 'toggle'; readonly point: string }
	| { readonly kind: 'inc'; readonly point: string; readonly delta: number }
	| { readonly kind: 'dec'; readonly point: string; readonly delta: number }

/** Narrow guard for runnable objects (vs arbitrary serialized data). */
export function isRunnable(value: unknown): value is Runnable {
	if (typeof value !== 'object' || value === null) return false
	const record = value as Record<string, unknown>
	if (typeof record.point !== 'string') return false
	switch (record.kind) {
		case 'action':
		case 'toggle':
			return true
		case 'set':
			return 'value' in record
		case 'inc':
		case 'dec':
			return typeof record.delta === 'number' && Number.isFinite(record.delta)
		default:
			return false
	}
}

/**
 * Stable identity key for a runnable (selection, dedup, test assertions).
 * `JSON.stringify` of the value payload — deterministic for JSON-safe values.
 */
export function runnableKey(runnable: Runnable): string {
	switch (runnable.kind) {
		case 'action':
		case 'toggle':
			return `${runnable.point}:${runnable.kind}`
		case 'set':
			return `${runnable.point}:set:${JSON.stringify(runnable.value) ?? 'undefined'}`
		case 'inc':
		case 'dec':
			return `${runnable.point}:${runnable.kind}:${runnable.delta}`
	}
}

/** Definitions lookup for `describeRunnable` (points + registered virtuals). */
export type RunnableDefinitions = {
	readonly points: ReadonlyMap<string, AnyPoint> | readonly AnyPoint[]
	readonly virtuals?: ReadonlyMap<string, VirtualPoint> | readonly VirtualPoint[]
}

function findPoint(
	definitions: RunnableDefinitions,
	id: string
): AnyPoint | VirtualPoint | undefined {
	const { points, virtuals } = definitions
	let point: AnyPoint | undefined
	if (Array.isArray(points)) point = points.find((candidate) => candidate.id === id)
	else if (typeof (points as ReadonlyMap<string, AnyPoint>).get === 'function')
		point = (points as ReadonlyMap<string, AnyPoint>).get(id)
	if (point !== undefined) return point
	if (virtuals === undefined) return undefined
	if (Array.isArray(virtuals)) return virtuals.find((candidate) => candidate.id === id)
	if (typeof (virtuals as ReadonlyMap<string, VirtualPoint>).get === 'function')
		return (virtuals as ReadonlyMap<string, VirtualPoint>).get(id)
	return undefined
}

function pointLabel(
	point: AnyPoint | VirtualPoint | undefined,
	fallback: string,
	strings?: CatalogStrings
): string {
	if (point !== undefined) {
		const override = strings?.pointLabels?.[point.id]
		if (typeof override === 'string' && override.length > 0) return override
	}
	const label = (point as { label?: unknown } | undefined)?.label
	return typeof label === 'string' && label.length > 0 ? label : fallback
}

function humanize(value: string): string {
	return humanizeId(value)
}

function optionLabelOf(
	point: AnyPoint | undefined,
	value: unknown,
	strings?: CatalogStrings
): string {
	if (point !== undefined && point.type === 'enum') {
		const options =
			(
				point.constraints as
					| { readonly options?: readonly { value: string; label?: string }[] }
					| undefined
			)?.options ?? []
		const match = options.find((option) => Object.is(option.value, value))
		if (match !== undefined) {
			const override =
				typeof match.value === 'string'
					? strings?.optionLabels?.[point.id]?.[match.value]
					: undefined
			if (typeof override === 'string' && override.length > 0) return override
			const label = (match as { label?: unknown }).label
			if (typeof label === 'string' && label.length > 0) return label
			return humanize(String(match.value))
		}
	}
	return typeof value === 'string' ? humanize(value) : String(value)
}

/**
 * Default end-user textualization of a runnable
 * (`"Increment thatValue by X"` style). Pure over definitions — no store
 * reads. Consumers override it via `PaletteCoreOptions.describeRunnable`.
 */
export function describeRunnable(
	runnable: Runnable,
	definitions: RunnableDefinitions,
	stringsOverride: Partial<CatalogStrings> = {}
): string {
	const strings = resolveCatalogStrings(stringsOverride)
	const point = findPoint(definitions, runnable.point)
	const label = pointLabel(point, humanize(runnable.point), strings)
	switch (runnable.kind) {
		case 'action':
			return label
		case 'toggle':
			return strings.toggle(label)
		case 'set': {
			if (typeof runnable.value === 'boolean')
				return runnable.value ? strings.enable(label) : strings.disable(label)
			const valueLabel = optionLabelOf(point as AnyPoint | undefined, runnable.value, strings)
			return strings.setTo(label, valueLabel)
		}
		case 'inc':
			return strings.incrementBy(label, runnable.delta)
		case 'dec':
			return strings.decrementBy(label, runnable.delta)
	}
}
