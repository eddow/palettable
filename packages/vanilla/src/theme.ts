/**
 * `@palettable/vanilla` — theme setting: readable + writable adapter state.
 *
 * Core owns the pure setting resolution (`resolveTheme`); this module owns
 * the adapter state: an observable `ThemeSetting` (light/dark/system) that
 * mirrors the document root. `createThemeSetting` seeds from `data-theme`
 * (default `system`), applies every change to the root via
 * `applyThemeSetting`, and follows external root writes through a
 * `MutationObserver` so the tool, a consumer toggle, and direct DOM edits
 * all stay in sync. The theme *tool* is opt-in (see `IdeOptions.theme`):
 * with no tool and no direct root write, nothing applies — the resolved
 * theme stays the stylesheet default (dark). `system` resolves via the OS
 * preference (`matchMedia`) for paint but is preserved as the stored
 * setting, so the cycle keeps working.
 */

import { resolveTheme, type ThemeValue } from '@palettable/core'

export type { ThemeValue }
export { resolveTheme }

/** Readable + writable theme setting (adapter state, mirrors the root). */
export type ThemeSetting = {
	/** Current setting (`system` default — nothing stored yet). */
	readonly value: ThemeValue
	/** Write through to the document root (`data-theme` + class + scheme). */
	set(next: ThemeValue | undefined): void
	/** Subscribe to setting changes (tool clicks, consumer writes, root edits). */
	subscribe(listener: (value: ThemeValue) => void): () => void
	/** Teardown: stop following external root writes, drop listeners. */
	dispose(): void
}

/** Read the current theme setting from a root element (`data-theme`, default `system`). */
export function readThemeSetting(root?: {
	readonly dataset?: { readonly theme?: string }
}): ThemeValue {
	const dataset =
		root?.dataset ??
		(typeof document !== 'undefined' ? document.documentElement.dataset : undefined)
	const raw = dataset?.theme
	return raw === 'light' || raw === 'dark' ? raw : 'system'
}

/**
 * Create the observable theme setting for an IDE instance. Seeds from the
 * given root (`document.documentElement` by default), applies every `set`
 * to that root, and follows external root writes (tool in another IDE,
 * consumer toggle, direct DOM edit). Pass an element in tests. Dispose
 * stops the observer. No tool = no automatic `system` write: the root
 * keeps whatever the consumer stored, so omitting the tool is observable
 * (nothing applies on its own).
 *
 * System-preference handling is explicit: `applyThemeSetting` (and
 * therefore `set`) samples `matchMedia('(prefers-color-scheme: light)')`
 * once per call. The adapter installs no `change` listener — an OS
 * preference flip while the palette is open does not re-paint on its
 * own; re-apply the current setting (call `set(setting.value)`) to
 * re-sample. `system` stays the stored setting either way, so the tool
 * cycle is unaffected.
 */
export function createThemeSetting(root?: HTMLElement): ThemeSetting {
	const target =
		root ?? (typeof document !== 'undefined' ? document.documentElement : ({} as HTMLElement))
	let current = readThemeSetting(target)
	const listeners = new Set<(value: ThemeValue) => void>()
	const emit = (next: ThemeValue): void => {
		if (next === current) return
		current = next
		for (const listener of [...listeners]) listener(next)
	}
	const observer =
		typeof MutationObserver !== 'undefined'
			? new MutationObserver(() => emit(readThemeSetting(target)))
			: undefined
	observer?.observe(target, { attributes: true, attributeFilter: ['data-theme'] })
	return {
		get value() {
			return current
		},
		set(next: ThemeValue | undefined) {
			const setting = next ?? 'system'
			applyThemeSetting(target, setting)
			emit(setting)
		},
		subscribe(listener: (value: ThemeValue) => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		dispose() {
			observer?.disconnect()
			listeners.clear()
		},
	}
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
 * + `colorScheme` (native form controls). Idempotent. `system` resolves via
 * the OS preference for paint but is preserved as the stored setting, so
 * the cycle (light → dark → system) keeps working.
 */
export function applyThemeSetting(
	root: HTMLElement,
	setting: ThemeValue | undefined,
	prefersLight: boolean = systemPrefersLight()
): 'light' | 'dark' {
	const resolved = resolveTheme(setting, prefersLight)
	root.classList.toggle('palette-default-theme-light', resolved === 'light')
	root.dataset.theme = setting ?? resolved
	root.style.colorScheme = resolved
	return resolved
}
