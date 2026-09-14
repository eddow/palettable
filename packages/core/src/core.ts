/**
 * `@palettable/core` — main entry point: point registry + virtual points +
 * value store + layout tree.
 *
 * Framework adapters subscribe to `state` / `layout` and render; all pointer
 * math, DOM and components live outside this class.
 */

import type { EditorDefaults, EditorRegistry } from './editors.js'
import { PaletteError } from './errors.js'
import type { GlobalValueListener, KeyValueListener, Unsubscribe } from './identifiers.js'
import type { KeyBindings } from './keys.js'
import {
	defaultLayoutFromPoints,
	type LayoutListener,
	type PaletteLayout,
	PaletteLayoutTree,
	type SerializedLayout,
} from './layout.js'
import type { AnyPoint, AnyValuedPoint } from './points.js'
import { isActionPoint, isValuedPoint } from './points.js'
import { canonicalPointId, parsePointSpec } from './specs.js'
import { PaletteStateStore } from './store.js'
import type { PointType, TypeMap } from './type.js'
import {
	assertValidVirtual,
	computeStashTransition,
	isEnumFromPoint,
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
}

/**
 * Main entry point: point registry + value store + layout tree.
 * Framework adapters subscribe to `state` / `layout` and render; all pointer
 * math, DOM and components live outside this class.
 */
export class PaletteCore {
	readonly state: PaletteStateStore
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
		this.state = new PaletteStateStore(points)
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

	getValue<K extends PointType>(id: string): TypeMap[K] | undefined {
		const virtual = this.virtuals.get(canonicalPointId(id))
		if (virtual !== undefined && isEnumFromPoint(virtual)) {
			const source = resolveVirtualSource(virtual, this.definitions)
			const key = readEnumFrom(virtual, this.state.get(source.id))
			return key as TypeMap[K] | undefined
		}
		return this.state.get<K>(canonicalPointId(id))
	}

	setValue<K extends PointType>(id: string, value: TypeMap[K]): void {
		const pointId = canonicalPointId(id)
		const virtual = this.virtuals.get(pointId)
		if (virtual !== undefined) {
			if (!isEnumFromPoint(virtual))
				throw new PaletteError(`setValue: virtual "${pointId}" is a stash action`)
			const source = resolveVirtualSource(virtual, this.definitions)
			this.state.set(source.id, resolveEnumSourceValue(virtual, value as string) as never)
			return
		}
		const def = this.definitions.get(pointId)
		if (def === undefined) throw new PaletteError(`setValue: unknown point "${id}"`)
		if (isActionPoint(def)) throw new PaletteError(`setValue: point "${id}" is an action`)
		this.state.set(pointId, value)
	}

	/** Restore one point (or virtual source) to its default. */
	resetValue(id: string): void {
		const virtual = this.virtuals.get(canonicalPointId(id))
		if (virtual !== undefined) {
			if (isStashPoint(virtual)) this.stashAsides.delete(virtual.id)
			this.state.reset(resolveVirtualSource(virtual, this.definitions))
			return
		}
		this.state.reset(this.getDefinition(id))
	}

	/** Restore every valued point to its default (clears all stash aside slots). */
	resetAll(): void {
		this.state.resetAll(this.points)
		this.stashAsides.clear()
	}

