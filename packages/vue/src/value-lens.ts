/**
 * `@palettable/vue` — reactive value lens over a bag (adapter-owned bridge).
 *
 * `useValueLens(bag, options?)` returns a Vue `reactive` object with the
 * same single-render-path contract as the vanilla adapter's
 * `createValueProxy`: every component update flows from the bag-notify
 * event, never from the setter directly.
 *
 * - bag keys (default: every key; the demo passes `isBagKey` to partition):
 *   lens-set → `bag.set(key, value)` → bag-notify → write-through to the
 *   reactive state. The setter itself never triggers a second write; the
 *   event does, so one bag write = one reactive update.
 * - local keys (`isBagKey` returns false, e.g. UI-only `lastAction`):
 *   lens-set writes the reactive state directly (no bag write, so UI
 *   state never pollutes the store).
 * - `Object.is` echo-loop guard in both directions (lens-set skips when the
 *   bag already holds the value; bag-notify skips when the state already
 *   holds it).
 *
 * The adapter never owns the store: the bag stays the single source of
 * truth, the lens is a view. Works with `PaletteStateStore`
 * (`subscribe(id, listener)` / `(id, value)` globals) notify shapes.
 * Call `dispose()` (or let `onUnmounted` do it when called inside `setup`)
 * to drop the bag subscription.
 */
import { getCurrentInstance, onUnmounted, reactive } from 'vue'

/** Minimal bag surface shared by `PaletteStateStore` and `ValuesBag`. */
export type ValueBagLike = {
	get(id: string): unknown
	set(id: string, value: never): void
	subscribe(listener: (...args: never[]) => void): () => void
	subscribe(id: string, listener: (value: unknown) => void): () => void
}

export type ValueLensHandle<T extends Record<string, unknown>> = {
	/** Reactive lens: reads/writes go through the bag. */
	readonly state: T
	/** Drop the bag subscription (lens stays usable, stops syncing). */
	dispose: () => void
	/** Force a full pull from the bag into the state. */
	syncFromBag: () => void
}

function isStoreShape(
	bag: ValueBagLike
): bag is ValueBagLike & { asObject(): Record<string, unknown> } {
	return typeof (bag as { asObject?: unknown }).asObject === 'function'
}

function readBagKeys(bag: ValueBagLike): string[] {
	if (isStoreShape(bag)) return Object.keys(bag.asObject())
	return []
}

export type ValueLensOptions = {
	/**
	 * Partition keys: `true` = bag-owned (lens-set → `bag.set`, render via
	 * bag-notify only), `false` = local-only (lens-set writes the reactive
	 * state directly, never touches the bag). Defaults to every key
	 * bag-owned (back-compat). The demo passes its `COLONY_VALUE_KEYS`
	 * set so UI-only keys (`lastAction`, `missionElapsed`) never pollute
	 * the store.
	 */
	isBagKey?: (key: string) => boolean
	/**
	 * Seed for local-only keys (bag keys always seed from the bag).
	 * Defaults to `{}`.
	 */
	initial?: Record<string, unknown>
	/**
	 * Single render path: called once per committed change, whether it
	 * came from bag-notify (bag keys) or a local write. The setter itself
	 * never calls it for bag keys — the bag-notify does.
	 */
	onChange?: (key: string, value: unknown) => void
}

/**
 * Create a reactive lens over a bag.
 *
 * @param bag Bag holding the single source of truth (never owned here).
 * @param options Key partition + local seed + change notification.
 */
