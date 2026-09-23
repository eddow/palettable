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
import type { VirtualPoint } from './virtual.js'

/** Executable activity of a runnable. */
export type RunnableKind = 'action' | 'set' | 'toggle' | 'inc' | 'dec'

/**
 * Overridable end-user textualization
 * (`PaletteCoreOptions.textualise`): renders a description out of an
 * action description (`"Increment thatValue by X"` style). Receives the
 * runnable + definitions lookup; defaults to `describeRunnable`.
 */
export type RunnableTextualise = (
	runnable: Runnable,
	definitions: RunnableDefinitions
) => string

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

function pointLabel(point: AnyPoint | VirtualPoint | undefined, fallback: string): string {
	const label = (point as { label?: unknown } | undefined)?.label
	return typeof label === 'string' && label.length > 0 ? label : fallback
}

function humanize(value: string): string {
	const words = value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[^a-zA-Z0-9]+/g, ' ')
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
	if (words.length === 0) return value
	return words
		.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ')
}

function optionLabelOf(point: AnyPoint | undefined, value: unknown): string {
	if (point !== undefined && point.type === 'enum') {
		const options =
			(point.constraints as { readonly options?: readonly { value: string; label?: string }[] } | undefined)
				?.options ?? []
		const match = options.find((option) => Object.is(option.value, value))
		if (match !== undefined) return match.label ?? humanize(String(match.value))
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
	definitions: RunnableDefinitions
): string {
	const point = findPoint(definitions, runnable.point)
	const label = pointLabel(point, humanize(runnable.point))
	switch (runnable.kind) {
		case 'action':
			return label
		case 'toggle':
			return `Toggle ${label}`
		case 'set': {
			if (typeof runnable.value === 'boolean')
				return `${runnable.value ? 'Enable' : 'Disable'} ${label}`
			const valueLabel = optionLabelOf(point as AnyPoint | undefined, runnable.value)
			return `Set ${label} to ${valueLabel}`
		}
		case 'inc':
			return `Increment ${label} by ${runnable.delta}`
		case 'dec':
			return `Decrement ${label} by ${runnable.delta}`
	}
}
