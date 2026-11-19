/**
 * `@palettable/vue` — build a `ToolbarItem` from a console add-flow
 * selection (entry + variant).
 *
 * Re-exports the single core implementation (`itemFromAddSelection` from
 * `@palettable/core`, pure over point definitions — no components) so the
 * documented adapter import keeps working. The conversion itself is owned
 * and tested in core; this module carries no logic.
 */

export { type AddSelection, itemFromAddSelection } from '@palettable/core'

