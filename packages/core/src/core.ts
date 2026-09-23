/**
 * `@palettable/core` — main entry point: point registry + virtual points +
 * value store + layout tree.
 *
 * Framework adapters read/write through `values` and subscribe to `layout`;
 * all pointer math, DOM and components live outside this class.
 */

import type { ContextName, ValuesBag } from './context.js'
import type { ControlDefaults, ControlRegistry } from './controls.js'
import { PaletteError } from './errors.js'
import type { Unsubscribe } from './identifiers.js'
import type { KeyBindings } from './keys.js'
import {
	type AnySerializedLayout,
	defaultLayoutFromPoints,
	type LayoutListener,
	type LayoutOpListener,
	type PaletteLayout,
	PaletteLayoutTree,
} from './layout.js'
import { readSetterValue, validateInitialValues } from './palette.js'
import type { AnyPoint, AnyValuedPoint } from './points.js'
import { isActionPoint, isRootContext, isValuedPoint } from './points.js'
import type { Runnable, RunnableTextualise } from './runnable.js'
import { describeRunnable, isRunnable } from './runnable.js'
import { isInlineSpec } from './virtual.js'
import { PaletteStateStore } from './store.js'
import {
	assertValidVirtual,
	readEnumFrom,
	resolveEnumSourceValue,
	resolveVirtualSource,
	type VirtualPoint,
} from './virtual.js'

export type PaletteCoreOptions = {
	readonly keys?: KeyBindings
	readonly controls?: ControlRegistry
	readonly controlDefaults?: ControlDefaults
	readonly initialLayout?: AnySerializedLayout | PaletteLayout
	// Note: not completely implemented, still under construction
	/** End-user-defined virtual points (`enum-from`). */
	readonly virtuals?: readonly VirtualPoint[]
	/**
	 * Overridable end-user textualization: makes a description out of an
	 * action description (`"Increment thatValue by X"` style). Defaults to
	 * `describeRunnable` (pure over definitions — no store reads).
	 */
	readonly textualise?: RunnableTextualise
	/**
	 * Value hydration (SSR §4.2): one-shot construction fill, validated per
	 * point (`unknown id` → throw, `action`/`nothing` id → throw,
	 * `Object.is`-equal → skip). Core holds no defaults — absent key stays
	 * skeleton (`undefined`). Zero listener notifications during
	 * construction (listeners attach after — the store is fresh here, so
	 * none exist yet).
	 */
	readonly initialValues?: Readonly<Record<string, unknown>>
}

/**
 * Listener for context-bag changes: the bag name + changed keys.
 */
export type ContextListener = (bagName: ContextName, changed: readonly string[]) => void

/**
 * Listener for enablement flips: the point id + new `can` value.
 * Fired only on flips (no render storms).
 */
export type CanListener = (pointId: string, can: boolean) => void

/**
 * Listener for point-definition changes: the point id whose options were
 * replaced (`defineEnumOptions`) or whose virtual was (re)defined/removed.
 * Adapters reconcile select/segmented rows in place (never a structural
 * sync) — same pattern as `CanListener`, per-point id payload.
 */
export type DefinitionListener = (pointId: string) => void

/**
 * Main entry point: point registry + value store + layout tree.
 *
 * Value access is **not** re-implemented here: adapters read/write/subscribe
 * through the public `values` store (`core.values.get` / `set` / `subscribe`),
 * which is the single source of truth for valued-point state. `PaletteCore`
 * only adds what the raw store cannot: virtual-point lookup
 * (`getVirtual` / `resolveTargetVirtual`), command execution (`run` +
 * `can` gate beside it), validated batch hydration (`setMany` /
 * `initialValues`), and layout. All pointer math,
 * DOM and components live outside this class.
 */
