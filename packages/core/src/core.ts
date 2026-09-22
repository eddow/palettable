/**
 * `@palettable/core` — main entry point: point registry + virtual points +
 * value store + layout tree.
 *
 * Framework adapters read/write through `values` and subscribe to `layout`;
 * all pointer math, DOM and components live outside this class.
 */

import type { ContextName, ValuesBag } from './context.js'
import type { EditorDefaults, EditorRegistry } from './editors.js'
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
	readonly initialLayout?: AnySerializedLayout | PaletteLayout
	// Note: not completely implemented, still under construction
	/** End-user-defined virtual points (`enum-from` / `stash`). */
	readonly virtuals?: readonly VirtualPoint[]
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
	/** Cached definition arrays (invalidated on registry mutation). */
	private pointsCache: readonly AnyPoint[] | undefined
	private virtualPointsCache: readonly VirtualPoint[] | undefined
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
		this.editors = options.editors
		this.editorDefaults = options.editorDefaults
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
	 * Evaluate the functional `can` of an action point with the
	 * currently-registered bags (missing → `undefined` slot; omitted `can`
	 * = enabled). Throws `PaletteError` on unknown ids and non-action points.
	 */
	readActionCan(id: string): boolean | undefined {
		const pointId = canonicalPointId(id)
		const def = this.definitions.get(pointId)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (!isActionPoint(def)) throw new PaletteError(`Palette point "${id}" is not an action`)
		return this.evaluateCan(pointId)
	}

	/**
	 * Read the live value for a valued point: dual-source precedence —
	 * the first non-root used bag holding the id wins, else the root
	 * value. Absent bag / absent key → root. Never throws on missing
	 * context; throws `PaletteError` on unknown ids and non-valued points.
	 * Adapters share this read path (vanilla `liveValue` delegates here).
	 */
	readValue(id: string): unknown {
		const pointId = canonicalPointId(id)
		const def = this.definitions.get(pointId)
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
		const pointId = canonicalPointId(id)
		const def = this.definitions.get(pointId)
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
	 * (missing → `undefined` slot). Omitted `can` = enabled. Throws
	 * `PaletteError` on unknown point ids.
	 */
	evaluateCan(pointId: string): boolean {
		const id = canonicalPointId(pointId)
		const def = this.definitions.get(id)
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (def.can === undefined) return true
		return def.can(...this.resolveBags(def.uses))
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
		this.stashAsides.delete(virtual.id)
		this.emitDefinitions(virtual.id)
	}

	/** Remove a virtual point (drops its stash aside slot). Emits a definition notification. */
	removeVirtual(id: string): void {
		this.virtuals.delete(id)
		this.virtualPointsCache = undefined
		this.stashAsides.delete(id)
		this.emitDefinitions(canonicalPointId(id))
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
		const pointId = canonicalPointId(id)
		const def = this.definitions.get(pointId)
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
		this.definitions.set(pointId, {
			...def,
			constraints: { ...(def.constraints as object | undefined), options: [...options] },
		} as AnyPoint)
		this.pointsCache = undefined
		this.emitDefinitions(pointId)
	}

	/**
	 * Can a named action (`id:action`) run? Bounds-checked for `number`
	 * actions (`inc` stops at `max`, `dec` stops at `min`), mirroring the
	 * Svelte reference's `valueActions.number.inc.get can()`.
	 * Reads the live value through context (`readValue`), so contextual
	 * tools gate on the selection. Throws `PaletteError` on unknown
	 * points/actions and on absent (skeleton) values — strict path.
	 */
	canRunAction(id: string, action: string): boolean {
		const def = this.definitions.get(canonicalPointId(id))
		if (def === undefined) throw new PaletteError(`Unknown palette point "${id}"`)
		if (!isValuedPoint(def)) throw new PaletteError(`Palette point "${id}" is an action`)
		const current = this.readValue(def.id)
		if (current === undefined)
			throw new PaletteError(`canRunAction: no value for "${def.id}" (skeleton)`)
		const can = namedActionCan(def, current, action)
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
	 * Strictness: `id=value` setters and `id:action` on absent (skeleton)
	 * values throw `PaletteError` (no silent default fill — the consumer
	 * hydrates via `setMany` first). `get(id)` stays lenient for
	 * render/skeleton probing.
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
			def.run(...this.resolveBags(def.uses))
			return
		}
		if (!isValuedPoint(def)) throw new PaletteError(`run: point "${parsed.pointId}" is an action`)
		if (parsed.kind === 'setter') {
			this.writeValue(parsed.pointId, readSetterValue(def, parsed.value))
			return
		}
		this.applyNamedAction(def, parsed.action)
	}

	/**
	 * Run a `stash` virtual by id (pure toggle, see `computeStashTransition`).
	 * Strict source read: absent (skeleton) source throws `PaletteError`.
	 * Third branch writes `virtual.fallbackValue` (`undefined` = stay skeleton).
	 */
	runStash(id: string): void {
		const virtual = this.virtuals.get(canonicalPointId(id))
		if (virtual === undefined) throw new PaletteError(`runStash: unknown virtual "${id}"`)
		if (!isStashPoint(virtual)) throw new PaletteError(`runStash: virtual "${id}" is not a stash`)
		const source = resolveVirtualSource(virtual, this.definitions)
		if (!this.values.has(source.id))
			throw new PaletteError(`runStash: no value for source "${source.id}" (skeleton)`)
		const aside = this.stashAsides.get(virtual.id) ?? { has: false }
		const transition = computeStashTransition(
			this.values.get(source.id),
			virtual.stashedValue,
			aside,
			virtual.fallbackValue
		)
		this.values.set(source.id, transition.next as never)
		if (transition.asideAfter.has) this.stashAsides.set(virtual.id, transition.asideAfter)
		else this.stashAsides.delete(virtual.id)
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

	/** Apply a named action (`id:action`) to a valued point. Strict: absent value throws. */
	private applyNamedAction(def: AnyValuedPoint, action: string): void {
		const constraints = def.constraints as
			| { readonly min?: number; readonly max?: number; readonly step?: number }
			| undefined
		const step = constraints?.step ?? 1
		const current = this.readValue(def.id)
		if (current === undefined) throw new PaletteError(`run: no value for "${def.id}" (skeleton)`)
		if (def.type === 'number') {
			if (action === 'inc') {
				const next = (current as number) + step
				const clamped = constraints?.max === undefined ? next : Math.min(next, constraints.max)
				this.writeValue(def.id, clamped)
				return
			}
			if (action === 'dec') {
				const next = (current as number) - step
				const clamped = constraints?.min === undefined ? next : Math.max(next, constraints.min)
				this.writeValue(def.id, clamped)
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
 * Absent (skeleton) `current` throws `PaletteError` — strict path.
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
		if (current === undefined)
			throw new PaletteError(`canRunAction: no value for "${def.id}" (skeleton)`)
		const value = current as number
		// Step-aware: a press that would overshoot the bound is disabled,
		// mirroring the stepper UI (`value ± step >/< bound` → disabled).
		// A small epsilon absorbs float error (`0.1 + 0.2` style drift).
		const step = constraints?.step ?? 1
		const epsilon = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(step)) * 8
		if (action === 'inc')
			return constraints?.max === undefined || value + step <= constraints.max + epsilon
		if (action === 'dec')
			return constraints?.min === undefined || value - step >= constraints.min - epsilon
	}
	return undefined
}
