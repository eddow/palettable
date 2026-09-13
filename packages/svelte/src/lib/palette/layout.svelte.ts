/**
 * Headless palette layout engine: track spacing, toolbar insert/remove, and
 * Svelte actions for the layout components.
 *
 * Movement (drag & drop, hit-testing, preview) was stripped for a restart
 * from scratch. This module keeps only the pure layout primitives plus
 * passive action stubs (space/drag actions register nothing; `paletteItemDrag`
 * only inspects on pointerdown). The next movement design will be built on
 * top of these primitives.
 */

import type { Action } from 'svelte/action'
import { configuration } from './configuration'
import { startPaletteDragSession } from './drag-session'
import { isEditableTool, isRunTool, PaletteError, palettes } from './palette.svelte'
import type {
	Palette,
	PaletteBorder,
	PaletteBorderLocation,
	PaletteBorders,
	PaletteDragging,
	PaletteDragMode,
	PaletteDragOrigin,
	PaletteParking,
	PaletteParkingLocation,
	PaletteRegion,
	PaletteToolbar,
	PaletteToolbarItem,
	PaletteTrack,
} from './types'

/** Orientation of a toolbar's item axis. */
export type PaletteOrientation = 'horizontal' | 'vertical'

export type PaletteItemDragTarget = {
	kind: 'border'
	border: PaletteBorder
	direction: PaletteOrientation
	item: PaletteToolbarItem
	palette: Palette
	region: PaletteRegion
	toolbar: PaletteToolbar
	track: PaletteTrack
	trackIndex: number
}

export type PaletteParkingItemDragTarget = {
	kind: 'parking'
	direction: PaletteOrientation
	item: PaletteToolbarItem
	palette: Palette
	toolbar: PaletteToolbar
	parking: PaletteParking
	index: number
}

export type PaletteToolbarDrag = {
	kind: 'border'
	border: PaletteBorder
	direction: PaletteOrientation
	palette: Palette
	region: PaletteRegion
	toolbar: PaletteToolbar
	track: PaletteTrack
	trackIndex: number
}

export type PaletteParkingToolbarDrag = {
	kind: 'parking'
	direction: PaletteOrientation
	palette: Palette
	toolbar: PaletteToolbar
	parking: PaletteParking
	index: number
}

export function clampUnit(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	)
		return true
	return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function regionDirection(region: PaletteRegion): PaletteOrientation {
	return region === 'left' || region === 'right' ? 'vertical' : 'horizontal'
}

export function actualTrackSpaceAt(track: PaletteTrack, index: number): number {
	return index < track.length
		? clampUnit(track[index].space)
		: index === track.length
			? clampUnit(track.reduce((remaining, slot) => remaining - slot.space, 1))
			: 0
}

function actualTrackSpaces(track: PaletteTrack): number[] {
	const spaces = track.map((slot) => clampUnit(slot.space))
	const trailing = clampUnit(1 - spaces.reduce((sum, space) => sum + space, 0))
	return [...spaces, trailing]
}

function applyTrackSpaces(track: PaletteTrack, spaces: readonly number[]): void {
	for (let index = 0; index < track.length; index += 1)
		track[index].space = clampUnit(spaces[index] ?? 0)
}

/**
 * Removes a toolbar from a track and merges its surrounding spacing into a single gap.
 *
 * @returns The removed toolbar slot index, or `-1` when the toolbar is not in the track.
 */
export function removeToolbar(track: PaletteTrack, toolbar: PaletteToolbar): number {
	const index = track.findIndex((slot) => slot.toolbar === toolbar)
	if (index < 0) return -1
	const spaces = actualTrackSpaces(track)
	const merged = (spaces[index] ?? 0) + (spaces[index + 1] ?? 0)
	spaces.splice(index, 2, merged)
	track.splice(index, 1)
	applyTrackSpaces(track, spaces)
	return index
}

/**
 * Removes a track from a border when it no longer contains any toolbars.
 */
export function removeEmptyTrack(border: PaletteBorder, track: PaletteTrack): void {
	if (track.length > 0) return
	const trackIndex = border.indexOf(track)
	if (trackIndex < 0) return
	border.splice(trackIndex, 1)
}

/**
 * Removes a toolbar from the parking stack by identity.
 *
 * Parking rows have no spacing to merge — the stack is a plain list.
 *
 * @returns The removed index, or `-1` when the toolbar is not parked.
 */
export function removeParkedToolbar(parking: PaletteParking, toolbar: PaletteToolbar): number {
	const index = parking.indexOf(toolbar)
	if (index < 0) return -1
	parking.splice(index, 1)
	return index
}

/**
 * Canonical tool id for a toolbar item: strips setter (`=`/`|`) and action
 * (`:`) suffixes so `alertLevel`, `alertLevel=red`, and `alertLevel|red`
 * fingerprint as the same tool. Editor-only items fingerprint on `editor`.
 */
export function canonicalItemTool(item: PaletteToolbarItem): string {
	const spec = (item as { tool?: unknown }).tool
	if (typeof spec !== 'string') return ''
	const setter = spec.search(/[=|]/)
	const colon = spec.indexOf(':')
	const cut =
		setter >= 0 && (colon < 0 || setter < colon) ? setter : colon >= 0 ? colon : spec.length
	return spec.slice(0, cut)
}

/**
 * Stable structural fingerprint of an instantiated tool: canonical tool (or
 * editor-only editor) + editor variant + stable-stringified config.
 * Position is NOT part of the fingerprint — it is the container that makes
 * two identical fingerprints two distinct instances.
 */
export function itemFingerprint(item: PaletteToolbarItem): string {
	const tool = canonicalItemTool(item)
	const editor = (item as { editor?: unknown }).editor
	const config = (item as { config?: unknown }).config
	return JSON.stringify([tool, typeof editor === 'string' ? editor : null, stableStringify(config)])
}

function stableStringify(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableStringify)
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>
		const sorted: Record<string, unknown> = {}
		for (const key of Object.keys(record).sort()) sorted[key] = stableStringify(record[key])
		return sorted
	}
	return value ?? null
}

/**
 * Single-ownership invariant: every toolbar/item object lives in exactly one
 * container. Scans borders + parking for shared `===` references (the same
 * object rendered twice, e.g. parking mirroring a live border) and for
 * structural duplicates (same fingerprint in two places).
 *
 * @returns Human-readable violations (empty = invariant holds).
 */
