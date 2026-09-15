/**
 * `@palettable/core` — context bags (Phase 8).
 *
 * `ValuesBag` is the flat, named key/value storage behind
 * `plans/context.md` §§1–3: same `Map` + `Object.is` + snapshot-iteration +
 * async error re-throw discipline as `PaletteStateStore`, but with the
 * context contract — `get()` returns `Object.freeze()`-wrapped values,
 * `setTree` notifies once with the changed-key array, and the global
 * subscription signature is `(changed: readonly string[]) => void`.
 *
 * The root bag `ROOT_CONTEXT` is core-owned (`PaletteCore.values` — the store
 * itself, generalized to this interface); non-root bags are host-owned and
 * start empty. Zero DOM, zero runes.
 */
import { PaletteWriteError } from './errors.js'
import { scheduleMicrotask } from './globals.js'
import type { Unsubscribe } from './identifiers.js'

/** Name of a context bag (`ROOT_CONTEXT` = root, i.e. `PaletteCore.values`). */
export type ContextName = string

/** Listener for bag changes: the array of `Object.is`-changed keys. */
export type BagListener = (changed: readonly string[]) => void

/** Listener for one key: the new value (`undefined` when absent). */
export type BagKeyListener<V = unknown> = (value: V | undefined) => void

/**
 * Flat, named key/value storage. Generic over the shape (`ValuesBag<Shape>`
 * with typed `get`); core uses the default `Record<string, unknown>` shape.
 */
export class ValuesBag<Shape extends Record<string, unknown> = Record<string, unknown>> {
	private values = new Map<string, unknown>()
	private globalListeners = new Set<BagListener>()
	private keyListeners = new Map<string, Set<BagKeyListener>>()
	private locked = false

	constructor(initial?: Readonly<Partial<Shape>>) {
		if (initial !== undefined) {
			for (const [key, value] of Object.entries(initial)) this.values.set(key, value)
		}
	}

	/**
	 * Read a key. Non-scalar values are `Object.freeze()`-wrapped at
	 * runtime (primitives are immune — zero overhead); mutating a frozen
	 * object throws the engine's own `TypeError` in strict mode.
	 */
	get<K extends keyof Shape>(key: K): Shape[K] | undefined {
		return freezeValue(this.values.get(key as string)) as Shape[K] | undefined
	}

	/**
	 * Write a key; no-op when `Object.is`-equal. Notifies global + key
	 * listeners. Throws `PaletteWriteError` when the bag is locked.
	 */
	set<K extends keyof Shape>(key: K, value: Shape[K]): void {
		if (this.locked) throw new PaletteWriteError(`ValuesBag is locked (key "${String(key)}")`)
		const name = key as string
		const previous = this.values.get(name)
		if (Object.is(previous, value)) return
		this.values.set(name, value)
		this.notify([name])
	}

	/**
	 * Apply many pairs at once, then notify once with the changed-key
	 * array (all writes land before any listener runs). `Object.is`-equal
	 * pairs are skipped. Returns the changed keys. Throws
	 * `PaletteWriteError` when the bag is locked.
	 */
	setTree(patch: Readonly<Partial<Shape>>): readonly string[] {
		if (this.locked) throw new PaletteWriteError('ValuesBag is locked (setTree rejected)')
		const changed: string[] = []
		for (const [key, value] of Object.entries(patch)) {
			const previous = this.values.get(key)
			if (Object.is(previous, value)) continue
			this.values.set(key, value)
			changed.push(key)
		}
		if (changed.length > 0) this.notify(changed)
		return changed
	}

	/** Fresh plain-object snapshot (values are frozen references). */
	asObject(): { readonly [K in keyof Shape]?: Shape[K] } {
		const out: Record<string, unknown> = {}
		for (const [key, value] of this.values) out[key] = freezeValue(value)
		return out as { readonly [K in keyof Shape]?: Shape[K] }
	}

	/** Subscribe to every change (receives the changed-key array). */
	subscribe(listener: BagListener): Unsubscribe
	/** Subscribe to one key. Returns an unsubscribe function. */
	subscribe<K extends keyof Shape>(key: K, listener: BagKeyListener<Shape[K]>): Unsubscribe
	subscribe<K extends keyof Shape>(
		keyOrListener: K | BagListener,
		listener?: BagKeyListener<Shape[K]>
	): Unsubscribe {
		if (typeof keyOrListener === 'function') {
			const global = keyOrListener as BagListener
			this.globalListeners.add(global)
			return () => {
				this.globalListeners.delete(global)
			}
		}
		const key = keyOrListener as string
		const keyListener = listener as BagKeyListener
		let listeners = this.keyListeners.get(key)
		if (!listeners) {
			listeners = new Set()
			this.keyListeners.set(key, listeners)
		}
		listeners.add(keyListener)
		return () => {
			const set = this.keyListeners.get(key)
			set?.delete(keyListener)
			if (set !== undefined && set.size === 0) this.keyListeners.delete(key)
		}
	}

	/** Remove all listeners (adapter / core teardown). Values are kept. */
	clearListeners(): void {
		this.globalListeners.clear()
		this.keyListeners.clear()
	}

	/** Lock the bag: every `set` / `setTree` throws `PaletteWriteError`. */
	lock(): void {
		this.locked = true
	}

	/** Unlock a locked bag. */
	unlock(): void {
		this.locked = false
	}

	private notify(changed: readonly string[]): void {
		const errors: unknown[] = []
		for (const listener of [...this.globalListeners]) {
			try {
				listener(changed)
			} catch (error) {
				errors.push(error)
			}
		}
		for (const key of changed) {
			for (const listener of [...(this.keyListeners.get(key) ?? [])]) {
				try {
					listener(freezeValue(this.values.get(key)))
				} catch (error) {
					errors.push(error)
				}
			}
		}
		for (const error of errors) {
			scheduleMicrotask(() => {
				throw error
			})
		}
	}
}

function freezeValue(value: unknown): unknown {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value)
	}
	return value
}
