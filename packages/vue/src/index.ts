/**
 * `@palettable/vue` — Vue adapter over `@palettable/core`.
 *
 * Owns all Vue rendering for the headless core: mounts a `PaletteCore`
 * into a component tree, subscribes to value + layout snapshots, and
 * re-renders Vue components on change. Pointer math, drag sessions and head
 * components live here — never in core.
 */
export * from './add-item.js'
export * from './drag-session.js'
export * from './head.js'
export * from './highlight.js'
export * from './ide.js'
export * from './keys.js'
export * from './outside.js'
export * from './slide.js'
export * from './strings.js'
export * from './theme.js'
export * from './value-lens.js'
