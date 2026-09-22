/**
 * `@palettable/core` — headless palette primitives (vanilla TS, zero DOM).
 *
 * Every symbol lives in its own module (see the re-exports below).
 * `index.ts` is the public barrel, so `import ... from '@palettable/core'`
 * keeps working unchanged, including `TypeMap`/`TypeConstraints` declaration
 * merging.
 *
 * Architectural rules:
 * - No `HTMLElement`, no framework components, no browser APIs (`KeyboardEvent`,
 *   `document`, …). Adapters (Svelte / Vue / vanilla-DOM) own all rendering and
 *   translate their events into the abstract strings/ids below.
 * - The core manages semantic metadata (points), runtime values (store) and
 *   pure-data layout (borders / tracks / toolbars / items). Drag math, hit
 *   testing and pointer coordinates live in adapters; adapters commit results
 *   through structural methods (`moveItem`, `moveToolbar`, …).
 * - Icons are opaque string tokens. Resolution to a component / glyph is an
 *   adapter concern.
 *
 * Vocabulary (kept across adapters):
 * - **point** = a data definition: either runnable (an action) or valued (a
 *   value with a restorable default). Points carry no layout.
 * - **virtual point** = an end-user-defined derived point over a source point:
 *   `enum-from` (present any value as an enum / enum subset) or `stash`
 *   (push-aside / pop-back toggle action).
 * - **tool** = a toolbar-bound control (`ToolbarItem`: a point spec + a
 *   control id + an opaque config payload). Buttons, toggles, selects,
 *   sliders, steppers are tools.
 * - **control** = the chosen front-end of a tool (`'button'`, `'toggle'`, …).
 *   The core only manipulates control ids and capability descriptors;
 *   adapters map ids to components.
 * - **configurator** = the configuration panel of a tool (label/icon/hint,
 *   control chooser, tone, delete). Rendered in the console *Details* panel,
 *   not on the toolbar.
 * - **nothing-point tools** = tools bound to nothing-points (`status`, `command-box`,
 *   `drawer`, `theme` — one tool, one nothing-point whose `uses` names its
 *   context). A drawer carries a nested `toolbar` (perpendicular to its
 *   parent — enforced by adapters, opaque to the core).
 */

export * from './command-box.js'
export * from './configuration.js'
export * from './console.js'
export * from './context.js'
export * from './context-display.js'
export * from './controls.js'
export * from './core.js'
export * from './drag.js'
export * from './errors.js'
export * from './globals.js'
export * from './identifiers.js'
export * from './keys.js'
export * from './layout.js'
export * from './palette.js'
export * from './points.js'
export * from './presenters.js'
export * from './render.js'
export * from './specs.js'
export * from './store.js'
export * from './type.js'
export * from './virtual.js'
