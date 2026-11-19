/**
 * `@palettable/vue` — localizable IDE chrome strings (intl seam).
 *
 * Same contract as the vanilla adapter's `strings.ts`: core owns the
 * single implementation (`defaultIdeStrings` / `resolveIdeStrings` in
 * `@palettable/core`); this module re-exports it under the documented
 * Vue names so existing imports keep working. Components never fall
 * back to hard-coded English — they read the resolved table.
 *
 * Point `label` / `hint` / option text resolve per render: item-config
 * field → locale-bundle dictionary → definition field → `humanize(id)`.
 * Catalog sentence templates live in core (`CatalogStrings`). This table
 * covers adapter chrome only: placeholders, empty states, console titles,
 * configurator row keys, control names.
 */
import {
	defaultIdeStrings,
	type IdeLocaleBundle,
	type IdeStrings,
	resolveIdeStrings,
} from '@palettable/core'

/** Per-locale bundle: chrome + catalog tables plus the point dictionaries. */
export type VueLocaleBundle = IdeLocaleBundle

export type { IdeLocaleBundle, IdeStrings }
export { defaultIdeStrings, resolveIdeStrings }
