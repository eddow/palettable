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
