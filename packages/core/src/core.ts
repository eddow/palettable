/**
 * `@palettable/core` — main entry point: point registry + virtual points +
 * value store + layout tree.
 *
 * Framework adapters read/write through `values` and subscribe to `layout`;
 * all pointer math, DOM and components live outside this class.
 */

import type { EditorDefaults, EditorRegistry } from './editors.js'
import { PaletteError } from './errors.js'
import type { Unsubscribe } from './identifiers.js'
import type { KeyBindings } from './keys.js'
import {
	defaultLayoutFromPoints,
	type LayoutListener,
	type PaletteLayout,
	PaletteLayoutTree,
	type SerializedLayout,
} from './layout.js'
import { readSetterValue, validateInitialValues } from './palette.js'
import type { AnyPoint, AnyValuedPoint } from './points.js'
import { isActionPoint, isValuedPoint } from './points.js'
import { canonicalPointId, isInlineSpec, type PointTarget, parsePointSpec } from './specs.js'
import { PaletteStateStore } from './store.js'
import {
	assertValidVirtual,
	computeStashTransition,
	isStashPoint,
	readEnumFrom,
	resolveEnumSourceValue,
	resolveVirtualSource,
	type StashAside,
	type VirtualPoint,
} from './virtual.js'

export type PaletteCoreOptions = {
	readonly keys?: KeyBindings
	readonly editors?: EditorRegistry
	readonly editorDefaults?: EditorDefaults
	readonly initialLayout?: SerializedLayout | PaletteLayout
	/** End-user-defined virtual points (`enum-from` / `stash`). */
	readonly virtuals?: readonly VirtualPoint[]
	/**
	 * Value hydration (SSR §4.2): applied after defaults, validated per
	 * point (`unknown id` → throw, `action` id → throw, `Object.is`-equal
	 * → skip). Zero listener notifications during construction (listeners
	 * attach after — the store is fresh here, so none exist yet).
	 */
	readonly initialValues?: Readonly<Record<string, unknown>>
}

/**
 * Main entry point: point registry + value store + layout tree.
 *
 * Value access is **not** re-implemented here: adapters read/write/subscribe
 * through the public `values` store (`core.values.get` / `set` / `subscribe`),
 * which is the single source of truth for valued-point state. `PaletteCore`
 * only adds what the raw store cannot: virtual-point resolution
 * (`resolveTargetVirtual`), command execution (`run` / `runStash`), stash
 * aside slots, validated batch hydration (`setMany` / `initialValues`), and
 * layout. All pointer math, DOM and components live outside this class.
 */
export class PaletteCore {
	/** Valued-point store — the single value surface (raw, virtual-unaware). */
	readonly values: PaletteStateStore
	readonly layout: PaletteLayoutTree
	readonly keys: KeyBindings
	readonly editors: EditorRegistry | undefined
	readonly editorDefaults: EditorDefaults | undefined
	private definitions = new Map<string, AnyPoint>()
	private virtuals = new Map<string, VirtualPoint>()
	/** Single aside slot per stash id (there is no stack). */
	private stashAsides = new Map<string, StashAside>()

	constructor(points: readonly AnyPoint[], options: PaletteCoreOptions = {}) {
		for (const point of points) {
			if (this.definitions.has(point.id)) throw new PaletteError(`duplicate point id "${point.id}"`)
			this.definitions.set(point.id, point)
		}
		for (const virtual of options.virtuals ?? []) {
			assertValidVirtual(virtual, this.definitions, this.allIds())
			this.virtuals.set(virtual.id, virtual)
		}
		this.values = new PaletteStateStore(points)
		if (options.initialValues !== undefined) {
			const entries = validateInitialValues(options.initialValues, this.definitions)
			// Direct `setTree` on the fresh store: no listeners exist yet, so
			// this is silent by construction (zero notifications).
			this.values.setTree(Object.fromEntries(entries))
		}
		this.layout =
			options.initialLayout !== undefined
				? new PaletteLayoutTree(options.initialLayout)
				: new PaletteLayoutTree(defaultLayoutFromPoints(points.map((point) => point.id)))
		this.keys = { ...(options.keys ?? {}) }
		this.editors = options.editors
		this.editorDefaults = options.editorDefaults
	}

	/** All registered point definitions (fresh array each call). */
	get points(): readonly AnyPoint[] {
		return [...this.definitions.values()]
	}

	/** All registered virtual definitions (fresh array each call). */
	get virtualPoints(): readonly VirtualPoint[] {
		return [...this.virtuals.values()]
	}

	getDefinition(id: string): AnyPoint | undefined {
		return this.definitions.get(canonicalPointId(id))
	}