export function findOwnershipViolations(options: {
	borders: PaletteBorders
	parking?: PaletteParking
}): string[] {
	const { borders, parking } = options
	const violations: string[] = []
	const toolbarOwners = new Map<PaletteToolbar, string>()
	const itemOwners = new Map<PaletteToolbarItem, string>()
	const fingerprints = new Map<string, string>()
	function claimToolbar(toolbar: PaletteToolbar, where: string): void {
		const owner = toolbarOwners.get(toolbar)
		if (owner !== undefined) violations.push(`toolbar shared by ${owner} and ${where}`)
		else toolbarOwners.set(toolbar, where)
	}
	function claimItem(item: PaletteToolbarItem, where: string): void {
		const owner = itemOwners.get(item)
		if (owner !== undefined) violations.push(`item shared by ${owner} and ${where}`)
		else itemOwners.set(item, where)
		const fingerprint = itemFingerprint(item)
		const first = fingerprints.get(fingerprint)
		if (first !== undefined)
			violations.push(`duplicate item ${fingerprint} in ${first} and ${where}`)
		else fingerprints.set(fingerprint, where)
	}
	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	for (const region of regions) {
		const border = borders[region] ?? []
		border.forEach((track, trackIndex) => {
			track.forEach((slot, slotIndex) => {
				const where = `${region}[${trackIndex}][${slotIndex}]`
				claimToolbar(slot.toolbar, where)
				slot.toolbar.forEach((item, itemIndex) => claimItem(item, `${where}#${itemIndex}`))
			})
		})
	}
	parking?.forEach((toolbar, index) => {
		const where = `parking[${index}]`
		claimToolbar(toolbar, where)
		toolbar.forEach((item, itemIndex) => claimItem(item, `${where}#${itemIndex}`))
	})
	return violations
}

/**
 * Headless item removal (G2, D2 item-level / D3 lives in layout).
 *
 * Removes `item` from `toolbar` by identity, then prunes the emptied toolbar
 * (and its track, when that empties too) via `removeToolbar`/`removeEmptyTrack`.
 * This is the single mutation behind both deletion paths: the editor edit
 * surface's delete button and parking's `×` button.
 *
 * @returns `true` when the item was present and removed.
 */
export function removePaletteItem(
	item: PaletteToolbarItem,
	toolbar: PaletteToolbar,
	track: PaletteTrack,
	border: PaletteBorder
): boolean {
	const index = toolbar.indexOf(item)
	if (index < 0) return false
	toolbar.splice(index, 1)
	if (toolbar.length === 0) {
		removeToolbar(track, toolbar)
		removeEmptyTrack(border, track)
	}
	return true
}

/**
 * Commit the dragged tools into a target toolbar at a specific item-space index.
 *
 * Works for either origin container (border or parking): the tools leave the
 * origin via `pruneDragOrigin` (border toolbar/track pruned when emptied,
 * parking row pruned when emptied) and land in the target border toolbar.
 * The session origin follows them, so a parking drag becomes a border drag
 * after landing.
 *
 * When the origin and target are the same toolbar, the removal happens first
 * (so indices shift), then the insertion uses the adjusted index.
 *
 * @returns `true` when the commit succeeded (dragging is active and the target
 *   toolbar is valid).
 */
export function commitDraggedToItemSpace(
	targetToolbar: PaletteToolbar,
	targetTrack: PaletteTrack,
	targetBorder: PaletteBorder,
	itemSpaceIndex: number
): boolean {
	const dragging = palettes.dragging
	if (!dragging) return false
	const { tools, origin } = dragging
	if (tools.length === 0) return false

	// Remove every dragged tool from the origin toolbar (either container).
	pruneDragOrigin(origin, tools)

	// Compute the insertion index. When origin and target are the same
	// toolbar, the removal above already shifted indices — the item-space
	// index is still correct because item-space indices are between items,
	// and we removed the dragged items from the toolbar. But we need to
	// account for the fact that the dragged items are no longer there.
	// The item-space index is a position between remaining items, so it's
	// already correct after removal.
	const clampedIndex = Math.min(Math.max(itemSpaceIndex, 0), targetToolbar.length)
	targetToolbar.splice(clampedIndex, 0, ...tools)

	// Refresh the origin so subsequent DZ hovers move from the new location.
	// Merging into another toolbar ends toolbar sliding: the selection is now a
	// subset of a toolbar again ("yes, something else is in my toolbar"), so
	// the toolbar is no longer what is being moved. Recompute the mode and
	// actively disarm slide-follow — the track's arming `$effect` no longer
	// matches a `'slide'` mode, so it will not re-arm it.
	return finishCommit(dragging, {
		kind: 'border',
		toolbar: targetToolbar,
		track: targetTrack,
		border: targetBorder,
	})
}

/**
 * Commit the dragged tools into a track gap, entering (or continuing)
 * toolbar sliding.
 *
 * Works for either origin container (border or parking): the behaviour is
 * decided by the session's *derived* mode, never by re-deriving the
 * selection kind from the tool lists per hover:
 *
 * - `'restructure'`: the dragged tools are a subset, so they are extracted
 *   from `origin.toolbar` into a fresh singleton toolbar placed at the gap
 *   (splitting it 50/50) and the origin is pruned when emptied (via
 *   `pruneDragOrigin`, so a parking row prunes like a border toolbar).
 * - `'slide'`: `origin.toolbar` itself is relocated at the gap. Identity is
 *   preserved — the same toolbar object moves, it is never cloned and its
 *   tools are never re-extracted. This is what makes a repeated commit at the
 *   same gap a no-op. A parked row slides out of its stack into the track.
 *
 * `dragging.origin` is refreshed to `{ kind: 'border', … }` in both cases so
 * the next hover moves from the new location, `trackSpaceIndex` is adjusted
 * for the index shift caused by pruning the origin from a shared track, and
 * the mode is recomputed once the placement lands (a restructure becomes a
 * slide: its tools now sit alone in their own toolbar).
 *
 * @returns `true` when a toolbar was (re)placed at the gap.
 */
export function commitDraggedToTrackSpace(
	targetTrack: PaletteTrack,
	targetBorder: PaletteBorder,
	trackSpaceIndex: number
): boolean {
	const dragging = palettes.dragging
	if (!dragging) return false
	const { tools, origin } = dragging
	if (tools.length === 0) return false

	const originToolbar = origin.toolbar
	// Only a border origin can share the target track (parking has no tracks).
	const originTrack = origin.kind === 'border' ? origin.track : undefined

	// Read the mode *before* mutating: it describes the current selection.
	// `'slide'` = the toolbar itself is what is being moved; `'restructure'` =
	// the dragged tools are a subset to extract.
	const mode = resolveDragMode(dragging)

	// While *sliding* a whole toolbar, the two gaps flanking it are not
	// destinations — they are just that toolbar's own left/right spacing, so
	// hovering them is "keep moving", not "drop here". Nothing to do (and
	// nothing to even record: the caller keeps its hover memo).
	//
	// A restructure is different: extracting a tool out of a toolbar and
	// dropping it into the gap right beside that toolbar is a perfectly good
	// move, and must create the singleton there.
	//
	// A parking origin never shares the target track, so this guard only
	// applies to border origins.
	if (mode === 'slide' && originTrack !== undefined && targetTrack === originTrack) {
		const originSlot = originTrack.findIndex((entry) => entry.toolbar === originToolbar)
		if (originSlot >= 0) {
			if (trackSpaceIndex === originSlot || trackSpaceIndex === originSlot + 1) return false
		}
	}

	let destination: PaletteToolbar
	// Slot the origin toolbar vacated, or `-1` when it is still there. Only a
	// real removal shifts the gap indices of a shared track.
	// Slide: relocate the toolbar object itself at the gap — identity
	// preserved, never cloned, so a commit at the same gap is idempotent.
	// A parked row slides out of its stack; a border toolbar out of its track.
	// Restructure: extract the dragged tools out of the origin toolbar into a
	// fresh singleton; the origin keeps whatever is left and is pruned (with
	// its track, for borders) only when it empties.
	const taken = takeDraggedTools(origin, tools, mode)
	destination = taken.destination
	const prunedSlot = taken.prunedSlot

	// The gap index was read before the prune; when the removed origin sat
	// before the gap in a shared track, indices shifted down by one. Adjust
	// before clamping so the toolbar lands where the pointer is. A parking
	// origin never shares the track, so `prunedSlot` stays `-1` there.
	let insertionIndex = trackSpaceIndex
	if (
		originTrack !== undefined &&
		targetTrack === originTrack &&
		prunedSlot >= 0 &&
		prunedSlot < trackSpaceIndex
	) {
		insertionIndex -= 1
	}
	insertionIndex = Math.min(Math.max(insertionIndex, 0), targetTrack.length)
	insertToolbar(targetTrack, insertionIndex, destination, configuration.trackGapSplit)
	if (mode === 'restructure') destination.push(...tools)

	// Read the toolbar back out of the track rather than reusing the local
	// reference. The border is reactive (`$state`), so the array stored in the
	// track is a *proxy* of `destination`; keeping the raw reference would make
	// every later identity lookup (`findIndex`, `includes`) miss, which is what
	// let a second gap hover build a duplicate toolbar.
	const placed = targetTrack[insertionIndex]?.toolbar ?? destination

	// Refresh the origin so subsequent DZ hovers move from the new location.
	// The placement is done: the selection now sits alone in its own toolbar,
	// so the session is a slide from here on. Recomputing (rather than
	// hard-coding `'slide'`) keeps the single rule — "anything else in my
	// toolbar?" — authoritative for every commit.
	return finishCommit(dragging, {
		kind: 'border',
		toolbar: placed,
		track: targetTrack,
		border: targetBorder,
	})
}

