import type { Component } from 'svelte'

/**
 * Resolves a string icon name to a Svelte component.
 *
 * Optional — when unset, `Icon.svelte` falls back to a `<span data-icon>`.
 */
export type IconFactory = (name: string, size?: string | number) => Component | undefined

/**
 * Module-level icon factory — the Svelte equivalent of `@sursaut/ui`'s
 * `options.iconFactory`.
 *
 * Set it once at app startup to map string icon names to components:
 *
 * ```ts
 * import { icons } from '$lib/head/icons.svelte'
 * import Star from '$lib/icons/star.svelte'
 *
 * icons.factory = (name) => (name === 'star' ? Star : undefined)
 * ```
 */
export const icons = $state<{ factory?: IconFactory }>({})
