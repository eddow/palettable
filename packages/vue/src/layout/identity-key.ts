/**
 * `@palettable/vue` — identity-stable keys for live layout objects.
 *
 * The live layout is stable by object identity (`===` survives across
 * renders); structural commits mutate arrays in place or splice fresh
 * toolbars in. Positional `v-for` keys (`item-0`, `track-0`) reuse DOM
 * nodes for different objects after a commit, and content fingerprints
 * (`point+control+config`) collide on duplicate tools (the demo repeats
 * `colonyTheme` / `gameSpeed` / `moreDrawer` in one toolbar).
 *
 * This module assigns one incrementing id per live object (WeakMap, so
 * pruned toolbars/tracks/items release) — stable across renders, unique
 * across duplicates. Adapters key `v-for` nodes by it, mirroring the
 * vanilla `NodeRegistry` identity without a DOM map.
 */

import type { Toolbar, ToolbarItem, Track } from '@palettable/core'

let nextId = 1
const ids = new WeakMap<object, number>()

function idOf(value: object): number {
	if (typeof value !== 'object' || value === null) {
		throw new TypeError('identity-key: expected a live layout object')
	}
	let id = ids.get(value)
	if (id === undefined) {
		id = nextId
		nextId += 1
		ids.set(value, id)
	}
	return id
}

/** Stable key for a live `ToolbarItem` (unique even for duplicate points). */
export function itemKeyOf(item: ToolbarItem): string {
	return `item-${idOf(item as object)}`
}

/** Stable key for a live `Toolbar` array. */
export function toolbarKeyOf(toolbar: Toolbar): string {
	return `bar-${idOf(toolbar as object)}`
}

/** Stable key for a live `Track` array. Tolerates the transient
 * `undefined` Vue evaluates on the trailing stack-gap iteration
 * (`position - 1 === border.length`, guarded by `v-if` but still
 * key-evaluated) — falls back to a positional key instead of throwing
 * on the `WeakMap` (`Invalid value used as weak map key`). */
export function trackKeyOf(track: Track | undefined | null, fallback?: number): string {
	if (typeof track !== 'object' || track === null) {
		return `track-pos-${fallback ?? 'missing'}`
	}
	return `track-${idOf(track)}`
}