export class PaletteCore {
	/** Valued-point store — the single value surface (raw, virtual-unaware). */
	readonly values: PaletteStateStore
	readonly layout: PaletteLayoutTree
	readonly keys: KeyBindings
	readonly controls: ControlRegistry | undefined
	readonly controlDefaults: ControlDefaults | undefined
	/** Overridable end-user textualization (defaults to `describeRunnable`). */
	readonly textualise: RunnableTextualise
	private definitions = new Map<string, AnyPoint>()
	private virtuals = new Map<string, VirtualPoint>()
	/** Cached definition arrays (invalidated on registry mutation). */
	private pointsCache: readonly AnyPoint[] | undefined
	private virtualPointsCache: readonly VirtualPoint[] | undefined

	constructor(points: readonly AnyPoint[], options: PaletteCoreOptions = {}) {
		for (const point of points) {
			if (this.definitions.has(point.id)) throw new PaletteError(`duplicate point id "${point.id}"`)
			this.definitions.set(point.id, point)
		}
		for (const virtual of options.virtuals ?? []) {
			assertValidVirtual(virtual, this.definitions, this.allIds())
			this.virtuals.set(virtual.id, virtual)
		}
		this.values = new PaletteStateStore()
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
		this.controls = options.controls
		this.controlDefaults = options.controlDefaults
		this.textualise = options.textualise ?? describeRunnable
	}

	/** All registered point definitions (cached; invalidated on registry mutation). */
	get points(): readonly AnyPoint[] {
		return (this.pointsCache ??= [...this.definitions.values()])
	}

	/** All registered virtual definitions (cached; invalidated on registry mutation). */
	get virtualPoints(): readonly VirtualPoint[] {
		return (this.virtualPointsCache ??= [...this.virtuals.values()])
	}

	getDefinition(id: string): AnyPoint | undefined {
		return this.definitions.get(id)
	}

	getVirtual(id: string): VirtualPoint | undefined {
		return this.virtuals.get(id)
	}

	/**
	 * Resolve an editable (valued) point by id for spec runners.
	 * Headless port of the svelte adapter's `resolveEditableTool` (which
	 * stays adapter-owned until Phase 7): throws `PaletteError` on unknown
	 * ids, action points, and (with `family`) family mismatches.
	 */
	resolveEditablePoint(id: string, family?: string): AnyValuedPoint {
		const def = this.definitions.get(id)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (!isValuedPoint(def))
			throw new PaletteError(`Palette point "${id}" does not support editing`)
		if (family !== undefined && def.type !== family)
			throw new PaletteError(`Palette point "${id}" is "${def.type}", expected "${family}"`)
		return def
	}

	/**
	 * Evaluate the functional `can` of an action point with the
	 * currently-registered bags (missing → `undefined` slot; omitted `can`
	 * = enabled). Throws `PaletteError` on unknown ids and non-action points.
	 */
	readActionCan(id: string): boolean | undefined {
		const def = this.definitions.get(id)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (!isActionPoint(def)) throw new PaletteError(`Palette point "${id}" is not an action`)
		return this.evaluateCan(id)
	}

	/**
	 * Read the live value for a valued point: dual-source precedence —
	 * the first non-root used bag holding the id wins, else the root
	 * value. Absent bag / absent key → root. Never throws on missing
	 * context; throws `PaletteError` on unknown ids and non-valued points.
	 * Adapters share this read path (vanilla `liveValue` delegates here).
	 */
	readValue(id: string): unknown {
		const def = this.definitions.get(id)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (!isValuedPoint(def)) return undefined
		let value: unknown = this.values.get(def.id)
		for (const bag of this.resolveBags(def.uses)) {
			if (bag === undefined) continue
			if (bag === (this.values as unknown as ValuesBag)) continue
			const selected: unknown = bag.get(def.id)
			if (selected !== undefined) {
				value = selected
				break
			}
		}
		return value
	}

