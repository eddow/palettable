/**
 * `@palettable/vanilla` — theme application (document-root class toggle).
 *
 * The `theme` tool is pointless (binds no layout of its own): it writes a
 * system value — the resolved theme — directly onto the document root, the
 * standard `<html>` class toggle. `head-light.css` keys off
 * `.palette-default-theme-light`, so body-portaled drawer popups (outside
 * the IDE subtree) follow the same switch.
 */

import type { ThemeValue } from '@palettable/core'

/** Resolve a theme setting to what renders (`system` follows the OS). */
export function resolveTheme(
	setting: ThemeValue | undefined,
	prefersLight: boolean
): 'light' | 'dark' {
	if (setting === 'light') return 'light'
	if (setting === 'dark') return 'dark'
	return prefersLight ? 'light' : 'dark'
}

/** Read the OS preference (safe default `false` when `matchMedia` is absent). */
export function systemPrefersLight(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-color-scheme: light)').matches
	)
}

/**
 * Apply a theme setting to the document root: class toggle + `data-theme`
 * + `colorScheme` (native form controls). Idempotent.
 */
export function applyThemeSetting(
	root: HTMLElement,
	setting: ThemeValue | undefined,
	prefersLight: boolean = systemPrefersLight()
): 'light' | 'dark' {
	const resolved = resolveTheme(setting, prefersLight)
	root.classList.toggle('palette-default-theme-light', resolved === 'light')
	root.dataset.theme = resolved
	root.style.colorScheme = resolved
	return resolved
}