	/**
	 * Run an action point, setter spec (`id=value`), action spec (`id:action`),
	 * virtual `enum-from` setter (`virtualId=key`), or a `stash` virtual id.
	 */
	async run(spec: string): Promise<void> {
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
				const key = readEnumFrom(virtual, this.state.get(source.id))
				if (key === undefined)
					throw new PaletteError(`run: virtual "${virtual.id}" has no option for the current value`)
				this.state.set(source.id, resolveEnumSourceValue(virtual, key) as never)
				return
			}
			if (parsed.kind === 'action')
				throw new PaletteError(`run: virtual "${virtual.id}" supports no actions`)
			this.state.set(source.id, resolveEnumSourceValue(virtual, parsed.value) as never)
			return
		}
		const def = this.definitions.get(parsed.pointId)
		if (def === undefined) throw new PaletteError(`run: unknown point "${parsed.pointId}"`)
		if (parsed.kind === 'point') {
			if (!isActionPoint(def)) throw new PaletteError(`run: point "${spec}" is not an action`)
			await def.run()
			return
		}
		if (!isValuedPoint(def)) throw new PaletteError(`run: point "${parsed.pointId}" is an action`)
		if (parsed.kind === 'setter') {
			this.state.set(parsed.pointId, coerceSetterValue(def, parsed.value) as never)
			return
		}
		applyNamedAction(this, def, parsed.action)
	}

	/** Run a `stash` virtual by id (pure toggle, see `computeStashTransition`). */
	runStash(id: string): void {
		const virtual = this.virtuals.get(canonicalPointId(id))
		if (virtual === undefined) throw new PaletteError(`runStash: unknown virtual "${id}"`)
		if (!isStashPoint(virtual)) throw new PaletteError(`runStash: virtual "${id}" is not a stash`)
		const source = resolveVirtualSource(virtual, this.definitions)
		const aside = this.stashAsides.get(virtual.id) ?? { has: false }
		const transition = computeStashTransition(
			this.state.get(source.id),
			virtual.stashedValue,
			aside,
			source.defaultValue
		)
		this.state.set(source.id, transition.next as never)
		if (transition.asideAfter.has) this.stashAsides.set(virtual.id, transition.asideAfter)
		else this.stashAsides.delete(virtual.id)
	}

	/** Value subscription (global or per-id) — proxied to the store. */
	subscribe(listener: GlobalValueListener): Unsubscribe
	subscribe<V>(id: string, listener: KeyValueListener<V>): Unsubscribe
	subscribe<V>(
		idOrListener: string | GlobalValueListener,
		listener?: KeyValueListener<V>
	): Unsubscribe {
		if (typeof idOrListener === 'function') return this.state.subscribe(idOrListener)
		return this.state.subscribe(idOrListener, listener as KeyValueListener)
	}

	/** Layout subscription — fresh `SerializedLayout` snapshot per mutation. */
	subscribeLayout(listener: LayoutListener): Unsubscribe {
		return this.layout.subscribe(listener)
	}

	/** Adapter teardown: drop every listener. Values + layout are kept. */
	dispose(): void {
		this.state.clearListeners()
		this.layout.clearListeners()
	}

	private allIds(): Set<string> {
		return new Set([...this.definitions.keys(), ...this.virtuals.keys()])
	}
}

/** Coerce a setter string (`id=value`) to the point's value type. */
function coerceSetterValue(def: AnyValuedPoint, raw: string): unknown {
	switch (def.type) {
		case 'boolean':
			if (raw === 'true') return true
			if (raw === 'false') return false
			throw new PaletteError(`setter: cannot coerce "${raw}" to boolean`)
		case 'number': {
			const value = Number(raw)
			if (Number.isNaN(value)) throw new PaletteError(`setter: cannot coerce "${raw}" to number`)
			return value
		}
		default:
			return raw
	}
}

/** Built-in named actions (`id:action`). Only `number` ships `inc`/`dec` for now. */
function applyNamedAction(core: PaletteCore, def: AnyValuedPoint, action: string): void {
	if (def.type === 'number') {
		const step = (def.constraints as { readonly step?: number } | undefined)?.step ?? 1
		const current = (core.getValue(def.id) as number | undefined) ?? (def.defaultValue as number)
		if (action === 'inc') {
			core.setValue(def.id, (current + step) as never)
			return
		}
		if (action === 'dec') {
			core.setValue(def.id, (current - step) as never)
			return
		}
	}
	throw new PaletteError(`run: unknown action "${def.id}:${action}"`)
}