/**
 * Commit the dragged tools into a stack gap, creating a new single-toolbar
 * track at that stack.
 *
 * Works for either origin container (border or parking): the behaviour is
 * decided by the session's *derived* mode (read before mutating), mirroring
 * `commitDraggedToTrackSpace`:
 *
 * - `'restructure'`: the dragged tools are a subset, so they are extracted
 *   from `origin.toolbar` into a fresh singleton toolbar in the new track.
 *   The origin keeps whatever is left and is pruned (with its track, for
 *   borders) only when it empties — via `pruneDragOrigin`, so "removed from
 *   origin only when added elsewhere" holds for cross-container moves.
 * - `'slide'`: `origin.toolbar` itself moves into the new track. Identity is
 *   preserved — the same toolbar object moves, it is never cloned and its
 *   tools are never re-extracted. A parked row slides out of its stack into
 *   the border.
 *
 * The emptied-track veto mirrors the highlight rule in `ToolbarBorder`: a
 * drag that would empty its origin track cannot land on the two stacks
 * touching that track — dropping there would re-create the same spot once
 * the origin vanishes.
 *
 * The stack index was read before the prune; when the removed origin track
 * sat before the stack in a shared border, tracks shifted down by one —
 * adjust before clamping so the track lands where the pointer is.
 * `dragging.origin` is refreshed to `{ kind: 'border', … }` and the mode
 * recomputed (a restructure becomes a slide: its tools now sit alone in
 * their own toolbar).
 *
 * @returns `true` when a track was (re)placed at the stack.
 */
export function commitDraggedToStackSpace(
	targetBorder: PaletteBorder,
	stackIndex: number
): boolean {
	const dragging = palettes.dragging
	if (!dragging) return false
	const { tools, origin } = dragging
	if (tools.length === 0) return false

	// Read the mode *before* mutating: it describes the current selection.
	const mode = resolveDragMode(dragging)

	// Only a border origin can empty a track in the target border (parking
	// has no tracks, and a foreign border holds no origin track) — but run
	// the lookup against the *target* border so a same-border call cannot
	// recreate the emptied spot.
	if (origin.kind === 'border') {
		const emptied = draggingEmptiesTrackIndex(targetBorder)
		if (emptied !== undefined && (stackIndex === emptied || stackIndex === emptied + 1))
			return false
	}

	// Origin track slot before mutating, so a same-border prune can shift
	// the stack index down by one. The track object identity survives the
	// prune (splice removes it from the array, never clones it), so a
	// post-prune `includes` tells whether the border shrank.
	const originBorder = origin.kind === 'border' ? origin.border : undefined
	const originTrack = origin.kind === 'border' ? origin.track : undefined
	const originTrackBefore =
		originBorder !== undefined && originTrack !== undefined ? originBorder.indexOf(originTrack) : -1

	let destination: PaletteToolbar
	// Relocate the toolbar object itself in `'slide'` mode (identity
	// preserved, never cloned); extract the subset into a fresh singleton in
	// `'restructure'` mode (origin pruned only when it empties).
	destination = takeDraggedTools(origin, tools, mode).destination

	let at = stackIndex
	if (
		originBorder !== undefined &&
		originTrack !== undefined &&
		targetBorder === originBorder &&
		originTrackBefore >= 0 &&
		!originBorder.includes(originTrack) &&
		originTrackBefore < stackIndex
	) {
		at -= 1
	}

	// Push the tools into the fresh toolbar *before* inserting it: the border
	// is reactive (`$state`), so the array stored in it is a *proxy* of
	// `destination` — pushing after the splice would mutate the proxy through
	// the raw reference, which breaks identity lookups.
	if (mode === 'restructure') destination.push(...tools)
	const { track: placedTrack, trackIndex } = insertTrackWithToolbar(targetBorder, at, destination)

	// Read the track back out of the border rather than reusing the local
	// reference (same proxy hazard as `commitDraggedToTrackSpace`).
	const placed = targetBorder[trackIndex] ?? placedTrack
	const placedToolbar = placed[0]?.toolbar ?? destination

	// Refresh the origin so subsequent DZ hovers move from the new location.
	return finishCommit(dragging, {
		kind: 'border',
		toolbar: placedToolbar,
		track: placed,
		border: targetBorder,
	})
}

/**
 * Commit the dragged tools into a parking stack gap, creating a new row at
 * that gap. Parking is a plain `Stack<Toolbar>` — the parking analogue of
 * `commitDraggedToStackSpace` (no tracks, no spacing to split).
 *
 * Works for either origin container (border or parking): the behaviour is
 * decided by the session's *derived* mode (read before mutating):
 *
 * - `'restructure'`: the dragged tools are a subset, so they are extracted
 *   from `origin.toolbar` into a fresh singleton row at the gap. The origin
 *   keeps whatever is left and is pruned (with its track, for borders) only
 *   when it empties — via `pruneDragOrigin`, so "removed from origin only
 *   when added elsewhere" holds for cross-container moves.
 * - `'slide'`: `origin.toolbar` itself moves into the new row. Identity is
 *   preserved — the same toolbar object moves, it is never cloned and its
 *   tools are never re-extracted.
 *
 * The emptied-row veto mirrors the highlight rule in `Parking`: a drag that
 * would empty the sole parking row cannot land on the two gaps touching that
 * row. The gap index is adjusted for a same-stack prune (`prunedRow < gap →
 * gap − 1`), and the placed row is read back out of the stack (proxy hazard,
 * same as track gaps). `dragging.origin` is refreshed to
 * `{ kind: 'parking', … }` and the mode recomputed (a restructure becomes a
 * slide: its tools now sit alone in their own row).
 *
 * @returns `true` when a row was (re)placed at the gap.
 */