export function useValueLens<T extends Record<string, unknown>>(
	bag: ValueBagLike,
	options?: ValueLensOptions
): ValueLensHandle<T> {
	const isBagKey = options?.isBagKey ?? ((): boolean => true)
	const onChange = options?.onChange
	const backing: Record<string, unknown> = { ...(options?.initial ?? {}) }
	let disposed = false
	// Declared before `pullKey` (which writes through to it): `const`
	// hoisting means the binding exists at subscribe time but the
	// initializer runs here — notify can only fire after this line.
	const state = reactive(backing) as T

	const pullKey = (key: string): void => {
		if (!isBagKey(key)) return
		const value = bag.get(key)
		if (Object.is(backing[key], value)) return
		backing[key] = value
		// Write through to the reactive state (the proxy reads the bag
		// first, so without this the component never re-renders on
		// bag-notify — the bag changed but the reactive dep didn't).
		;(state as Record<string, unknown>)[key] = value
		onChange?.(key, value)
	}

	const syncFromBag = (): void => {
		for (const key of readBagKeys(bag)) pullKey(key)
	}

	// Bag → state: handle both notify shapes.
	// - Store: global `(id, value)`, key `(value)`.
	// - ValuesBag: global `(changed[])`, key `(value)`.
	// This is the ONLY render path for bag keys: the lens setter below
	// writes the bag and lets this notify write through (one bag write =
	// one reactive update), so the setter itself never writes `backing`.
	const unsubs: Array<() => void> = []
	unsubs.push(
		bag.subscribe(((...args: unknown[]) => {
			if (disposed) return
			if (args.length === 2 && typeof args[0] === 'string') {
				pullKey(args[0] as string)
				return
			}
			if (args.length === 1 && Array.isArray(args[0])) {
				for (const key of args[0] as string[]) pullKey(key)
			}
		}) as (...args: never[]) => void)
	)

	// `state` is declared above (before `pullKey`); this duplicate
	// declaration was left by the write-through edit — remove on sight.
	void reactive(backing)

	// Wrap the reactive state so bag-key writes route through `bag.set`
	// (render via notify) while local keys write the state directly.
	// NOTE: the proxy wraps the *reactive* object, so `get` must read the
	// bag (single source) — never `backing` directly, which Vue's
	// reactivity would otherwise bypass. After `dispose()`, bag-notify
	// stops writing `backing`, but `get` still prefers the live bag —
	// exactly like the vanilla proxy. Tests asserting a frozen post-dispose
	// read should read `bag.get` expectations, not the lens.
	const lens = new Proxy(state, {
		get(ownTarget, property, receiver) {
			if (typeof property !== 'string') return Reflect.get(ownTarget, property, receiver)
			if (!isBagKey(property)) return Reflect.get(ownTarget, property, receiver)
			// Prefer the bag when it holds the key (single source); fall back
			// to the reactive state for keys the bag hasn't seen yet.
			if ((bag as { has?: (id: string) => boolean }).has?.(property)) {
				return bag.get(property)
			}
			const bagValue = bag.get(property)
			if (bagValue !== undefined) return bagValue
			return Reflect.get(ownTarget, property, receiver)
		},
		set(ownTarget, property, value, receiver) {
			if (typeof property !== 'string') return Reflect.set(ownTarget, property, value, receiver)
			if (!isBagKey(property)) {
				// Local-only key: no bag write; render directly.
				if (Object.is(Reflect.get(ownTarget, property, receiver), value)) return true
				Reflect.set(ownTarget, property, value, receiver)
				onChange?.(property, value)
				return true
			}
			// Bag key: echo-loop guard — skip the write when the bag already
			// holds the value. Otherwise write the bag and let bag-notify
			// (above) do the write-through; never write `backing` here.
			if (Object.is(bag.get(property), value)) return true
			bag.set(property, value as never)
			return true
		},
		deleteProperty(ownTarget, property) {
			if (typeof property !== 'string') return Reflect.deleteProperty(ownTarget, property)
			return Reflect.deleteProperty(ownTarget, property)
		},
	}) as T

	// Initial pull so the lens starts consistent with the bag.
	syncFromBag()

	const dispose = (): void => {
		disposed = true
		for (const unsub of unsubs) unsub()
	}

	// Auto-teardown when called inside a component `setup()`. Outside
	// `setup()` (plain unit tests, demo wiring) there is no active
	// instance — the caller owns `dispose()`.
	if (getCurrentInstance() !== null) {
		onUnmounted(dispose)
	}

	return { state: lens, dispose, syncFromBag }
}
