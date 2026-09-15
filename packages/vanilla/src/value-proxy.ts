/**
 * `@palettable/vanilla` — plain-object value lens over a bag (adapter-owned bridge).
 *
 * `createValueProxy(bag, target?, onChange?, options?)` returns a `Proxy`
 * with a single render path: every HTML update flows from the `onChange`
 * event, never from the setter directly.
 *
 * - bag keys (default: every key; demo passes `isBagKey` to partition):
 *   proxy-set → `bag.set(key, value)` → bag-notify → write-through to
 *   `target` + `onChange(key, value)`. The setter itself never calls
 *   `onChange`; the event does, so one bag write = one `onChange`.
 * - local keys (`isBagKey` returns false, e.g. UI-only `lastAction`):
 *   proxy-set writes `target` + fires `onChange` directly (no bag write,
 *   so UI state never pollutes the store).
 * - `Object.is` echo-loop guard in both directions (proxy-set skips when the
 *   bag/target already holds the value; bag-notify skips when the target
 *   already holds it).
 *
 * The adapter never owns the store: the bag stays the single source of
 * truth, the proxy is a lens. Works with both `PaletteStateStore`
 * (`subscribe(id, listener)` / `(id, value)` globals) and `ValuesBag`
 * (`subscribe(key, listener)` / `(changed[])` globals) notify shapes.
 */

/** Minimal bag surface shared by `PaletteStateStore` and `ValuesBag`. */
export type ValueBagLike = {
	get(id: string): unknown
	set(id: string, value: never): void
	subscribe(listener: (...args: never[]) => void): () => void
	subscribe(id: string, listener: (value: unknown) => void): () => void
}

export type ValueProxyHandle<T extends Record<string, unknown>> = {
	/** Plain-object lens: reads/writes go through the bag. */
	readonly proxy: T
	/** The backing plain object (defaults to a fresh `{}`). */
	readonly target: T
	/** Drop the bag subscription (proxy stays usable, stops syncing). */
	dispose: () => void
	/** Force a full pull from the bag into the target. */
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

export type ValueProxyOptions = {
	/**
	 * Partition keys: `true` = bag-owned (proxy-set → `bag.set`, render via
	 * bag-notify only), `false` = local-only (proxy-set writes `target` +
	 * fires `onChange` directly, never touches the bag). Defaults to every
	 * key bag-owned (back-compat). The demo passes its `COLONY_VALUE_KEYS`
	 * set so UI-only keys (`lastAction`, `missionElapsed`) never pollute
	 * the store.
	 */
	isBagKey?: (key: string) => boolean
}

/**
 * Create a plain-object lens over a bag.
 *
 * @param bag Bag holding the single source of truth (never owned here).
 * @param target Backing object the proxy writes through to on bag-notify
 *   (defaults to a fresh object; pass your `demoState` to keep it in sync).
 * @param onChange Single render path: called once per committed change,
 *   whether it came from bag-notify (bag keys) or a local write. The
 *   setter itself never calls it for bag keys — the bag-notify does.
 */
export function createValueProxy<T extends Record<string, unknown>>(
	bag: ValueBagLike,
	target?: T,
	onChange?: (key: keyof T & string, value: unknown) => void,
	options?: ValueProxyOptions
): ValueProxyHandle<T> {
	const backing: Record<string, unknown> = (target ?? {}) as Record<string, unknown>
	const isBagKey = options?.isBagKey ?? ((): boolean => true)
	let disposed = false

	const pullKey = (key: string): void => {
		if (!isBagKey(key)) return
		const value = bag.get(key)
		if (Object.is(backing[key], value)) return
		backing[key] = value
		onChange?.(key as keyof T & string, value)
	}

	const syncFromBag = (): void => {
		for (const key of readBagKeys(bag)) pullKey(key)
	}

	// Bag → target: handle both notify shapes.
	// - Store: global `(id, value)`, key `(value)`.
	// - ValuesBag: global `(changed[])`, key `(value)`.
	// This is the ONLY render path for bag keys: the proxy setter below
	// writes the bag and lets this notify fire `onChange` (one bag write =
	// one `onChange`), so the setter itself never calls `onChange`.
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

	const proxy = new Proxy(backing, {
		get(ownTarget, property, receiver) {
			if (typeof property !== 'string') return Reflect.get(ownTarget, property, receiver)
			if (!isBagKey(property)) return Reflect.get(ownTarget, property, receiver)
			// Prefer the bag when it holds the key (single source); fall back
			// to the backing object for keys the bag hasn't seen yet.
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
				// Local-only key: no bag write; render via `onChange` directly.
				if (Object.is(Reflect.get(ownTarget, property, receiver), value)) return true
				Reflect.set(ownTarget, property, value, receiver)
				onChange?.(property as keyof T & string, value)
				return true
			}
			// Bag key: echo-loop guard — skip the write when the bag already
			// holds the value. Otherwise write the bag and let bag-notify
			// (above) do the write-through + `onChange`; never call it here.
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

	return {
		proxy,
		target: backing as T,
		dispose: () => {
			disposed = true
			for (const unsub of unsubs) unsub()
		},
		syncFromBag,
	}
}
