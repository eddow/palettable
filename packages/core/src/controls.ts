/**
 * `@palettable/core` — control registry (control ids + capabilities, no components).
 *
 * The core only manipulates control ids (`'button'`, `'toggle'`, …)
 * and capability descriptors; adapters map ids to components.
 */
import type { SurfaceContext } from './layout.js'
import type { AnyPoint } from './points.js'
import { isActionPoint, isNothingPoint } from './points.js'
import type { PointType } from './type.js'

/** Point family: valued-type id, `'action'`, or `'item'` (nothing-point controls). */
export type PointFamily = PointType | 'item'

/** Capability descriptor for one control (e.g. `'toggle'`, `'select'`). */
export type ControlCapability = {
	readonly id: string
	readonly label: string
	readonly families: readonly PointFamily[]
	readonly supportedAxes?: SurfaceContext['axis']
	readonly compact?: boolean
	readonly hidden?: boolean
	readonly requiresConfigSurface?: boolean
}

/** One selectable control for an item's configuration surface. */
export type ControlChoice = {
	readonly id: string
	readonly label: string
	readonly selected: boolean
}

/** Registry: family → control id → capability. Adapters map ids to components. */
export type ControlRegistry = Partial<Record<PointFamily, Record<string, ControlCapability>>>

/** Default control per family, used when an item omits `control`. */
export type ControlDefaults = Partial<Record<PointFamily, string>>

/** Family of a point (`'action'` for actions, `'item'` for nothing-points, else the type id). */
export function familyOfPoint(point: AnyPoint): PointFamily {
	if (isActionPoint(point)) return 'action'
	if (isNothingPoint(point)) return 'item'
	return point.type
}

/** Compute the selectable controls for a point on a surface (headless). */
export function controlChoicesFor(
	point: AnyPoint | undefined,
	surface: SurfaceContext,
	registry: ControlRegistry | undefined,
	defaults: ControlDefaults | undefined,
	currentControl: string | undefined
): readonly ControlChoice[] {
	const family: PointFamily = point === undefined ? 'item' : familyOfPoint(point)
	const variants = registry?.[family] ?? {}
	// Nothing-points may restrict to a 1:1 control subset via `point.controls`
	// (e.g. `theme` → `['theme']`); omitted = whole `item` family (legacy).
	const allowed =
		point !== undefined && isNothingPoint(point) && point.controls !== undefined
			? new Set(point.controls)
			: undefined
	const list = Object.values(variants).filter(
		(cap) =>
			!cap.hidden &&
			(allowed === undefined || allowed.has(cap.id)) &&
			(cap.supportedAxes === undefined ||
				cap.supportedAxes === 'both' ||
				cap.supportedAxes === surface.axis ||
				surface.axis === 'both')
	)
	const fallback = defaults?.[family]
	const selected = currentControl ?? fallback ?? list[0]?.id
	return list.map((cap) => ({ id: cap.id, label: cap.label, selected: cap.id === selected }))
}
