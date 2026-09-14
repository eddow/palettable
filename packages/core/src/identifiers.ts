/**
 * `@palettable/core` — abstract identifiers shared by every module.
 *
 * Icons are opaque string tokens, keystrokes normalized `"Ctrl+Shift+S"`
 * strings: adapters translate components / `KeyboardEvent`s into these.
 * Zero DOM, zero framework bindings.
 */

/** Icon reference. Always a string token; adapters resolve it to a glyph/component. */
export type IconToken = string

/** Keystroke in normalized `"Ctrl+Shift+S"` form. Adapters normalize `KeyboardEvent`s. */
export type Keystroke = string

/** Unsubscribe function returned by every `subscribe`. */
export type Unsubscribe = () => void

/** Listener invoked on every value change. */
export type GlobalValueListener = (id: string, value: unknown) => void

/** Listener invoked when one specific point id changes. */
export type KeyValueListener<V = unknown> = (value: V) => void
