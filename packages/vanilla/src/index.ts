/**
 * `@palettable/vanilla` — vanilla-DOM adapter over `@palettable/core`.
 *
 * Owns all DOM rendering for the headless core: mounts a `PaletteCore`
 * into an `HTMLElement`, subscribes to value + layout snapshots, and
 * re-renders plain DOM on change. Pointer math, drag sessions and head
 * components live here — never in core.
 */
export * from './adapter.js'
export * from './head.js'
export * from './ide.js'
export * from './keys.js'
