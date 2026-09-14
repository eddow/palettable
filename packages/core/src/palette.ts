/**
 * `@palettable/core` — palette wire descriptors + hydration inputs (Phase 3).
 *
 * SSR wire format (`plans/ssr.md` §4.1–§4.2): point descriptors without `run`
 * closures, plus `initialValues` validation. Rendering needs only the
 * descriptor; `run()` is unreachable from the render path by construction.
 *
 * Action-point rebuild contract (key-shortcuts need this, not just SSR):
 * action points serialize **by name** — the descriptor carries the action
 * point's `id` (+ `label`/`can`/metadata, no `run`); the client rebinds `run`
 * via the `runners: Record<actionId, run>` argument of
 * `fromServerDescriptor`. Derived actions have **two** serializable forms:
 * a `stash`/`enum-from` virtual registered under its `id` (name-addressable
 * via `runStash(id)` / `run(virtualId)`, rebuilt from serialized config
 * (`KeyBindings` + virtuals list) + the points-list), or an **inline**
 * definition carried directly in the spec (`PointTarget` — already landed
 * in `specs.ts` / `layout.ts` / `keys.ts` / `core.ts`). No closure crosses
 * the wire in either form.
 *
 * Custom `TypeConstraints` entries participating in SSR must be
 * `JSON.stringify`-stable (or wait for the Phase 8 `ValueCodec` registry).
 * Stash aside slots stay excluded from the snapshot **by documented decision**
 * (rendering a stash button needs only current-vs-stashed pressed state).
 */
import { PaletteError } from './errors.js'
import type { ActionPoint, AnyPoint, AnyValuedPoint } from './points.js'
import { isActionPoint, isValuedPoint } from './points.js'

/** JSON-safe action descriptor: everything except `run` (`id` + `label`/`can`/metadata). */
export type ServerActionDescriptor = Omit<ActionPoint, 'run'>

/** JSON-safe valued descriptor: valued points are already plain data. */
export type ServerValuedDescriptor = AnyValuedPoint

/** JSON-safe point descriptor (no `run` closure). */
export type ServerPointDescriptor = ServerActionDescriptor | ServerValuedDescriptor

/** Client-injected `run` implementations, keyed by action id. */
export type ActionRunners = Record<string, ActionPoint['run']>

/**
 * Strip `run` closures for the wire. Returns fresh top-level objects;
 * values/constraints are by reference (same rule as `asObject()` — the
 * adapter must `structuredClone`/serialize before crossing the wire).
 */
export function toServerDescriptor(points: readonly AnyPoint[]): ServerPointDescriptor[] {
	return points.map((point) => {
		if (isActionPoint(point)) {
			const { run: _run, ...descriptor } = point
			return { ...descriptor }
		}
		return { ...point }
	})
}

/**
 * Rebuild runtime points from wire descriptors + client-injected runners.
 * Throws `PaletteError` on duplicate ids, action descriptors without a
 * runner, runner ids without a matching action descriptor, or valued
 * descriptors missing `defaultValue`. Order = descriptor array order
 * (deterministic `Map` iteration, see SSR §5).
 */
export function fromServerDescriptor(
	descriptors: readonly ServerPointDescriptor[],
	runners: ActionRunners = {}
): AnyPoint[] {
	const seen = new Set<string>()
	const points: AnyPoint[] = []
	for (const descriptor of descriptors) {
		if (seen.has(descriptor.id))
			throw new PaletteError(`fromServerDescriptor: duplicate point id "${descriptor.id}"`)
		seen.add(descriptor.id)
		if (descriptor.type === 'action') {
			const run = runners[descriptor.id]
			if (typeof run !== 'function')
				throw new PaletteError(`fromServerDescriptor: missing runner for action "${descriptor.id}"`)
			points.push({ ...(descriptor as ServerActionDescriptor), run })
			continue
		}
		if (!isValuedPoint(descriptor as AnyPoint))
			throw new PaletteError(
				`fromServerDescriptor: valued point "${descriptor.id}" is missing defaultValue`
			)
		points.push({ ...(descriptor as ServerValuedDescriptor) })
	}
	for (const id of Object.keys(runners)) {
		if (!seen.has(id))
			throw new PaletteError(`fromServerDescriptor: unknown action "${id}" in runners`)
		const descriptor = descriptors.find((descriptor) => descriptor.id === id)
		if (descriptor !== undefined && descriptor.type !== 'action')
			throw new PaletteError(`fromServerDescriptor: runner "${id}" is not an action point`)
	}
	return points
}

/**
 * Validate `initialValues` against point definitions (shared by
 * `PaletteCore` construction and `setMany`). Throws on unknown ids and
 * action ids (same strictness as the key-binding rebuild contract);
 * `Object.is`-equal values are skipped (no notify). Returns the validated
 * entries in input order.
 */
export function validateInitialValues(
	values: Readonly<Record<string, unknown>>,
	definitions: ReadonlyMap<string, AnyPoint>
): Array<readonly [string, unknown]> {
	const entries: Array<readonly [string, unknown]> = []
	for (const [id, value] of Object.entries(values)) {
		const definition = definitions.get(id)
		if (definition === undefined) throw new PaletteError(`initialValues: unknown point "${id}"`)
		if (isActionPoint(definition))
			throw new PaletteError(`initialValues: point "${id}" is an action`)
		entries.push([id, value] as const)
	}
	return entries
}

/**
 * Parse a serialized setter value for a valued point.
 *
 * Headless port of the svelte adapter's `valueReader` (which stays
 * adapter-owned until Phase 7): `boolean` accepts `1`/`true` and
 * `0`/`false` (case-insensitive), `number` uses `Number` (rejects non-finite
 * and blank strings), everything else passes through as a string.
 * Throws `PaletteError` on unparseable values.
 *
 * Deliberate divergence from the reference: an unrecognized boolean token
 * (`"maybe"`) throws instead of silently coercing to `false`. A silent
 * wrong-value write is worse than a loud failure on the spec path (key
 * bindings, serialized configs), where a corrupted token should surface.
 */
export function readSetterValue(def: AnyValuedPoint, serialized: string): unknown {
	switch (def.type) {
		case 'boolean': {
			const token = serialized.toLowerCase()
			if (['1', 'true'].includes(token)) return true
			if (['0', 'false'].includes(token)) return false
			throw new PaletteError(
				`Invalid palette value "${serialized}" for point "${def.id}": expected a boolean`
			)
		}
		case 'number': {
			if (serialized.trim() === '')
				throw new PaletteError(`Invalid palette value "${serialized}" for point "${def.id}"`)
			const value = Number(serialized)
			if (!Number.isFinite(value))
				throw new PaletteError(`Invalid palette value "${serialized}" for point "${def.id}"`)
			return value
		}
		default:
			return serialized
	}
}