export function commitDraggedToParkingRow(
	targetParking: PaletteParking,
	gapIndex: number
): boolean {
	const dragging = palettes.dragging
	if (!dragging) return false
	const { tools, origin } = dragging
	if (tools.length === 0) return false

	// Read the mode *before* mutating: it describes the current selection.
	const mode = resolveDragMode(dragging)

	// Only a parking origin can empty a row in the target stack — but run
	// the lookup against the *target* stack so a same-stack call cannot
	// recreate the emptied spot.
	if (origin.kind === 'parking') {
		const emptied = draggingEmptiesParkingRow(targetParking)
		if (emptied !== undefined && (gapIndex === emptied || gapIndex === emptied + 1)) return false
	}

	const originParking = origin.kind === 'parking' ? origin.parking : undefined
	const originRowBefore = originParking !== undefined ? originParking.indexOf(origin.toolbar) : -1

	// Relocate the toolbar object itself in `'slide'` mode (identity
	// preserved, never cloned); extract the subset into a fresh singleton in
	// `'restructure'` mode (origin pruned only when it empties).
	const { destination } = takeDraggedTools(origin, tools, mode)

	let at = gapIndex
	if (
		originParking !== undefined &&
		targetParking === originParking &&
		originRowBefore >= 0 &&
		targetParking.indexOf(origin.toolbar) < 0 &&
		originRowBefore < gapIndex
	) {
		at -= 1
	}
	at = Math.min(Math.max(at, 0), targetParking.length)

	// Push the tools into the fresh row *before* inserting it: the stack is
	// reactive (`$state`), so the array stored in it is a *proxy* of
	// `destination` — pushing after the splice would mutate the proxy through
	// the raw reference, which breaks identity lookups.
	if (mode === 'restructure') destination.push(...tools)
	targetParking.splice(at, 0, destination)

	// Read the row back out of the stack rather than reusing the local
	// reference (same proxy hazard as `commitDraggedToTrackSpace`).
	const placed = targetParking[at] ?? destination
	return finishCommit(dragging, {
		kind: 'parking',
		toolbar: placed,
		parking: targetParking,
		index: at,
	})
}

/**
 * Commit the dragged tools into a parking row at a specific item-space index.
 *
 * Ownership-transfer move: the tools leave the origin container (border
 * toolbar pruned when emptied, parking row pruned when emptied) and land in
 * the target parking toolbar. The session origin follows them, so a parking
 * drag stays a parking drag and a border drag becomes one after landing.
 *
 * @returns `true` when the commit succeeded.
 */
export function commitDraggedToParking(
	targetToolbar: PaletteToolbar,
	targetParking: PaletteParking,
	targetIndex: number,
	itemSpaceIndex: number
): boolean {
	const dragging = palettes.dragging
	if (!dragging) return false
	const { tools, origin } = dragging
	if (tools.length === 0) return false

	pruneDragOrigin(origin, tools)

	const clampedIndex = Math.min(Math.max(itemSpaceIndex, 0), targetToolbar.length)
	targetToolbar.splice(clampedIndex, 0, ...tools)

	const placed = targetParking[targetIndex] ?? targetToolbar
	return finishCommit(dragging, {
		kind: 'parking',
		toolbar: placed,
		parking: targetParking,
		index: Math.min(Math.max(targetIndex, 0), Math.max(targetParking.length - 1, 0)),
	})
}

/**
 * Take the dragged tools out of the session origin, returning the toolbar to
 * place: the origin toolbar itself in `'slide'` mode (identity preserved —
 * relocated, never cloned), or a fresh singleton holding the extracted tools
 * in `'restructure'` mode (origin pruned when emptied). The mode is read
 * before mutating; callers pass it back so the placement comment stays local.
 *
 * @returns The destination toolbar plus the slot the origin vacated (`-1`
 *   when still present — only a real removal shifts same-container indices).
 */
function takeDraggedTools(
	origin: PaletteDragOrigin,
	tools: PaletteToolbarItem[],
	mode: PaletteDragMode
): { destination: PaletteToolbar; prunedSlot: number } {
	if (mode === 'slide') {
		let prunedSlot = -1
		if (origin.kind === 'border') {
			prunedSlot = removeToolbar(origin.track, origin.toolbar)
			removeEmptyTrack(origin.border, origin.track)
		} else {
			removeParkedToolbar(origin.parking, origin.toolbar)
		}
		return { destination: origin.toolbar, prunedSlot }
	}
	pruneDragOrigin(origin, tools)
	return { destination: [], prunedSlot: -1 }
}

/**
 * Finish a commit: refresh the session origin to the placed toolbar,
 * recompute the mode (a restructure becomes a slide once its tools sit alone),
 * and disarm slide-follow when the selection is a subset again. Returns
 * `true` (lets callers `return finishCommit(...)`).
 */
function finishCommit(dragging: PaletteDragging, origin: PaletteDragOrigin): true {
	dragging.origin = origin
	if (refreshDragMode(dragging) !== 'slide') clearToolbarSlide()
	return true
}

/**
 * Remove the dragged tools from wherever the session origin lives, pruning
 * the emptied toolbar (and its track, for borders). Shared by border and
 * parking commits so "removed from origin only when added elsewhere" holds
 * for cross-container moves.
 */
function pruneDragOrigin(origin: PaletteDragOrigin, tools: PaletteToolbarItem[]): void {
	const originToolbar = origin.toolbar
	for (const tool of tools) {
		const index = originToolbar.indexOf(tool)
		if (index >= 0) originToolbar.splice(index, 1)
	}
	if (originToolbar.length > 0) return
	if (origin.kind === 'border') {
		removeToolbar(origin.track, originToolbar)
		removeEmptyTrack(origin.border, origin.track)
	} else {
		removeParkedToolbar(origin.parking, originToolbar)
	}
}

/**
 * Inserts a new single-toolbar track into a border at a clamped index.
 */
export function insertTrackWithToolbar(
	border: PaletteBorder,
	index: number,
	toolbar: PaletteToolbar
): { track: PaletteTrack; trackIndex: number } {
	const trackIndex = Math.min(Math.max(index, 0), border.length)
	const track: PaletteTrack = [{ space: 0, toolbar }]
	border.splice(trackIndex, 0, track)
	return { track, trackIndex }
}

/**
 * Inserts a toolbar into an existing track and splits the target gap according to `split`.
 */
export function insertToolbar(
	track: PaletteTrack,
	index: number,
	toolbar: PaletteToolbar,
	split: number
): void {
	const insertionIndex = Math.min(Math.max(index, 0), track.length)
	const spaces = actualTrackSpaces(track)
	const merged = spaces[insertionIndex] ?? 0
	const before = merged * clampUnit(split)
	const after = merged - before
	spaces.splice(insertionIndex, 1, before, after)
	track.splice(insertionIndex, 0, { space: 0, toolbar })
	applyTrackSpaces(track, spaces)
}

/**
 * Rebalances the spaces around an existing toolbar within a track.
 */