	/**
	 * Write a valued point through its context: the first non-root used
	 * bag holding the id wins (context write), else the root store (root
	 * write). Returns where the write landed (`'context'` + bag name, or
	 * `'root'`). Strict like `run` setters: absent everywhere (skeleton)
	 * throws `PaletteError` — the consumer hydrates first (root via
	 * `setMany`, context via `bag.setTree`). Unknown ids and non-valued
	 * points throw. `Object.is`-equal writes are no-ops (same echo-loop
	 * guard as the stores).
	 */
	writeValue(
		id: string,
		value: unknown
	): { readonly target: 'context'; readonly bag: string } | { readonly target: 'root' } {
		const def = this.definitions.get(id)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (!isValuedPoint(def)) throw new PaletteError(`Palette point "${id}" is not valued`)
		const uses = def.uses ?? []
		for (const name of uses) {
			if (isRootContext(name)) continue
			const bag = this.bags.get(name)
			if (bag === undefined) continue
			if (!bag.has(def.id)) continue
			bag.set(def.id, value)
			return { target: 'context', bag: name }
		}
		if (!this.values.has(def.id))
			throw new PaletteError(`writeValue: no value for "${def.id}" (skeleton)`)
		this.values.set(def.id, value as never)
		return { target: 'root' }
	}

	// ── Context bags (Phase 8) ──────────────────────────────────────────
	// Root bag `ROOT_CONTEXT` is core-owned (the `values` store itself);
	// context bags are host-owned via `setContext` / `removeContext`
	// (replace-never-append). `setContext`/`removeContext` with the root
	// name throw — the root bag is not host-replaceable.

	private bags = new Map<ContextName, ValuesBag>()
	private bagForwards = new Map<ContextName, Unsubscribe>()
	private contextListeners = new Set<ContextListener>()
	private canListeners = new Set<CanListener>()
	private definitionListeners = new Set<DefinitionListener>()
	private canCache = new Map<string, boolean>()

	/**
	 * Register a host-owned context bag. Replace-never-append (§1.3):
	 * only core's own forward on the old bag is dropped (stored per name);
	 * host direct subscribers on the old bag survive. Tools whose point
	 * `uses` include `name` re-derive against the new bag (re-resolve bags,
	 * re-evaluate `can`, re-run display resolvers). Emits with an empty
	 * changed array = identity change: adapters re-resolve everything for
	 * `name`, never replay old subscriptions onto the new bag.
	 * Throws on the root name (`ROOT_CONTEXT` / `'root'` alias).
	 */
	setContext(name: ContextName, bag: ValuesBag): void {
		if (isRootContext(name))
			throw new PaletteError(`setContext: "${name}" is the core-owned root bag`)
		this.bagForwards.get(name)?.()
		this.bags.set(name, bag)
		this.bagForwards.set(
			name,
			bag.subscribe((changed) => this.onBagChanged(name, changed))
		)
		this.refreshCanForBag(name)
		this.emitContext(name, [])
	}

	/**
	 * Remove a context bag. Tools whose point `uses` include `name`
	 * re-derive with `undefined` in that slot (disabled + placeholder
	 * unless their `can` / resolvers define otherwise). Only core's own
	 * forward is dropped; host direct subscribers survive.
	 * Throws on the root name (`ROOT_CONTEXT` / `'root'` alias).
	 */
	removeContext(name: ContextName): void {
		if (isRootContext(name))
			throw new PaletteError(`removeContext: "${name}" is the core-owned root bag`)
		this.bagForwards.get(name)?.()
		this.bagForwards.delete(name)
		this.bags.delete(name)
		this.refreshCanForBag(name)
		this.emitContext(name, [])
	}

	/**
	 * Get a bag by name (`ROOT_CONTEXT` / `'root'` alias = `values` store).
	 * Unknown names → `undefined`.
	 */
	getBag(name: ContextName): ValuesBag | undefined {
		if (isRootContext(name)) return this.values as unknown as ValuesBag
		return this.bags.get(name)
	}

