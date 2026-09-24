/**
 * `@palettable/vue` — head shared helpers (presenter binding + icon + surface).
 *
 * Vue-idiom port of the vanilla adapter's `head.ts` shared section:
 * `IconResolver` / `resolveIcon`, `HeadContext`, `boundOf` / `liveValue` /
 * `pointIdOf`, `surfaceForRegion`, `readThemeSetting`, `syncStatusValue`,
 * `selectWatermark` class constant, and the drawer item-activate event.
 * Per-control rendering lives in `head/*.vue` SFCs; the dispatch table
 * (`renderHeadItem` equivalent) lives in `head/HeadItem.vue`.
 */
import {
	type AnyPoint,
	axisForRegion,
	canonicalItemPoint,
	type DisplayStrings,
	isValuedPoint,
	type PaletteCore,
	type PaletteRegion,
	type SurfaceContext,
	type ToolbarItem,
	type ValuesBag,
} from '@palettable/core'
import type { IdeStrings } from './strings.js'

/** Consumer icon resolver: maps an `IconToken` to its rendered glyph
 * (string-to-string only — keeps `textContent` safety, no DOM/SVG injection).
 * Return `undefined` to keep the token as-is. */
export type IconResolver = (token: string) => string | undefined

/** Resolve one icon token through an optional resolver. `undefined`/empty
 * pass through untouched (still handled as absent by the SFCs);
 * unknown `icon:` names fall back to the raw token (debuggable, never blank). */
export function resolveIcon(
	token: string | undefined,
	resolver?: IconResolver
): string | undefined {
	if (token === undefined || token === '') return token
	if (resolver === undefined) return token
	return resolver(token) ?? token
}

export type HeadContext = {
	readonly core: PaletteCore
	readonly item: ToolbarItem
	readonly surface: SurfaceContext
	readonly region?: PaletteRegion
	/** Localizable chrome strings (partial — merged over the English default). */
	readonly strings?: Partial<IdeStrings>
	/**
	 * Render-time display dictionaries (optional — every field falls back).
	 * Chain: item-config field → dictionary → definition field → `humanize(id)`.
	 */
	readonly display?: DisplayStrings
	/** Optional string-glyph resolver: maps an `IconToken` to its rendered
	 * glyph. `undefined` return (or absent resolver) keeps the token as-is,
	 * so emoji passthrough is the default. */
	readonly iconResolver?: IconResolver
	readonly onOpenConsole?: (mode: 'run' | 'edit') => void
	readonly onInspect?: (item: ToolbarItem) => void
}

/** Resolve the point id a tool item binds (canonical spec id). */
export function pointIdOf(item: ToolbarItem): string | undefined {
	const id = canonicalItemPoint(item)
	return id === '' ? undefined : id
}

export function boundOf(
	core: PaletteCore,
	pointId: string | undefined
): {
	point: AnyPoint | undefined
	value: unknown
	bags: readonly (ValuesBag | undefined)[]
} {
	const point = pointId !== undefined ? core.getDefinition(pointId) : undefined
	const bags = core.resolveBags(point?.uses)
	return { point, value: liveValue(core, point), bags }
}

/**
 * Read the live value for a bound point: dual-source precedence
 * (context-display) — first non-root used bag holding the id wins, else
 * the root value. Absent bag / absent key → root. Nothing-points carry no
 * value (always `undefined` — display state comes from the bags).
 * Delegates to `core.readValue` (the single read path over plain point ids).
 */
export function liveValue(core: PaletteCore, point: AnyPoint | undefined): unknown {
	if (point === undefined || !isValuedPoint(point)) return undefined
	try {
		return core.readValue(point.id)
	} catch {
		return undefined
	}
}

/** Surface for a docking region (`top`/`bottom` → horizontal). */
export function surfaceForRegion(region: PaletteRegion | undefined): SurfaceContext {
	return { axis: axisForRegion(region), region }
}

/** Read the current theme setting from the document root (`data-theme`, default `system`). */
export function readThemeSetting(): 'light' | 'dark' | 'system' {
	if (typeof document === 'undefined') return 'system'
	const raw = document.documentElement.dataset.theme
	return raw === 'light' || raw === 'dark' ? raw : 'system'
}

/** Stylised skeleton watermark class for a select with no matching option (`?`).
 * Own class (never `.palette-default-choice`) so label selectors and the
 * overlay/joint `:has` rules never match it. */
export const SELECT_WATERMARK_CLASS = 'palette-default-select-watermark'

/** Split a status string into minutes/seconds for the vertical stack.
 * Strict `mm:ss` only (`1–3 digits : exactly 2 digits`); anything else
 * returns `undefined` so arbitrary status strings fall back to the single
 * value node instead of breaking. Opaque split — never formats time. */
export function splitStatusTime(value: string): [string, string] | undefined {
	const match = /^(\d{1,3}):(\d{2})$/.exec(value.trim())
	if (!match?.[1] || !match?.[2]) return undefined
	return [match[1], match[2]]
}

/** Bubbling activation event: a command / toggle / segmented inside a drawer
 * fired. Drawer wrappers listen for it and run the recursive close-on-click
 * chain. Dispatched AFTER `core.run(...)` so the action always lands even
 * when no drawer is listening. */
export const DRAWER_ITEM_ACTIVATE_EVENT = 'palettable-drawer-item-activate'

/** Dispatch the drawer item-activate event from an inner control element. */
export function notifyDrawerItemActivate(node: HTMLElement): void {
	node.dispatchEvent(new CustomEvent(DRAWER_ITEM_ACTIVATE_EVENT, { bubbles: true }))
}

/** Per-drawer close-on-click chain entry (innermost first). */
export type DrawerChainEntry = {
	readonly close: () => void
	readonly closeOnClick: boolean
	readonly openMode: 'hover' | 'toggle'
}

/**
 * Resolve which drawer chain entries to close after an inner activation.
 * Rule ("keep from top, remove from bottom", `keep && !remove`):
 * - pass 1 (bottom-up): mark remove from the leaf upward while
 *   `closeOnClick === true`, stopping (exclusive) at the first `false`.
 * - pass 2: mark remove from the leaf up to AND including the highest
 *   (outermost) ancestor with `open === 'hover'`.
 * The final set is the max / outermost of the two extents: indices
 * `0 .. max(removeEnd1, removeEnd2)`.
 * Returns the indices into `chain` (innermost-first) to close.
 */
export function drawerCloseChainIndices(chain: readonly DrawerChainEntry[]): readonly number[] {
	let end1 = -1
	for (let index = 0; index < chain.length; index++) {
		if (chain[index]?.closeOnClick !== true) break
		end1 = index
	}
	let end2 = -1
	for (let index = 0; index < chain.length; index++) {
		if (chain[index]?.openMode === 'hover') end2 = index
	}
	const end = Math.max(end1, end2)
	if (end < 0) return []
	return chain.slice(0, end + 1).map((_, index) => index)
}
