/**
 * `@palettable/core` — runtime value store, hydrated from point defaults.
 *
 * - Storage is a `Map<pointId, value>` — no shallow-copy object, no nested
 *   reactivity. Objects stored as values are opaque; mutate via `set()`.
 * - `set()` is a no-op when `Object.is`-equal (echo-loop guard for adapters).
 * - Listeners are split into global (`(id, value)`) and per-id (`(value)`).
 *   Notification iterates over a snapshot so unsubscribe-during-notify is safe;
 *   a throwing listener never blocks the others (errors are re-thrown
 *   asynchronously via `queueMicrotask` — the store stays consistent).
 */
import { scheduleMicrotask } from './globals.js'
import type { GlobalValueListener, KeyValueListener, Unsubscribe } from './identifiers.js'
import type { AnyPoint } from './points.js'
import { isValuedPoint } from './points.js'
import type { PointType, TypeMap } from './type.js'

export class PaletteStateStore {
	private values = new Map<string, unknown>()
	private globalListeners = new Set<GlobalValueListener>()
	private keyListeners = new Map<string, Set<KeyValueListener>>()

	constructor(definitions: readonly AnyPoint[]) {
		for (const def of definitions) {
			if (isValuedPoint(def)) this.values.set(def.id, def.defaultValue)
		}
	}

	/** Read the current value of a valued point. Unknown ids return `undefined`. */
	get<K extends PointType>(id: string): TypeMap[K] | undefined {
		return this.values.get(id) as TypeMap[K] | undefined
	}

	/** Read with an explicit fallback (e.g. the point default). */
	getOr<K extends PointType>(id: string, fallback: TypeMap[K]): TypeMap[K] {
		const value = this.values.get(id) as TypeMap[K] | undefined
		return value === undefined ? fallback : value
	}

	/** Write a value; no-op when `Object.is`-equal. Notifies global + key listeners. */
	set<K extends PointType>(id: string, value: TypeMap[K]): void {
		const previous = this.values.get(id)
		if (Object.is(previous, value)) return
		this.values.set(id, value)
		this.notify(id, value)
	}

	/** Functional update helper (`set(id, update(get(id)))`). */
	update<K extends PointType>(
		id: string,
		updater: (previous: TypeMap[K] | undefined) => TypeMap[K]
	): void {
		this.set(id, updater(this.get<K>(id)))
	}

	/** Restore one point to its definition default (no-op for actions / unknown ids). */
	reset(def: AnyPoint | undefined): void {
		if (isValuedPoint(def)) this.set(def.id, def.defaultValue)
	}

	/** Restore every known valued point to its default. */
	resetAll(definitions: readonly AnyPoint[]): void {
		for (const def of definitions) this.reset(def)
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