export function resizeToolbar(track: PaletteTrack, index: number, split: number): void {
	if (index < 0 || index >= track.length) return
	const spaces = actualTrackSpaces(track)
	const merged = (spaces[index] ?? 0) + (spaces[index + 1] ?? 0)
	const before = merged * clampUnit(split)
	const after = merged - before
	spaces.splice(index, 2, before, after)
	applyTrackSpaces(track, spaces)
}

// ── Svelte actions ──

function setPaletteRootClass(
	element: HTMLElement | null | undefined,
	name: string,
	enabled: boolean
): void {
	if (!element) return
	element.classList.toggle(name, enabled)
}

function setPaletteRootData(
	element: HTMLElement | null | undefined,
	name: string,
	enabled: boolean
): void {
	if (!element) return
	if (enabled) element.dataset[name] = 'true'
	else delete element.dataset[name]
}

function setPaletteRootId(element: HTMLElement | null | undefined, palette: Palette): void {
	if (!element) return
	element.dataset.paletteId = palette.id
}

/**
 * Palette root: keyboard shortcuts + editing highlight.
 *
 * Movement was stripped for a restart from scratch: this action no longer
 * tracks dragging state or catalogue drops. `paletteItemDrag` only inspects.
 */
export function paletteRoot(element: HTMLElement, palette: Palette): ReturnType<Action> {
	if (!element.hasAttribute('tabindex')) {
		element.tabIndex = 0
	}
	setPaletteRootId(element, palette)
	$effect(() => {
		const editing = palette.editing
		setPaletteRootClass(element, 'palette-editing', editing)
		setPaletteRootClass(element, 'editing', editing)
		setPaletteRootData(element, 'editing', editing)
		if (!editing && palettes.inspecting?.palette === palette) delete palettes.inspecting
	})
	$effect(() => {
		const dragging = palettes.dragging?.palette === palette
		setPaletteRootClass(element, 'palette-dragging', dragging)
		setPaletteRootClass(element, 'dragging', dragging)
		setPaletteRootData(element, 'dragging', dragging)
	})

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.defaultPrevented) return
		if (isEditableTarget(event.target)) return
		// While editing, tool key bindings are suppressed so the keys are free to
		// be re-bound (press-to-rebind for shortcuts). This mirrors the pointer
		// side, where the `inert` shield already blocks run/toggle/check clicks
		// in edit mode (`paletteItemShield`).
		if (palette.editing) return
		const toolId = palette.keys.resolve(event)
		if (!toolId) return
		event.preventDefault()
		event.stopPropagation()
		const tool = palette.tool(toolId)
		if (isRunTool(tool)) {
			if (tool.can) tool.run()
		} else if (isEditableTool(tool) && tool.type === 'boolean') tool.value = !tool.value
		else throw new PaletteError(`Palette binding "${toolId}" did not resolve to a runnable tool`)
	}

	element.addEventListener('keydown', onKeyDown)
	return {
		destroy() {
			element.removeEventListener('keydown', onKeyDown)
		},
	}
}

/**
 * Check whether a toolbar item is part of the simulated drag selection.
 */
export function isDraggingTool(item: PaletteToolbarItem): boolean {
	const dragging = palettes.dragging
	if (!dragging) return false
	return dragging.tools.includes(item)
}

/**
 * Check whether an item-space index is free: neither neighbouring tool (if
 * any) is part of the simulated drag selection. Space `index` sits between
 * `toolbar[index - 1]` and `toolbar[index]`.
 */
export function isItemSpaceFree(toolbar: PaletteToolbar, index: number): boolean {
	const before = toolbar[index - 1]
	const after = toolbar[index]
	if (before !== undefined && isDraggingTool(before)) return false
	if (after !== undefined && isDraggingTool(after)) return false
	return true
}

/**
 * Nearest free item-space at or before `from`. Scans `from` down to `0`;
 * returns `undefined` when every candidate touches a dragged tool (caller
 * falls back to the gap-between-toolbars).
 */
export function nearestFreeItemSpaceBefore(
	toolbar: PaletteToolbar,
	from: number
): number | undefined {
	const start = Math.min(from, toolbar.length)
	for (let index = start; index >= 0; index -= 1) {
		if (isItemSpaceFree(toolbar, index)) return index
	}
	return undefined
}

/**
 * Nearest free item-space at or after `from`. Scans `from` up to
 * `toolbar.length`; returns `undefined` when every candidate touches a
 * dragged tool (caller falls back to the gap-between-toolbars).
 */
export function nearestFreeItemSpaceAfter(
	toolbar: PaletteToolbar,
	from: number
): number | undefined {
	const start = Math.max(from, 0)
	for (let index = start; index <= toolbar.length; index += 1) {
		if (isItemSpaceFree(toolbar, index)) return index
	}
	return undefined
}

/**
 * Check whether the simulated drag selection covers a whole toolbar.
 *
 * Container-scoped: only the session's own origin toolbar can match. A
 * structurally identical toolbar in another container (e.g. parking mirroring
 * a border) never counts — position is part of instance identity.
 */
export function isDraggingWholeToolbar(toolbar: PaletteToolbar): boolean {
	const dragging = palettes.dragging
	if (!dragging || dragging.tools.length === 0) return false
	if (toolbar !== dragging.origin.toolbar) return false
	if (dragging.tools.length !== toolbar.length) return false
	return dragging.tools.every((tool) => toolbar.includes(tool))
}

/**
 * Check whether a toolbar is the session's dragged toolbar *in its own
 * container*. Pass the toolbar's location alongside it: the same object
 * rendered in two places matches only where the drag originated.
 */
export function isDraggedToolbarAt(
	toolbar: PaletteToolbar,
	location: PaletteBorderLocation | PaletteParkingLocation
): boolean {
	const dragging = palettes.dragging
	if (!dragging) return false
	if (toolbar !== dragging.origin.toolbar) return false
	if (location.kind !== dragging.origin.kind) return false
	if (location.kind === 'border' && dragging.origin.kind === 'border') {
		return location.track === dragging.origin.track && location.border === dragging.origin.border
	}
	if (location.kind === 'parking' && dragging.origin.kind === 'parking') {
		return location.parking === dragging.origin.parking && location.index === dragging.origin.index
	}
	return false
}

/**
 * Derive the drag mode from the live selection: `'slide'` when the dragged
 * tools are the *entire* content of their current toolbar (nothing else is
 * left behind), `'restructure'` otherwise.
 *
 * This is the single question the whole drag engine asks: *"is there anything
 * else than `dragging` in my toolbar?"* — no → the toolbar itself moves;
 * yes → the selection is a subset being restructured.
 */
export function resolveDragMode(dragging: PaletteDragging): PaletteDragMode {
	return isDraggingWholeToolbar(dragging.origin.toolbar) ? 'slide' : 'restructure'
}

/**
 * Recompute `dragging.mode` after a structural change (a commit). Cached on
 * the session rather than derived per pointer move, so a drag that started as
 * a subset can *become* a slide once its tools are extracted into a toolbar of
 * their own — and a slide can *become* a restructure once a merge puts other
 * items back beside it. Returns the new mode.
 */
export function refreshDragMode(dragging: PaletteDragging): PaletteDragMode {
	dragging.mode = resolveDragMode(dragging)
	return dragging.mode
}

