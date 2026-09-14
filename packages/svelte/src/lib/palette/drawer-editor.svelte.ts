/**
 * Headless drawer editor factory for palettable.
 *
 * Ported from `@sursaut/ui/palette` (`ui/src/palette/drawer-editor.tsx`), with the
 * Sursaut-specific runtime replaced by Svelte 5 equivalents:
 *
 * - `mutts.reactive({ version: 0 })` → `$state({ version: 0 })` (this file is
 *   `.svelte.ts` so runes compile)
 * - `mutts.reactive(ui)` + `effect` portal via `latch(host, jsx, env)` → local
 *   `$state` open flag + `$effect` portal via `mount(DrawerPopup, { target })`
 *   from `svelte` (see `components/DrawerEditor.svelte`); cleanup (`unmount` +
 *   `host.remove()` + listener removal) runs in the effect teardown, so collapse
 *   always disposes the portal
 * - `rootEnv` scope propagation → explicit `scope` prop (`palette` + child
 *   `region`) passed to the mounted popup, which binds it to the child `Toolbar`
 * - `JSX.Element` icon renderer / `renderTrigger` / per-instance CSS classes →
 *   dropped. Icons are `PaletteIcon` (`string | Component`, rendered by the
 *   trigger itself); styling is global (`palettable-drawer__*` classes in
 *   `styles/palette.css`, themed in the head's `head-default.css`) per the repo rule
 *   that CSS is always global — per-instance `triggerClass` / `overlayClass` /
 *   `popupClass` options have no Svelte equivalent and are intentionally omitted
 *
 * Perpendicular-direction contract (preserved verbatim): the child popup toolbar
 * direction inverts the parent axis (`horizontal` → `vertical`, `vertical` →
 * `horizontal`); the child `region` follows (`vertical` → `'left'`,
 * `horizontal` → `'top'`) so nested drawers continue the pattern at each depth.
 *
 * Open modes (`click` | `hover` | `press`) and `placement` (`start` | `center` |
 * `end`) come from the drawer item `config` (see `PaletteDrawerToolbarItem`).
 */

import DrawerEditor from './components/DrawerEditor.svelte'
import type { PaletteEditorSpec, PaletteItem, PaletteSchema } from './types'

/**
 * Shared collapse signal: bump `version` to close all open drawer popups.
 *
 * Drawers subscribe via `$effect` and close on change. Module-level `$state`
 * (same pattern as `palettes`), so any importer reacts to bumps.
 *
 * Lives here alongside the factory (the old `drawer-state.svelte.ts` split
 * is merged): the component imports the signal from here, and this module
 * imports the component — a component↔module cycle Svelte tolerates because
 * the component only reads the signal at effect-run time, never at
 * module-eval time.
 */
export const paletteDrawerCollapse = $state({ version: 0 })

let defaultDrawerPortalContainer: HTMLElement | undefined

/**
 * Resolve the portal container for drawer popups.
 */
export function getDrawerPortalContainer(): HTMLElement | undefined {
	return defaultDrawerPortalContainer
}

/**
 * Set the portal container for drawer popups (defaults to `document.body`).
 */
export function setDrawerPortalContainer(container: HTMLElement | undefined): void {
	defaultDrawerPortalContainer = container
}

/**
 * Options for {@link createPaletteDrawerEditor}.
 *
 * Only the portal target is configurable: styling is global by repo convention,
 * and trigger content (icon + label + chevron) is fixed. `open` / `placement`
 * are per-item `config` values, not factory options.
 */
export interface PaletteDrawerEditorOptions {
	/**
	 * Target element for the popup portal. Defaults to `document.body`.
	 *
	 * Applies to every drawer created by the returned spec (module-level
	 * default — set once per app; last call wins).
	 */
	portalContainer?: HTMLElement
}

/**
 * Create a drawer editor spec for the `"drawer"` editor variant.
 *
 * The returned spec's `editor` is the shared `DrawerEditor` component; `open` /
 * `placement` are read from each item's `config` at render time.
 */
export function createPaletteDrawerEditor<
	TSchema extends PaletteSchema = PaletteSchema,
	TItem extends PaletteItem<TSchema> = PaletteItem<TSchema>,
>(options: PaletteDrawerEditorOptions = {}): PaletteEditorSpec<undefined, TItem, TSchema> {
	if (options.portalContainer) setDrawerPortalContainer(options.portalContainer)
	return {
		editor: DrawerEditor as unknown as PaletteEditorSpec<undefined, TItem, TSchema>['editor'],
		flags: { footprint: 'horizontal' },
	}
}

/**
 * Default drawer editor spec (no consumer-specific customization).
 */
export const paletteDefaultDrawerEditor: PaletteEditorSpec<undefined> = createPaletteDrawerEditor()
