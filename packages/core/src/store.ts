/**
 * `@palettable/core` — runtime value store, the single source of truth.
 *
 * - Storage is a `Map<pointId, value>` — no shallow-copy object, no nested
 *   reactivity. Objects stored as values are opaque; mutate via `set()`.
 * - Starts EMPTY: no hydration from definitions, no defaults inside core.
 *   Absent key = skeleton (`undefined`). Only `initialValues` / `setMany`
 *   (validated in `PaletteCore`) and direct `set` / `setTree` fill it.
 * - `set()` is a no-op when `Object.is`-equal (echo-loop guard for adapters).
 * - Listeners are split into global (`(id, value)`) and per-id (`(value)`).
 *   Notification iterates over a snapshot so unsubscribe-during-notify is safe;
 *   a throwing listener never blocks the others (errors are re-thrown
 *   asynchronously via `queueMicrotask` — the store stays consistent).
 * - Strictness: `get(id)` stays lenient (absent → `undefined`, the skeleton
 *   probe). `require(id)` throws `PaletteError` on absent (strict paths:
 * `run` setter / toggle / step source).
 */
import { PaletteError } from './errors.js'
import { scheduleMicrotask } from './globals.js'
import type { GlobalValueListener, KeyValueListener, Unsubscribe } from './identifiers.js'
import type { PointType, TypeMap } from './type.js'

export class PaletteStateStore {
	private values = new Map<string, unknown>()
	private globalListeners = new Set<GlobalValueListener>()
	private keyListeners = new Map<string, Set<KeyValueListener>>()

	/** Read the current value of a valued point. Absent → `undefined` (skeleton probe). */
	get<K extends PointType>(id: string): TypeMap[K] | undefined {
		return this.values.get(id) as TypeMap[K] | undefined
	}

	/** True when the store holds a value for `id` (skeleton = `false`). */
	has(id: string): boolean {
		return this.values.has(id)
	}

	/**
	 * Read the current value, throwing `PaletteError` when absent.
	 * Strict paths (`run` setter, named actions, stash source) use this;
	 * render/skeleton probing uses lenient `get`.
	 */
	require<K extends PointType>(id: string): TypeMap[K] {
		if (!this.values.has(id)) throw new PaletteError(`PaletteStateStore: no value for "${id}"`)
		return this.values.get(id) as TypeMap[K]
	}

	/** Write a value; no-op when `Object.is`-equal. Notifies global + key listeners. */
	set<K extends PointType>(id: string, value: TypeMap[K]): void {
		const previous = this.values.get(id)
		if (Object.is(previous, value)) return
		this.values.set(id, value)
		this.notify(id, value)
	}

	/**
	 * Apply many pairs at once, then notify once per changed key in a single
	 * flush pass (all writes land before any listener runs — no interleaved
	 * write+notify like N× `set()` would produce). Pairs whose value is
	 * `Object.is`-equal to the current value are skipped (same echo-loop
	 * guard as `set`). Returns the `Object.is`-changed key array (mirrored
	 * by `ValuesBag`, which notifies with this array directly; the store
	 * keeps its existing `(id, value)` / `(value)` listener contract).
	 * Unknown ids are written as-is (same leniency as `set`); validation
	 * against point definitions happens in `PaletteCore`
	 * (`initialValues` / `setMany`), not here.
	 * Existing `set()` / `notify()` behaviour is unchanged.
	 */
	setTree(patch: Readonly<Record<string, unknown>>): readonly string[] {
		const changed: string[] = []
		for (const [id, value] of Object.entries(patch)) {
			const previous = this.values.get(id)
			if (Object.is(previous, value)) continue
			this.values.set(id, value)
			changed.push(id)
		}
		for (const id of changed) this.notify(id, this.values.get(id))
		return changed
	}

	/** Plain-object snapshot (fresh object each call; values are by reference). */
	asObject(): Record<string, unknown> {
		return Object.fromEntries(this.values)
	}

	/** Subscribe to every change. Returns an unsubscribe function. */
	subscribe(listener: GlobalValueListener): Unsubscribe
	/** Subscribe to one point id. Returns an unsubscribe function. */
	subscribe<V>(id: string, listener: KeyValueListener<V>): Unsubscribe
	subscribe<V>(
		idOrListener: string | GlobalValueListener,
		listener?: KeyValueListener<V>
	): Unsubscribe {
		if (typeof idOrListener === 'function') {
			const global = idOrListener
			this.globalListeners.add(global)
			return () => {
				this.globalListeners.delete(global)
			}
		}
		const id = idOrListener
		const keyListener = listener as KeyValueListener
		let listeners = this.keyListeners.get(id)
		if (!listeners) {
			listeners = new Set()
			this.keyListeners.set(id, listeners)
		}
		listeners.add(keyListener)
		return () => {
			const set = this.keyListeners.get(id)
			set?.delete(keyListener)
			if (set !== undefined && set.size === 0) this.keyListeners.delete(id)
		}
	}

	/** Remove all listeners (adapter teardown). Values are kept. */
	clearListeners(): void {
		this.globalListeners.clear()
		this.keyListeners.clear()
	}

	private notify(id: string, value: unknown): void {
		const errors: unknown[] = []
		for (const listener of [...this.globalListeners]) {
			try {
				listener(id, value)
			} catch (error) {
				errors.push(error)
			}
		}
		for (const listener of [...(this.keyListeners.get(id) ?? [])]) {
			try {
				listener(value)
			} catch (error) {
				errors.push(error)
			}
		}
		for (const error of errors) {
			scheduleMicrotask(() => {
				throw error
			})
		}
	}
}