	/**
	 * Resolve used bags for a point's `uses` in order. Never throws:
	 * missing bags resolve to `undefined`; root (`ROOT_CONTEXT` / `'root'`
	 * alias) always resolves.
	 */
	resolveBags(uses: readonly ContextName[] | undefined): (ValuesBag | undefined)[] {
		return (uses ?? []).map((name) => this.getBag(name))
	}

	/**
	 * Evaluate a point's enablement with currently-registered bags
	 * (missing → `undefined` slot). Omitted `can` = enabled, except for
	 * **context tools**: a valued point with non-empty `uses` and no
	 * explicit `can` is disabled while its value is skeleton (`undefined`)
	 * — the context is absent, so there is nothing to write to
	 * (`writeValue` would throw). Root-only tools stay enabled (the
	 * consumer hydrates the root store first). Throws `PaletteError` on
	 * unknown point ids.
	 */
	evaluateCan(pointId: string): boolean {
		const def = this.definitions.get(pointId)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${pointId}"`)
		if (def.can !== undefined) return def.can(...this.resolveBags(def.uses))
		if (isValuedPoint(def) && (def.uses ?? []).length > 0)
			return this.readValue(pointId) !== undefined
		return true
	}

	/** Subscribe to context-bag changes (global, across all bags). */
	subscribeContext(listener: ContextListener): Unsubscribe {
		this.contextListeners.add(listener)
		return () => {
			this.contextListeners.delete(listener)
		}
	}

	/**
	 * Subscribe to enablement flips. Fired only when a context-bag change
	 * flips `evaluateCan(pointId)` for an observed point (no render storms).
	 */
	subscribeCan(listener: CanListener): Unsubscribe {
		this.canListeners.add(listener)
		return () => {
			this.canListeners.delete(listener)
		}
	}

	/**
	 * Subscribe to point-definition changes (enum option replacement via
	 * `defineEnumOptions`, virtual (re)definition/removal). Fired once per
	 * mutation with the affected point/virtual id — adapters reconcile the
	 * affected tools in place (never a structural sync).
	 */
	subscribeDefinitions(listener: DefinitionListener): Unsubscribe {
		this.definitionListeners.add(listener)
		return () => {
			this.definitionListeners.delete(listener)
		}
	}

	private emitDefinitions(pointId: string): void {
		for (const listener of [...this.definitionListeners]) {
			try {
				listener(pointId)
			} catch {
				// Listener errors must not break the notify chain.
			}
		}
	}

	private onBagChanged(name: ContextName, changed: readonly string[]): void {
		this.emitContext(name, changed)
		this.refreshCanForBag(name)
	}

	private emitContext(name: ContextName, changed: readonly string[]): void {
		for (const listener of [...this.contextListeners]) {
			try {
				listener(name, changed)
			} catch {
				// Listener errors must not break the forward chain.
			}
		}
	}

	private refreshCanForBag(name: ContextName): void {
		for (const [id, def] of this.definitions) {
			if (!(def.uses ?? []).includes(name)) continue
			const next = this.evaluateCan(id)
			const previous = this.canCache.get(id)
			if (previous === undefined) {
				this.canCache.set(id, next)
				continue
			}
			if (next !== previous) {
				this.canCache.set(id, next)
				for (const listener of [...this.canListeners]) {
					try {
						listener(id, next)
					} catch {
						// Listener errors must not break the flip chain.
					}
				}
			}
		}
	}

	/**
	 * Resolve a virtual by id, or validate an inline virtual definition
	 * carried directly on a toolbar item. Returns `undefined` for plain
	 * point ids (use `getDefinition` for those). Inline definitions are
	 * validated against the registry on every call (same
	 * `assertValidVirtual` rules as `defineVirtual`, minus the
	 * id-collision check — the lifetime is the item, not the registry).
	 */
	resolveTargetVirtual(target: string | VirtualPoint): VirtualPoint | undefined {
		if (isInlineSpec(target)) {
			assertValidVirtual(target, this.definitions, this.allPointIds())
			return target
		}
		return this.virtuals.get(target)
	}