	getVirtual(id: string): VirtualPoint | undefined {
		return this.virtuals.get(canonicalPointId(id))
	}

	/**
	 * Resolve an editable (valued) point by id for spec runners.
	 * Headless port of the svelte adapter's `resolveEditableTool` (which
	 * stays adapter-owned until Phase 7): throws `PaletteError` on unknown
	 * ids, action points, and (with `family`) family mismatches.
	 */
	resolveEditablePoint(id: string, family?: string): AnyValuedPoint {
		const pointId = canonicalPointId(id)
		const def = this.definitions.get(pointId)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (!isValuedPoint(def))
			throw new PaletteError(`Palette point "${id}" does not support editing`)
		if (family !== undefined && def.type !== family)
			throw new PaletteError(`Palette point "${id}" is "${def.type}", expected "${family}"`)
		return def
	}

	/**
	 * Read the static `can` flag of an action point (`undefined` = enabled).
	 * Stays a plain read this phase — the static→functional migration lands
	 * in Phase 9 (adapters switch to `evaluateCan(id)` then, not now).
	 * Throws `PaletteError` on unknown ids and non-action points.
	 */
	readActionCan(id: string): boolean | undefined {
		const pointId = canonicalPointId(id)
		const def = this.definitions.get(pointId)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (!isActionPoint(def)) throw new PaletteError(`Palette point "${id}" is not an action`)
		return def.can
	}

	/**
	 * Resolve a point target to its virtual definition: registered virtuals
	 * by id, or an inline definition carried directly in the spec. Returns
	 * `undefined` for plain point ids (use `getDefinition` for those).
	 * Inline definitions are validated against the registry on every call
	 * (same `assertValidVirtual` rules as `defineVirtual`, minus the
	 * id-collision check — the lifetime is the spec, not the registry).
	 */
	resolveTargetVirtual(target: PointTarget<string, unknown>): VirtualPoint | undefined {
		if (isInlineSpec(target)) {
			assertValidVirtual(target, this.definitions, this.allPointIds())
			return target
		}
		return this.virtuals.get(canonicalPointId(target))
	}

	/**
	 * Define (or redefine) a virtual point after construction.
	 * Redefining a `stash` clears its aside slot.
	 */
	defineVirtual(virtual: VirtualPoint): void {
		const ids = this.allIds()
		// Re-defining the same virtual id is allowed; a new virtual colliding
		// with a point id is not — so only drop the id when it is already a virtual.
		if (this.virtuals.has(virtual.id)) ids.delete(virtual.id)
		assertValidVirtual(virtual, this.definitions, ids)
		this.virtuals.set(virtual.id, virtual)
		this.stashAsides.delete(virtual.id)
	}

	/** Remove a virtual point (drops its stash aside slot). */
	removeVirtual(id: string): void {
		this.virtuals.delete(id)
		this.stashAsides.delete(id)
	}

	/**
	 * Restore every valued point to its default **and** clear every stash
	 * aside slot. Not a store pass-through: stash asides are core-owned
	 * virtual state, so a full reset has to bridge both.
	 */
	resetAll(): void {
		this.values.resetAll(this.points)
		this.stashAsides.clear()
	}

	/**
	 * Can a named action (`id:action`) run? Bounds-checked for `number`
	 * actions (`inc` stops at `max`, `dec` stops at `min`), mirroring the
	 * Svelte reference's `valueActions.number.inc.get can()`.
	 * Throws `PaletteError` on unknown points/actions.
	 */
	canRunAction(id: string, action: string): boolean {
		const def = this.definitions.get(canonicalPointId(id))
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (!isValuedPoint(def)) throw new PaletteError(`Palette point "${id}" is an action`)
		const can = namedActionCan(def, this.values.get(def.id), action)
		if (can === undefined) throw new PaletteError(`run: unknown action "${def.id}:${action}"`)
		return can
	}

	/**
	 * Client-hydration sibling of `initialValues` (SSR §4.2): validated
	 * writes applied via `setTree` (all writes land before any listener
	 * runs — no interleaved write+notify like N× `set()` would produce).
	 * Same strictness as construction: unknown ids and action ids throw.
	 * Returns the `Object.is`-changed key array.
	 */
	setMany(values: Readonly<Record<string, unknown>>): readonly string[] {
		const entries = validateInitialValues(values, this.definitions)
		return this.values.setTree(Object.fromEntries(entries))
	}

