/**
 * Runtime configuration for the palette library.
 *
 * Single place for every magic number the drag/drop and layout code depends
 * on — timeouts, split ratios, layout floors. Import and mutate to tune:
 *
 * ```ts
 * import { configuration } from '$lib/palette/edition.svelte'
 * configuration.stackDzHoverMs = 2000
 * ```
 *
 * All readers look the value up live at use time (timeout arming, gap
 * insertion, render), so changes apply to subsequent interactions without
 * rebuilding. Plain (non-reactive) object on purpose: it lives in a plain
 * `.ts` module and must stay importable from non-component code and tests.
 */
export const configuration = {
	/**
	 * Hover dwell before a directly-hovered stack DZ promotes to a track.
	 * Armed by `ToolbarBorder` on direct DZ hover (`hoveredStack`); cancelled
	 * on stack change, border leave, or drag end.
	 */
	stackDzHoverMs: 500,

	/**
	 * Hover delay before an open-on-hover drawer popup closes once the
	 * pointer leaves the trigger/popup pair (`DrawerEditor`).
	 */
	drawerHoverCloseMs: 120,

	/**
	 * Share of a track gap given to the leading side when a toolbar is
	 * inserted into it (`insertToolbar` / track-gap commits).
	 * `0.5` = even split.
	 */
	trackGapSplit: 0.5,

	/**
	 * Minimum `flex-grow` for a track gap element. Gaps are zero-size by
	 * design (`actualTrackSpaceAt` can legitimately return `0`), but a hard
	 * `0` grow collapses the element out of hit-testing in some layouts —
	 * this floor keeps every gap hoverable (`ToolbarTrack`).
	 */
	trackGapMinGrow: 0.0001,
}

/** Shape of {@link configuration} (inferred, exported for consumers). */
export type PaletteConfiguration = typeof configuration
