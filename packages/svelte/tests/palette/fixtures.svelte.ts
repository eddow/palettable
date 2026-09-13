/**
 * Reactive border fixtures for the palette tests.
 *
 * `palettes` is `$state`, so handing it a raw array wraps that array in a
 * `$state` proxy; every later identity check against the *raw* object then
 * fails (`origin.toolbar === toolbar` is false). Building the fixtures inside
 * `$state(...)` — the same way `hydratePaletteLayout` does — keeps the object
 * identities the drag engine relies on intact, and keeps the mutations
 * observable to the reactive graph so components re-render.
 */
import type {
	PaletteBorder,
	PaletteParking,
	PaletteToolbar,
	PaletteToolbarItem,
	PaletteTrack,
} from '$lib/palette/types'

/** A `$state` toolbar item (tools are compared by identity too). */
export function reactiveItem(tool: string): PaletteToolbarItem {
	const item = $state<PaletteToolbarItem>({ tool })
	return item
}

/**
 * A `$state` toolbar.
 *
 * The drag engine finds toolbars by identity (`entry.toolbar === toolbar`),
 * so a fixture must hand back the *same* reactive object it stores — a raw
 * array passed into a `$state` container gets proxied, and later identity
 * checks against the raw object silently fail.
 */
export function reactiveToolbar(...items: PaletteToolbarItem[]): PaletteToolbar {
	const toolbar = $state<PaletteToolbar>(items)
	return toolbar
}

/** A `$state` track holding the given toolbars, first gap flush to the start. */
export function reactiveTrack(...toolbars: PaletteToolbar[]): PaletteTrack {
	const track = $state<PaletteTrack>(
		toolbars.map((toolbar, index) => ({
			space: index === 0 ? 0 : 0.2,
			toolbar,
		}))
	)
	return track
}

/** A `$state` border holding the given tracks. */
export function reactiveBorder(...tracks: PaletteTrack[]): PaletteBorder {
	const border = $state<PaletteBorder>(tracks)
	return border
}

/** A `$state` parking stack holding the given toolbars. */
export function reactiveParking(...toolbars: PaletteToolbar[]): PaletteParking {
	const parking = $state<PaletteParking>(toolbars)
	return parking
}