/**
 * Index of the track the drag would empty: the track holding a single toolbar
 * whose whole content is dragged (`dragged[0]`'s toolbar size = dragged size
 * and its track size = 1). Returns `undefined` when no such track exists in
 * `border` (partial drag, multi-toolbar track, another border/region, or a
 * parking drag — parking has no tracks).
 */
export function draggingEmptiesTrackIndex(border: PaletteBorder): number | undefined {
	const dragging = palettes.dragging
	if (!dragging || dragging.tools.length === 0) return undefined
	if (dragging.origin.kind !== 'border') return undefined
	for (let index = 0; index < border.length; index += 1) {
		const track = border[index]
		if (track.length !== 1) continue
		const sole = track[0]
		if (sole && isDraggingWholeToolbar(sole.toolbar)) return index
	}
	return undefined
}

/**
 * Index of the parking row the drag would empty: the row whose whole content
 * is dragged while the stack holds a single row. Returns `undefined` when no
 * such row exists in `parking` (partial drag, multi-row stack, or a border
 * drag — borders have no rows). Parking analogue of
 * `draggingEmptiesTrackIndex`.
 */
export function draggingEmptiesParkingRow(parking: PaletteParking): number | undefined {
	const dragging = palettes.dragging
	if (!dragging || dragging.tools.length === 0) return undefined
	if (dragging.origin.kind !== 'parking') return undefined
	if (parking.length !== 1) return undefined
	const sole = parking[0]
	if (sole && isDraggingWholeToolbar(sole)) return 0
	return undefined
}

/**
 * Pixel bounds for sliding a toolbar along its track. Toolbars have fixed
 * pixel widths, so the slide must be computed in pixels — a fraction-of-track
 * model drifts because the gaps absorb the toolbar widths (see
 * `plans/movement.md`). The toolbar's `.toolbar-track-slot` parent sits
 * between the leading gap (`space[slot]`) and trailing gap (`space[slot + 1]`)
 * elements; their edges are fixed during the slide, so the free span is the
 * trailing-gap end minus the leading-gap start minus the toolbar span.
 */
function toolbarSlideBounds(
	toolbarElement: HTMLElement,
	direction: PaletteOrientation
): { start: number; available: number } | undefined {
	const slot = toolbarElement.parentElement
	const before = slot?.previousElementSibling
	const after = slot?.nextElementSibling
	if (!(before instanceof HTMLElement) || !(after instanceof HTMLElement)) return undefined
	const horizontal = direction === 'horizontal'
	const start = horizontal
		? before.getBoundingClientRect().left
		: before.getBoundingClientRect().top
	const end = horizontal
		? after.getBoundingClientRect().right
		: after.getBoundingClientRect().bottom
	const rect = toolbarElement.getBoundingClientRect()
	const available = end - start - (horizontal ? rect.width : rect.height)
	return available > 0 ? { start, available } : undefined
}

/**
 * Clamp the pointer to the slide's free span and return the shift to apply.
 * The single copy of the slide math — both the per-frame `transform` write and
 * the release commit use it, so the visual position and the committed `space`
 * can never disagree.
 *
 * `bounds.start` is the *leading gap's* edge, not the toolbar's resting
 * position: the toolbar rests at `start + leadingGapWidth`. `offset0` is
 * expressed in that same span space but measured from the resting position, so
 * the subtraction below yields a shift from *resting* — exactly what
 * `transform` is relative to.
 */
function clampSlideDelta(slide: ToolbarSlideSession, pointer: number, grabOffset: number): number {
	const raw = pointer - grabOffset - slide.bounds.start
	const clamped = Math.min(Math.max(raw, 0), slide.bounds.available)
	return clamped - slide.offset0
}

/**
 * Grab offset of the cursor *within* the toolbar, in pixels. Captured once on
 * mousedown; `slideToolbarInTrack` keeps it fixed so the cursor stays at the
 * same point on the toolbar (natural grab).
 */
export function toolbarGrabOffset(options: {
	toolbarElement: HTMLElement
	clientX: number
	clientY: number
	direction: PaletteOrientation
}): number {
	const rect = options.toolbarElement.getBoundingClientRect()
	const horizontal = options.direction === 'horizontal'
	return (horizontal ? options.clientX : options.clientY) - (horizontal ? rect.left : rect.top)
}

/**
 * Live toolbar-positioning (slide) session.
 *
 * Armed when a whole toolbar is grabbed (`startSimulatedDrag`) and re-armed
 * (`retargetToolbarSlide`) after every gap commit that (re)locates the
 * dragged toolbar — including the first gap commit of a tool drag, which
 * promotes the drag into toolbar positioning over the fresh singleton.
 * Pointer moves only write `transform` (gaps untouched); mouse-up commits
 * once via `resizeToolbar`. Cleared when the drag stops or stops being
 * whole-toolbar (merged into another toolbar).
 */
type ToolbarSlideSession = {
	track: PaletteTrack
	toolbar: PaletteToolbar
	toolbarElement: HTMLElement
	direction: PaletteOrientation
	bounds: { start: number; available: number }
	/**
	 * Shift to apply at arm time, in the free span's space, *relative to the
	 * toolbar's resting position*. `0` for a whole-toolbar grab (the cursor
	 * already sits on the toolbar); non-zero for a recentered restructure
	 * (the toolbar slides so the cursor holds its middle).
	 */
	offset0: number
}

let activeToolbarSlide: ToolbarSlideSession | undefined

function clearToolbarSlideElement(): void {
	const element = activeToolbarSlide?.toolbarElement
	if (element instanceof HTMLElement && element.isConnected) element.style.transform = ''
}

/**
 * Latest pointer position of the active drag, in client coordinates.
 *
 * Deliberately NOT reactive state: the slide-arming `$effect` only needs a
 * one-shot anchor at arm time, and making it depend on the pointer would
 * re-anchor `offset0` every frame (the toolbar would then never appear to
 * move, since the delta is measured against the anchor).
 */
let dragPointer = { x: 0, y: 0 }

/** Client coordinates of the active drag's latest pointer event. */
export function lastDragPointer(): { x: number; y: number } {
	return dragPointer
}

/**
 * Clear the slide session, resetting any visual transform.
 */
export function clearToolbarSlide(): void {
	clearToolbarSlideElement()
	activeToolbarSlide = undefined
}

/**
 * Element currently following the pointer in slide mode, or `undefined` when
 * no slide session is armed. Read-only introspection for tests.
 */
export function activeToolbarSlideElement(): HTMLElement | undefined {
	return activeToolbarSlide?.toolbarElement
}