	/**
	 * Run an action point, setter spec (`id=value`), action spec (`id:action`),
	 * virtual `enum-from` setter (`virtualId=key`), or a `stash` virtual id.
	 *
	 * Synchronous: `PaletteError`s are thrown, not rejected. Action-point
	 * `run()` may return a promise; core does not await it — the caller
	 * decides whether to `await`.
	 */
	run(spec: string): void {
		const parsed = parsePointSpec(spec)
		const virtual = this.virtuals.get(parsed.pointId)
		if (virtual !== undefined) {
			if (isStashPoint(virtual)) {
				if (parsed.kind !== 'point')
					throw new PaletteError(`run: stash "${virtual.id}" takes no suffix`)
				this.runStash(virtual.id)
				return
			}
			const source = resolveVirtualSource(virtual, this.definitions)
			if (parsed.kind === 'point') {
				const key = readEnumFrom(virtual, this.values.get(source.id))
				if (key === undefined)
					throw new PaletteError(`run: virtual "${virtual.id}" has no option for the current value`)
				this.values.set(source.id, resolveEnumSourceValue(virtual, key) as never)
				return
			}
			if (parsed.kind === 'action')
				throw new PaletteError(`run: virtual "${virtual.id}" supports no actions`)
			this.values.set(source.id, resolveEnumSourceValue(virtual, parsed.value) as never)
			return
		}
		const def = this.definitions.get(parsed.pointId)
		if (def === undefined) throw new PaletteError(`run: unknown point "${parsed.pointId}"`)
		if (parsed.kind === 'point') {
			if (!isActionPoint(def)) throw new PaletteError(`run: point "${spec}" is not an action`)
			def.run()
			return
		}
		if (!isValuedPoint(def)) throw new PaletteError(`run: point "${parsed.pointId}" is an action`)
		if (parsed.kind === 'setter') {
			this.values.set(parsed.pointId, readSetterValue(def, parsed.value) as never)
			return
		}
		this.applyNamedAction(def, parsed.action)
	}

	/** Run a `stash` virtual by id (pure toggle, see `computeStashTransition`). */
	runStash(id: string): void {
		const virtual = this.virtuals.get(canonicalPointId(id))
		if (virtual === undefined) throw new PaletteError(`runStash: unknown virtual "${id}"`)
		if (!isStashPoint(virtual)) throw new PaletteError(`runStash: virtual "${id}" is not a stash`)
		const source = resolveVirtualSource(virtual, this.definitions)
		const aside = this.stashAsides.get(virtual.id) ?? { has: false }
		const transition = computeStashTransition(
			this.values.get(source.id),
			virtual.stashedValue,
			aside,
			source.defaultValue
		)
		this.values.set(source.id, transition.next as never)
		if (transition.asideAfter.has) this.stashAsides.set(virtual.id, transition.asideAfter)
		else this.stashAsides.delete(virtual.id)
	}

	/** Layout subscription — fresh `SerializedLayout` snapshot per mutation. */
	subscribeLayout(listener: LayoutListener): Unsubscribe {
		return this.layout.subscribe(listener)
	}

	/** Adapter teardown: drop every listener. Values + layout are kept. */
	dispose(): void {
		this.values.clearListeners()
		this.layout.clearListeners()
	}

	private allIds(): Set<string> {
		return new Set([...this.definitions.keys(), ...this.virtuals.keys()])
	}

	/** Point ids only (excludes virtuals) — for inline-spec validation. */
	private allPointIds(): Set<string> {
		return new Set(this.definitions.keys())
	}

	/** Apply a named action (`id:action`) to a valued point. */
	private applyNamedAction(def: AnyValuedPoint, action: string): void {
		const constraints = def.constraints as
			| { readonly min?: number; readonly max?: number; readonly step?: number }
			| undefined
		const step = constraints?.step ?? 1
		const current = (this.values.get(def.id) as number | undefined) ?? (def.defaultValue as number)
		if (def.type === 'number') {
			if (action === 'inc') {
				this.values.set(def.id, (current + step) as never)
				return
			}
			if (action === 'dec') {
				this.values.set(def.id, (current - step) as never)
				return
			}
		}
		throw new PaletteError(`run: unknown action "${def.id}:${action}"`)
	}
}

/**
 * Pure `can` for a named action over a valued point: returns `true` / `false`
 * for a known action, `undefined` for an unknown action. `inc` / `dec` are
 * bounds-checked against `max` / `min` (`undefined` bound = unlimited).
 */
function namedActionCan(
	def: AnyValuedPoint,
	current: unknown,
	action: string
): boolean | undefined {
	if (def.type === 'number') {
		const constraints = def.constraints as
			| { readonly min?: number; readonly max?: number; readonly step?: number }
			| undefined
		const value = (current as number | undefined) ?? (def.defaultValue as number)
		if (action === 'inc') return constraints?.max === undefined || value < constraints.max
		if (action === 'dec') return constraints?.min === undefined || value > constraints.min
	}
	return undefined
}
