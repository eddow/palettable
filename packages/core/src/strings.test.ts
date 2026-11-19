/**
 * `@palettable/core` — strings resolution (intl seam).
 *
 * Nested dictionaries merge per key (single-entry overrides keep the
 * rest); keyword arrays replace wholesale; `bundleCatalogStrings` prefers
 * top-level dictionaries with `catalog.*` as a legacy alias.
 */
import { describe, expect, it } from 'vitest'
import { defaultIdeStrings, resolveIdeStrings } from './ide-strings.js'
import { bundleCatalogStrings, defaultCatalogStrings, resolveCatalogStrings } from './strings.js'

describe('resolveCatalogStrings', () => {
	it('merges pointLabels per key (no full-map repeat needed)', () => {
		const resolved = resolveCatalogStrings({ pointLabels: { lamp: 'Lampe' } })
		expect(resolved.pointLabels).toMatchObject({ lamp: 'Lampe' })
		expect(resolved.toggle('Lamp')).toBe('Toggle Lamp')
	})

	it('merges optionLabels per point + per option', () => {
		const resolved = resolveCatalogStrings({
			optionLabels: { theme: { dark: 'Sombre' } },
		})
		expect(resolved.optionLabels?.['theme']).toMatchObject({ dark: 'Sombre' })
	})

	it('replaces keyword arrays wholesale (no English leak)', () => {
		const resolved = resolveCatalogStrings({ toggleKeywords: ['basculer'] })
		expect(resolved.toggleKeywords).toEqual(['basculer'])
	})
})

describe('bundleCatalogStrings', () => {
	it('prefers top-level dictionaries over the catalog alias', () => {
		const bundle = bundleCatalogStrings({
			catalog: { pointLabels: { lamp: 'Alias' } },
			pointLabels: { lamp: 'Top' },
		})
		expect(bundle?.pointLabels).toEqual({ lamp: 'Top' })
	})

	it('reads the catalog alias when top-level is absent', () => {
		const bundle = bundleCatalogStrings({
			catalog: { pointLabels: { lamp: 'Alias' } },
		})
		expect(bundle?.pointLabels).toEqual({ lamp: 'Alias' })
	})

	it('returns undefined for an empty bundle', () => {
		expect(bundleCatalogStrings(undefined)).toBeUndefined()
		expect(bundleCatalogStrings({})).toBeUndefined()
	})

	it('keeps the English default object untouched', () => {
		resolveCatalogStrings({ pointLabels: { lamp: 'Lampe' } })
		expect(defaultCatalogStrings.pointLabels).toBeUndefined()
	})
})

describe('resolveIdeStrings (single adapter-shared copy)', () => {
	it('merges controlNames per control id', () => {
		const resolved = resolveIdeStrings({ controlNames: { toggle: 'Bascule' } })
		expect(resolved.controlNames).toMatchObject({ toggle: 'Bascule', select: 'Select' })
		expect(defaultIdeStrings.commandPlaceholder).toBe('Command…')
	})
})