/**
 * (Re)arm slide-follow over `toolbar` in `track` at the current pointer.
 *
 * A relocated toolbar keeps its mousedown grab delta (`dragging.grabOffset`)
 * even when the axis changes (x becomes y). A restructure drag has no such
 * delta: `recenter` asks for half the fresh toolbar's size to be used, so the
 * toolbar is grabbed by its middle.
 *
 * The slide is expressed as a shift from the toolbar's resting position, so
 * the anchor is that resting offset inside the free span (`resting` = the
 * leading gap's width). `clampSlideDelta` then returns
 * `clamp(pointer − grabOffset − start) − resting`, which is the shift that
 * puts the toolbar's left edge exactly at `pointer − grabOffset`:
 *
 * - a whole-toolbar grab: `pointer − grabOffset` is already the toolbar's
 *   resting left edge, so the shift at arm time is `0` (no visual jump);
 * - a recentered restructure: the shift is measured from the toolbar's resting
 *   spot to the point where the cursor holds its middle, so the toolbar lands
 *   centered on the cursor instead of a gap-width away from it.
 *
 * Called from an `$effect` (after the DOM has flushed), so the element is
 * always the live one. It takes `grabOffset` explicitly rather than reading
 * `dragging.grabOffset`: it *writes* that field when recentering, and an
 * effect must not mutate a value it depends on.
 *
 * @returns `true` when slide-follow is armed (element connected, bounds measurable).
 */
export function retargetToolbarSlide(options: {
	track: PaletteTrack
	toolbar: PaletteToolbar
	toolbarElement: HTMLElement
	direction: PaletteOrientation
	clientX: number
	clientY: number
	/** Recenter the grab on the toolbar's middle (a fresh restructure toolbar). */
	recenter?: boolean
}): boolean {
	const dragging = palettes.dragging
	if (!dragging) return false
	if (!(options.toolbarElement instanceof HTMLElement) || !options.toolbarElement.isConnected)
		return false
	const rect = options.toolbarElement.getBoundingClientRect()
	const horizontal = options.direction === 'horizontal'
	if (options.recenter) {
		const size = horizontal ? rect.width : rect.height
		if (size > 0) dragging.grabOffset = size / 2
	}
	const bounds = toolbarSlideBounds(options.toolbarElement, options.direction)
	if (!bounds) return false
	// The free span starts at the leading gap's edge, but the toolbar rests one
	// leading-gap further in. Anchoring on that resting offset makes
	// `clampSlideDelta` return a shift *from the resting position*, so
	// `transform` (which is relative to the resting position) lines up.
	const resting = (horizontal ? rect.left : rect.top) - bounds.start
	if (activeToolbarSlide?.toolbarElement !== options.toolbarElement) clearToolbarSlideElement()
	activeToolbarSlide = {
		track: options.track,
		toolbar: options.toolbar,
		toolbarElement: options.toolbarElement,
		direction: options.direction,
		bounds,
		offset0: resting,
	}
	// Apply the transform immediately so the toolbar lands under the cursor
	// at arm time — not on the next pointer move. Without this, a commit
	// that happens without a move (stack-DZ dwell fire) leaves the toolbar
	// at its resting spot until the first mousemove drains the rAF loop.
	const pointer = horizontal ? options.clientX : options.clientY
	const delta = clampSlideDelta(activeToolbarSlide, pointer, dragging.grabOffset ?? 0)
	options.toolbarElement.style.transform =
		delta === 0
			? ''
			: horizontal
				? `translate3d(${delta}px, 0, 0)`
				: `translate3d(0, ${delta}px, 0)`
	return true
}

/**
 * Start a simulated drag session: `dragging` is set to the tool list and the
 * pointer is captured (no user interaction needed); on pointer-up (or
 * cancel/blur/hidden) `dragging` clears. The `dragging` class on the IDE root
 * follows via the `paletteRoot` mirror. While the session's mode is `'slide'`
 * the toolbar follows the pointer via `transform` (gaps untouched) and a
 * single `resizeToolbar` commit lands on release.
 *
 * Slide-follow is armed at grab time for a whole-toolbar grab, and armed
 * declaratively by the track after every gap commit (see `ToolbarTrack`), so
 * a restructure promotes into sliding on its first gap. During the drag the
 * gaps are never resized — the toolbar only follows the pointer via
 * `element.style.transform = translate3d(...)`; a single `resizeToolbar`
 * commit lands on release. Bounds are measured per arm from the surrounding
 * gap elements (untransformed siblings) plus the toolbar span, so re-measuring
 * after a relocation never drifts.
 */
function startSimulatedDrag(options: {
	event: PointerEvent
	palette: Palette
	tools: PaletteToolbarItem[]
	origin: PaletteDragOrigin
	mode: PaletteDragMode
	track?: PaletteTrack
	toolbar?: PaletteToolbar
	toolbarElement?: HTMLElement
	direction?: PaletteOrientation
	grabOffset?: number
}): void {
	const { event, palette, tools, origin, mode } = options
	// `grabOffset` is the pixel delta of the cursor within the dragged
	// toolbar. A whole-toolbar grab captures it from the DOM; a restructure
	// drag has none (recentered to the new toolbar's middle on its first
	// track-gap commit, via `recenter`).
	palettes.dragging = { palette, tools, origin, mode, grabOffset: options.grabOffset }
	// Arm toolbar sliding when the selection is the whole toolbar. Gap commits
	// re-arm it over the relocated/fresh toolbar via the track's `$effect`.
	if (
		options.track &&
		options.toolbar &&
		options.toolbarElement &&
		options.direction &&
		mode === 'slide'
	) {
		retargetToolbarSlide({
			track: options.track,
			toolbar: options.toolbar,
			toolbarElement: options.toolbarElement,
			direction: options.direction,
			clientX: event.clientX,
			clientY: event.clientY,
		})
	} else {
		clearToolbarSlide()
	}
	// TB-lag fix: store the latest coordinates on move (cheap, passive) and
	// drive the compositor-only `transform` write from a persistent rAF loop.
	// The old shape scheduled one rAF per move burst (`ticking` flag); under
	// load that starves behind layout work and the toolbar visibly trails the
	// cursor (worse with devTools closed, no throttling). A single loop that
	// drains `dirty` every frame keeps at most one frame of lag.
	let latestX = event.clientX
	let latestY = event.clientY
	dragPointer = { x: latestX, y: latestY }
	let dirty = false
	let frame = 0
	let stopped = false
	function update(): void {
		if (stopped) {
			frame = 0
			return
		}
		if (dirty) {
			dirty = false
			flushTransform()
		}
		frame = requestAnimationFrame(update)
	}
	function flushTransform(): void {
		// Resolve live: gap commits relocate the toolbar (and its element)
		// mid-drag; the track's `$effect` re-arms over the current one.
		const slide = activeToolbarSlide
		const dragging = palettes.dragging
		if (!slide || !dragging || dragging.palette !== palette) return
		if (dragging.origin.kind !== 'border') return
		if (slide.toolbar !== dragging.origin.toolbar || slide.track !== dragging.origin.track) return
		if (!slide.toolbarElement.isConnected) return
		const horizontal = slide.direction === 'horizontal'
		const pointer = horizontal ? latestX : latestY
		const delta = clampSlideDelta(slide, pointer, dragging.grabOffset ?? 0)
		slide.toolbarElement.style.transform =
			delta === 0
				? ''
				: horizontal
					? `translate3d(${delta}px, 0, 0)`
					: `translate3d(0, ${delta}px, 0)`
	}
	if (typeof requestAnimationFrame !== 'undefined') {
		frame = requestAnimationFrame(update)
	}
	startPaletteDragSession({
		event,
		onMove: (_snapshot, moveEvent) => {
			latestX = moveEvent.clientX
			latestY = moveEvent.clientY
			dragPointer = { x: latestX, y: latestY }
			dirty = true
			// jsdom / no-rAF fallback: apply synchronously.
			if (typeof requestAnimationFrame === 'undefined') flushTransform()
		},
		onStop: () => {
			stopped = true
			if (frame !== 0 && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame)
			frame = 0
			dirty = false
			// Single commit on release: resize the gaps once, then clear the
			// visual transform so layout takes over at the committed position.
			// The slot resolves live: gap commits relocate the toolbar mid-drag.
			const slide = activeToolbarSlide
			const dragging = palettes.dragging
			if (
				slide &&
				dragging?.palette === palette &&
				dragging.origin.kind === 'border' &&
				slide.toolbar === dragging.origin.toolbar &&
				slide.track === dragging.origin.track
			) {
				const slot = dragging.origin.track.findIndex((entry) => entry.toolbar === slide.toolbar)
				if (slot >= 0) {
					const horizontal = slide.direction === 'horizontal'
					const pointer = horizontal ? latestX : latestY
					// Undo the anchor shift so the committed fraction matches
					// what is on screen (`offset0` is the delta at arm time).
					const delta = clampSlideDelta(slide, pointer, dragging.grabOffset ?? 0)
					const offset = slide.offset0 + delta
					resizeToolbar(dragging.origin.track, slot, offset / slide.bounds.available)
				}
				if (slide.toolbarElement.isConnected) slide.toolbarElement.style.transform = ''
			} else if (slide?.toolbarElement.isConnected) {
				slide.toolbarElement.style.transform = ''
			}
			activeToolbarSlide = undefined
			if (palettes.dragging?.palette === palette) palettes.dragging = undefined
		},
	})
}

