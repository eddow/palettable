/**
 * `@palettable/core` — editor registry (variant ids + capabilities, no components).
 *
 * The core only manipulates editor *variant ids* (`'button'`, `'toggle'`, …)
 * and capability descriptors; adapters map ids to components.
 */
import type { SurfaceContext } from './layout.js'
import type { AnyPoint } from './points.js'
import { isActionPoint } from './points.js'
import type { PointType } from './type.js'

/** Point family: valued-type id, `'action'`, or `'item'` (pointless variants). */
export type PointFamily = PointType | 'item'

/** Capability descriptor for one editor variant (e.g. `'toggle'`, `'select'`). */
export type EditorCapability = {
	readonly id: string
	readonly label: string
	readonly families: readonly PointFamily[]
	readonly supportedAxes?: SurfaceContext['axis']
	readonly compact?: boolean
	readonly hidden?: boolean
	readonly requiresConfigSurface?: boolean
}

/** One selectable variant for an item's configuration surface. */
export type EditorChoice = {
	readonly id: string
	readonly label: string
	readonly selected: boolean
}

/** Registry: family → variant id → capability. Adapters map ids to components. */
export type EditorRegistry = Partial<Record<PointFamily, Record<string, EditorCapability>>>

/** Default variant per family, used when an item omits `editor`. */
export type EditorDefaults = Partial<Record<PointFamily, string>>

/** Family of a point (`'action'` for actions, else the type id). */
export function familyOfPoint(point: AnyPoint): PointFamily {
	return isActionPoint(point) ? 'action' : point.type
}

/** Compute the selectable variants for a point on a surface (headless). */
export function editorChoicesFor(
	point: AnyPoint | undefined,
	surface: SurfaceContext,
	registry: EditorRegistry | undefined,
	defaults: EditorDefaults | undefined,
	currentEditor: string | undefined
): readonly EditorChoice[] {
	const family: PointFamily = point === undefined ? 'item' : familyOfPoint(point)
	const variants = registry?.[family] ?? {}
	const list = Object.values(variants).filter(
		(cap) =>
			!cap.hidden &&
			(cap.supportedAxes === undefined ||
				cap.supportedAxes === 'both' ||
				cap.supportedAxes === surface.axis ||
				surface.axis === 'both')
	)
	const fallback = defaults?.[family]
	const selected = currentEditor ?? fallback ?? list[0]?.id
	return list.map((cap) => ({ id: cap.id, label: cap.label, selected: cap.id === selected }))
}
