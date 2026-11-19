/**
 * `@palettable/vue` — IDE options + shared layout helpers.
 *
 * Vue-idiom mirror of the vanilla `IdeOptions`: the `PaletteIde` component
 * takes these as props. `useIdeStrings` resolves the locale bundle per
 * render (locale bundle wins over static `strings`); `useIdeDisplay`
 * resolves the render-time display dictionaries. Both read the live locale
 * value from `core.values` so locale switches re-render reactively.
 */

import {
	bundleCatalogStrings,
	type ConsoleStore,
	type DisplayStrings,
	type PaletteCore,
} from '@palettable/core'
import { type ComputedRef, computed, onBeforeUnmount, ref } from 'vue'
import type { IconResolver } from './head.js'
import { type IdeStrings, resolveIdeStrings, type VueLocaleBundle } from './strings.js'
import { createThemeSetting, type ThemeSetting } from './theme.js'

export { createThemeSetting } from './theme.js'
export type { ThemeSetting }

export type IdeOptions = {
	readonly core: PaletteCore
	readonly consoleStore: ConsoleStore
	readonly isEditable: () => boolean
	/**
	 * Opt-in theme tool: pass `true` (or a `ThemeSetting` from
	 * `createThemeSetting`) to offer the `theme` control. Default
	 * `false` — no tool, no catalog/add rows, no document-root write.
	 * `true` creates one mirror for the component lifetime; pass a shared
	 * setting to sync several trees (or a consumer toggle / custom head).
	 */
	readonly theme?: boolean | ThemeSetting
	/** Control-only item ids for the console add-box (`controls.item` keys). */
	readonly itemControls?: readonly string[]
	readonly paletteId?: string
	/** Localizable chrome strings (partial — merged over the English default).
	 * Static table; `stringsForLocale` (below) wins when both are given. */
	readonly strings?: Partial<IdeStrings>
	/** Static display dictionaries (locale bundle wins when both are given).
	 * Every field is optional — absent dictionary falls back to the
	 * item-config field, then the definition field, then `humanize(id)`. */
	readonly display?: DisplayStrings
	/** Live locale resolver: called per render with the current locale value
	 * (read from `localePointId` below, default `'locale'`). Return a bundle
	 * for that locale; absent/unknown locale = English default. */
	readonly stringsForLocale?: (locale: string | undefined) => VueLocaleBundle | undefined
	/** Valued point id holding the live locale (default `'locale'`; absent = static). */
	readonly localePointId?: string
	/** Optional string-glyph icon resolver (consumer-owned, e.g. the demo
	 * maps `icon:moon` via a hard-coded dictionary). Threaded into every
	 * `HeadContext`; absent = identity (emoji passthrough). */
	readonly iconResolver?: IconResolver
	/** Predefined icon choices offered by the configurator Icon row
	 * (combo suggestions — free text always stays allowed). */
	readonly iconChoices?: readonly string[]
}

/** Live locale value (`undefined` = static/English default). */
export function currentLocaleOf(core: PaletteCore, localePointId: string): string | undefined {
	try {
		const value = core.values.get(localePointId)
		return typeof value === 'string' ? value : undefined
	} catch {
		return undefined
	}
}

/** Resolved chrome strings (locale bundle wins over static). */
export function useIdeStrings(options: IdeOptions): ComputedRef<IdeStrings> {
	return computed(() => {
		const localePointId = options.localePointId ?? 'locale'
		const locale = currentLocaleOf(options.core, localePointId)
		const bundle = locale !== undefined ? options.stringsForLocale?.(locale) : undefined
		const fromLocale = bundle?.ide
		if (fromLocale !== undefined) return resolveIdeStrings(fromLocale)
		return resolveIdeStrings(options.strings)
	})
}

/** Render-time display dictionaries (locale bundle wins over static). */
export function useIdeDisplay(options: IdeOptions): ComputedRef<DisplayStrings> {
	return computed(() => {
		const localePointId = options.localePointId ?? 'locale'
		const locale = currentLocaleOf(options.core, localePointId)
		const bundle = locale !== undefined ? options.stringsForLocale?.(locale) : undefined
		const pointLabels = bundle?.pointLabels ?? options.display?.pointLabels
		const pointHints = bundle?.pointHints ?? options.display?.pointHints
		const optionLabels = bundle?.optionLabels ?? options.display?.optionLabels
		if (pointLabels === undefined && pointHints === undefined && optionLabels === undefined)
			return {}
		return { pointLabels, pointHints, optionLabels }
	})
}

/** Push the locale bundle's catalog table into the core (console rows follow the locale). */
export function syncIdeCatalogStrings(options: IdeOptions): void {
	if (options.stringsForLocale === undefined) return
	const localePointId = options.localePointId ?? 'locale'
	const locale = currentLocaleOf(options.core, localePointId)
	const bundle = locale !== undefined ? options.stringsForLocale?.(locale) : undefined
	options.core.setStrings(bundleCatalogStrings(bundle))
}

/**
 * Observable theme setting for the tree (`IdeOptions.theme`). `true`
 * creates one mirror for the component lifetime; a passed setting is
 * shared as-is (several trees / consumer toggle / custom head).
 * `enabled` gates the `theme` control everywhere: toolbar dispatch,
 * console add-box, configurator choices.
 */
export function useIdeTheme(options: IdeOptions): {
	setting: ComputedRef<ThemeSetting | undefined>
	enabled: ComputedRef<boolean>
} {
	const owned = ref<ThemeSetting | undefined>(undefined)
	const setting = computed<ThemeSetting | undefined>(() => {
		if (options.theme === true) {
			if (owned.value === undefined) owned.value = createThemeSetting()
			return owned.value
		}
		if (options.theme === false || options.theme === undefined) {
			owned.value?.dispose()
			owned.value = undefined
			return undefined
		}
		owned.value?.dispose()
		owned.value = undefined
		return options.theme
	})
	const enabled = computed(() => setting.value !== undefined)
	onBeforeUnmount(() => owned.value?.dispose())
	return { setting, enabled }
}
