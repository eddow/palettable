/**
 * `@palettable/core` — host globals.
 *
 * The core compiles with `lib: ["ES2022"]` only (no `DOM`), so the "zero DOM"
 * architectural rule is enforced by the compiler: any accidental `document`,
 * `HTMLElement` or `KeyboardEvent` reference fails `tsc`.
 *
 * `queueMicrotask` is the single host global the core relies on (used to
 * re-throw listener errors asynchronously without breaking the notify loop).
 * It exists in every target host (browsers, Node, workers) but is not part of
 * the ES2022 lib, so it is resolved here rather than pulling in `DOM` or
 * `@types/node`.
 */
const host = globalThis as unknown as {
	queueMicrotask: (callback: () => void) => void
	setTimeout: (callback: () => void, ms: number) => unknown
	clearTimeout: (handle: unknown) => void
	structuredClone: <T>(value: T) => T
}

/**
 * Re-throw an error asynchronously, off the current call stack.
 *
 * Resolved through `globalThis` on every call (not captured at module load) so
 * tests can spy on / stub the host global.
 */
export function scheduleMicrotask(callback: () => void): void {
	host.queueMicrotask(callback)
}

/**
 * Host timer: `setTimeout` resolved through `globalThis` per call (same
 * escape-hatch pattern as {@link scheduleMicrotask}). Timers exist in every
 * target host (browsers, Node, workers) but are not part of the ES2022 lib,
 * so they are resolved here rather than pulling in `DOM` or `@types/node`.
 *
 * @returns The host timer handle (opaque — pass to {@link clearHostTimeout}).
 */
export function scheduleHostTimeout(callback: () => void, ms: number): unknown {
	return host.setTimeout(callback, ms)
}

/** Clear a timer created by {@link scheduleHostTimeout}. */
export function clearHostTimeout(handle: unknown): void {
	host.clearTimeout(handle)
}

/**
 * Deep-clone a JSON-safe value via the host `structuredClone` (same
 * escape-hatch pattern as {@link scheduleMicrotask}). `structuredClone`
 * exists in every target host (browsers, Node ≥ 17, workers) but is not part
 * of the ES2022 lib, so it is resolved here rather than pulling in `DOM` or
 * `@types/node`.
 */
export function cloneValue<T>(value: T): T {
	return host.structuredClone(value)
}