export function paletteToolbarDrag(
	element: HTMLElement,
	target: PaletteToolbarDrag | undefined
): ReturnType<Action> {
	let current = target
	if (!current) return
	const onPointerDown = (event: PointerEvent) => {
		const live = current
		if (!live?.palette) return
		if (!live.palette.editing) return
		if (event.button !== 0) return
		if (isEditableTarget(event.target)) return
		// Whole-toolbar drag: mousedown on the toolbar (not on a tool)
		// selects its whole content; the toolbar then slides along its track
		// following the pointer until mouse-up clears `dragging`.
		if ((event.target as HTMLElement | null)?.closest?.('.toolbar-item')) return
		event.preventDefault()
		startSimulatedDrag({
			event,
			palette: live.palette,
			tools: [...live.toolbar],
			origin: { kind: 'border', toolbar: live.toolbar, track: live.track, border: live.border },
			mode: 'slide',
			track: live.track,
			toolbar: live.toolbar,
			toolbarElement: element,
			direction: live.direction,
			grabOffset: toolbarGrabOffset({
				toolbarElement: element,
				clientX: event.clientX,
				clientY: event.clientY,
				direction: live.direction,
			}),
		})
	}
	element.addEventListener('pointerdown', onPointerDown)
	return {
		update(next: PaletteToolbarDrag | undefined) {
			current = next
		},
		destroy() {
			element.removeEventListener('pointerdown', onPointerDown)
		},
	}
}

export function paletteItemDrag(
	element: HTMLElement,
	target: PaletteItemDragTarget | undefined
): ReturnType<Action> {
	let current = target
	if (!current) return
	const onPointerDown = (event: PointerEvent) => {
		const live = current
		if (!live) return
		if (!live.palette.editing) return
		if (event.button !== 0) return
		event.stopPropagation()
		palettes.inspecting = {
			item: live.item,
			palette: live.palette,
			region: live.region,
			toolbar: live.toolbar,
			track: live.track,
			border: live.border,
			trackIndex: live.trackIndex,
		}
		// Simulated drag: mousedown on a tool selects that single tool;
		// pointer capture holds until mouse-up, which clears `dragging`.
		// Nothing moves yet. The mode starts as `'restructure'` (a subset being
		// extracted), unless the tool is alone in its toolbar — then it is a
		// slide from the start: "nothing else in my toolbar".
		startSimulatedDrag({
			event,
			palette: live.palette,
			tools: [live.item],
			origin: { kind: 'border', toolbar: live.toolbar, track: live.track, border: live.border },
			mode: live.toolbar.length === 1 ? 'slide' : 'restructure',
		})
	}

	element.addEventListener('pointerdown', onPointerDown)
	return {
		update(next: PaletteItemDragTarget | undefined) {
			current = next
		},
		destroy() {
			element.removeEventListener('pointerdown', onPointerDown)
		},
	}
}

export function paletteItemShield(
	element: HTMLElement,
	active: boolean
): { update(next: boolean): void; destroy(): void } {
	element.inert = active
	return {
		update(next: boolean) {
			element.inert = next
		},
		destroy() {
			element.inert = false
		},
	}
}

/**
 * Parking item drag: like `paletteItemDrag` but the origin is a parking row.
 * The session carries `kind: 'parking'`, so border predicates (`isDraggingWholeToolbar`
 * excluded) and slide-follow never match it — a parking grab can never light
 * up a border toolbar as dragged.
 */
export function paletteParkingItemDrag(
	element: HTMLElement,
	target: PaletteParkingItemDragTarget | undefined
): ReturnType<Action> {
	let current = target
	if (!current) return
	const onPointerDown = (event: PointerEvent) => {
		const live = current
		if (!live) return
		if (!live.palette.editing) return
		if (event.button !== 0) return
		event.stopPropagation()
		palettes.inspecting = {
			item: live.item,
			palette: live.palette,
			toolbar: live.toolbar,
		}
		startSimulatedDrag({
			event,
			palette: live.palette,
			tools: [live.item],
			origin: { kind: 'parking', toolbar: live.toolbar, parking: live.parking, index: live.index },
			mode: live.toolbar.length === 1 ? 'slide' : 'restructure',
		})
	}
	element.addEventListener('pointerdown', onPointerDown)
	return {
		update(next: PaletteParkingItemDragTarget | undefined) {
			current = next
		},
		destroy() {
			element.removeEventListener('pointerdown', onPointerDown)
		},
	}
}

/**
 * Parking toolbar drag: whole-row grab. No slide-follow arming (parking rows
 * have no track gaps) — the mode is still `'slide'` so a drop into a border
 * gap relocates the row object itself.
 */
export function paletteParkingToolbarDrag(
	element: HTMLElement,
	target: PaletteParkingToolbarDrag | undefined
): ReturnType<Action> {
	let current = target
	if (!current) return
	const onPointerDown = (event: PointerEvent) => {
		const live = current
		if (!live?.palette) return
		if (!live.palette.editing) return
		if (event.button !== 0) return
		if (isEditableTarget(event.target)) return
		if ((event.target as HTMLElement | null)?.closest?.('.toolbar-item')) return
		event.preventDefault()
		palettes.inspecting = undefined
		startSimulatedDrag({
			event,
			palette: live.palette,
			tools: [...live.toolbar],
			origin: { kind: 'parking', toolbar: live.toolbar, parking: live.parking, index: live.index },
			mode: 'slide',
		})
	}
	element.addEventListener('pointerdown', onPointerDown)
	return {
		update(next: PaletteParkingToolbarDrag | undefined) {
			current = next
		},
		destroy() {
			element.removeEventListener('pointerdown', onPointerDown)
		},
	}
}