	/**
	 * Define (or redefine) a virtual point after construction.
	 * Emits a definition notification for the virtual id.
	 */
	defineVirtual(virtual: VirtualPoint): void {
		const ids = this.allIds()
		// Re-defining the same virtual id is allowed; a new virtual colliding
		// with a point id is not — so only drop the id when it is already a virtual.
		if (this.virtuals.has(virtual.id)) ids.delete(virtual.id)
		assertValidVirtual(virtual, this.definitions, ids)
		this.virtuals.set(virtual.id, virtual)
		this.virtualPointsCache = undefined
		this.emitDefinitions(virtual.id)
	}

	/** Remove a virtual point. Emits a definition notification. */
	removeVirtual(id: string): void {
		this.virtuals.delete(id)
		this.virtualPointsCache = undefined
		this.emitDefinitions(id)
	}

	/**
	 * Replace the option list of an `enum` point after construction.
	 * Validated like construction: unknown ids throw, non-enum points
	 * throw, empty lists throw, duplicate option values throw. The stored
	 * definition object is replaced (never mutated — adapters may hold the
	 * old reference), `pointsCache` is invalidated, and a definition
	 * notification fires for the point id. Current values are NOT touched:
	 * a value with no matching option renders the `?` skeleton until the
	 * host writes a listed value.
	 */
	defineEnumOptions(id: string, options: readonly import('./type.js').EnumOption[]): void {
		const def = this.definitions.get(id)
		if (def === undefined) throw new PaletteError(`defineEnumOptions: unknown point "${id}"`)
		if (!isValuedPoint(def) || def.type !== 'enum')
			throw new PaletteError(`defineEnumOptions: point "${id}" is not an enum`)
		if (options.length === 0)
			throw new PaletteError(`defineEnumOptions: point "${id}" needs at least one option`)
		const seen = new Set<string>()
		for (const option of options) {
			if (seen.has(option.value))
				throw new PaletteError(
					`defineEnumOptions: point "${id}" has a duplicate option value "${option.value}"`
				)
			seen.add(option.value)
		}
		this.definitions.set(id, {
			...def,
			constraints: { ...(def.constraints as object | undefined), options: [...options] },
		} as AnyPoint)
		this.pointsCache = undefined
		this.emitDefinitions(id)
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
	 * Retrieve the runnable bound to a keystroke (`attach` counterpart).
	 * Exact match — adapters normalize (`normalizeKeystroke`) before calling.
	 * Returns `undefined` when nothing is bound.
	 */
	retrieve(keystroke: import('./identifiers.js').Keystroke): Runnable | undefined {
		return this.keys[keystroke]
	}

	/**
	 * Associate a runnable with a keystroke (overwrites any existing binding).
	 * The runnable must be concrete (`isRunnable`); adapters normalize the
	 * keystroke before calling. Stored by value (JSON-safe) — mutating the
	 * passed object afterwards does not affect the binding.
	 */
	attach(keystroke: import('./identifiers.js').Keystroke, runnable: Runnable): void {
		if (!isRunnable(runnable))
			throw new PaletteError(`attach: invalid runnable for "${keystroke}"`)
		this.keys[keystroke] = { ...runnable } as Runnable
	}

	/** Detach any runnable bound to a keystroke. Returns `true` when one was removed. */
	detach(keystroke: import('./identifiers.js').Keystroke): boolean {
		if (!(keystroke in this.keys)) return false
		delete this.keys[keystroke]
		return true
	}

	/**
	 * End-user textualization of a runnable via the overridable
	 * `textualise` option (`"Increment thatValue by X"` style). Pure over
	 * definitions — no store reads.
	 */
	describe(runnable: Runnable): string {
		return this.textualise(runnable, {
			points: this.definitions,
			virtuals: this.virtuals,
		})
	}

	/**
	 * Can a runnable run? Beside `run` (same shape in): action → `evaluateCan`,
	 * set → skeleton + no-op-same-value gate, toggle → boolean + skeleton gate,
	 * inc/dec → number + skeleton + bounds gate. Throws `PaletteError` on
	 * unknown points and kind/type mismatches (programming errors, like `run`).
	 */
	can(runnable: Runnable): boolean {
		const virtual = this.virtuals.get(runnable.point)
		if (virtual !== undefined) {
			const source = resolveVirtualSource(virtual, this.definitions)
			if (runnable.kind === 'action') {
				return readEnumFrom(virtual, this.values.get(source.id)) !== undefined
			}
			if (runnable.kind !== 'set' || typeof runnable.value !== 'string') return false
			try {
				resolveEnumSourceValue(virtual, runnable.value)
				return true
			} catch {
				return false
			}
		}
		const def = this.definitions.get(runnable.point)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${runnable.point}"`)
		switch (runnable.kind) {
			case 'action':
				if (!isActionPoint(def))
					throw new PaletteError(`run: point "${runnable.point}" is not an action`)
				return this.evaluateCan(def.id)
			case 'set': {
				if (!isValuedPoint(def))
					throw new PaletteError(`run: point "${runnable.point}" is an action`)
				const current = this.readValue(def.id)
				if (current === undefined) return false
				return !Object.is(current, this.coerceSetValue(def, runnable.value))
			}
			case 'toggle': {
				if (!isValuedPoint(def) || def.type !== 'boolean')
					throw new PaletteError(`run: point "${runnable.point}" is not a boolean`)
				return this.readValue(def.id) !== undefined
			}
			case 'inc':
			case 'dec': {
				if (!isValuedPoint(def))
					throw new PaletteError(`Palette point "${runnable.point}" is an action`)
				const current = this.readValue(def.id)
				if (current === undefined) return false
				const delta =
					runnable.kind === 'inc' ? Math.abs(runnable.delta) : -Math.abs(runnable.delta)
				const result = stepCan(def, current, delta)
				if (result === undefined) throw new PaletteError(`run: unknown step "${def.id}"`)
				return result
			}
		}
	}

	/**
	 * Run a runnable description: action, setter, toggle, number step, or a
	 * virtual `enum-from` (bare `action` re-writes the current key, `set`
	 * maps a key).
	 *
	 * Strictness: setters, toggles and steps on absent (skeleton) values
	 * throw `PaletteError` (no silent default fill — the consumer hydrates
	 * via `setMany` first). `get(id)` stays lenient for render/skeleton
	 * probing.
	 *
	 * Synchronous: `PaletteError`s are thrown, not rejected. Action-point
	 * `run()` may return a promise; core does not await it — the caller
	 * decides whether to `await`.
	 */
	run(runnable: Runnable): void {
		const command: Runnable = runnable
		if (!isRunnable(command)) throw new PaletteError(`run: invalid runnable`)
		const virtual = this.virtuals.get(command.point)
		if (virtual !== undefined) {
			const source = resolveVirtualSource(virtual, this.definitions)
			if (command.kind === 'action') {
				const key = readEnumFrom(virtual, this.values.get(source.id))
				if (key === undefined)
					throw new PaletteError(`run: virtual "${virtual.id}" has no option for the current value`)
				this.values.set(source.id, resolveEnumSourceValue(virtual, key) as never)
				return
			}
			if (command.kind !== 'set' || typeof command.value !== 'string')
				throw new PaletteError(`run: virtual "${virtual.id}" supports only setters`)
			this.values.set(source.id, resolveEnumSourceValue(virtual, command.value) as never)
			return
		}
		const def = this.definitions.get(command.point)
		if (def === undefined) throw new PaletteError(`run: unknown point "${command.point}"`)
		if (command.kind === 'action') {
			if (!isActionPoint(def))
				throw new PaletteError(`run: point "${command.point}" is not an action`)
			def.run(...this.resolveBags(def.uses))
			return
		}
		if (!isValuedPoint(def))
			throw new PaletteError(`run: point "${command.point}" is an action`)
		if (command.kind === 'set') {
			this.writeValue(command.point, this.coerceSetValue(def, command.value))
			return
		}
		if (command.kind === 'toggle') {
			if (def.type !== 'boolean')
				throw new PaletteError(`run: point "${command.point}" is not a boolean`)
			const current = this.readValue(def.id)
			if (current === undefined) throw new PaletteError(`run: no value for "${def.id}" (skeleton)`)
			this.writeValue(def.id, !(current as boolean))
			return
		}
		const delta = command.kind === 'inc' ? Math.abs(command.delta) : -Math.abs(command.delta)
		this.applyStep(def, delta)
	}

	/** Coerce a `set` payload: typed values pass through, string tokens parse like the wire. */
	private coerceSetValue(def: AnyValuedPoint, value: unknown): unknown {
		if (typeof value === 'string' && (def.type === 'boolean' || def.type === 'number')) {
			return readSetterValue(def, value)
		}
		return value
	}

	/** Layout subscription — fresh `SerializedLayout` snapshot per mutation. */
	subscribeLayout(listener: LayoutListener): Unsubscribe {
		return this.layout.subscribe(listener)
	}

	/** Layout op subscription — per-mutation descriptor (adapter node-map sync). */
	subscribeLayoutOps(listener: LayoutOpListener): Unsubscribe {
		return this.layout.subscribeOps(listener)
	}

	/** Adapter teardown: drop every listener. Values + layout are kept. */
	dispose(): void {
		this.values.clearListeners()
		this.layout.clearListeners()
		for (const unsub of this.bagForwards.values()) unsub()
		this.bagForwards.clear()
		this.bags.clear()
		this.contextListeners.clear()
		this.canListeners.clear()
		this.definitionListeners.clear()
		this.canCache.clear()
	}

	private allIds(): Set<string> {
		return new Set([...this.definitions.keys(), ...this.virtuals.keys()])
	}

	/** Point ids only (excludes virtuals) — for inline-spec validation. */
	private allPointIds(): Set<string> {
		return new Set(this.definitions.keys())
	}

	/** Apply a step (`id+=x` / `id-=x`) to a number point. Strict: absent value throws. */
	private applyStep(def: AnyValuedPoint, delta: number): void {
		if (def.type !== 'number') throw new PaletteError(`run: unknown step "${def.id}"`)
		const constraints = def.constraints as
			| { readonly min?: number; readonly max?: number }
			| undefined
		const current = this.readValue(def.id)
		if (current === undefined) throw new PaletteError(`run: no value for "${def.id}" (skeleton)`)
		const next = (current as number) + delta
		const clamped =
			constraints?.max !== undefined && next > constraints.max
				? constraints.max
				: constraints?.min !== undefined && next < constraints.min
					? constraints.min
					: next
		this.writeValue(def.id, clamped)
	}
}

/**
 * Pure `can` for a step over a number point: returns `true` / `false`,
 * `undefined` for a non-number point. Bounds-checked against `max` / `min`
 * (`undefined` bound = unlimited). Absent (skeleton) `current` throws
 * `PaletteError` — strict path (surfaced as `can: no value for "…"`).
 */
function stepCan(def: AnyValuedPoint, current: unknown, delta: number): boolean | undefined {
	if (def.type === 'number') {
		const constraints = def.constraints as
			| { readonly min?: number; readonly max?: number }
			| undefined
		if (current === undefined)
			throw new PaletteError(`can: no value for "${def.id}" (skeleton)`)
		const value = current as number
		// A press that would overshoot the bound is disabled, mirroring the
		// stepper UI (`value + delta >/< bound` → disabled). A small epsilon
		// absorbs float error (`0.1 + 0.2` style drift).
		const epsilon = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(delta)) * 8
		if (delta >= 0)
			return constraints?.max === undefined || value + delta <= constraints.max + epsilon
		return constraints?.min === undefined || value + delta >= constraints.min - epsilon
	}
	return undefined
}
