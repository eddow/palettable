/**
 * `@palettable/vanilla` — vanilla-DOM adapter over `@palettable/core`.
 *
 * Owns all DOM rendering for the headless core: mounts a `PaletteCore`
 * into an `HTMLElement`, subscribes to value + layout snapshots, and
 * re-renders plain DOM on change. Pointer math, drag sessions and head
 * components live here — never in core.
 */
export * from './adapter.js'
export * from './add-item.js'
export * from './drag-session.js'
export * from './head.js'
export * from './highlight.js'
export * from './ide.js'
export * from './keys.js'
export * from './nodes.js'
export * from './outside.js'
export * from './slide.js'
export * from './templates.js'
export * from './value-proxy.js'
