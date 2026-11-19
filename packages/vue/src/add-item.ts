/**
 * `@palettable/vue` — build a `ToolbarItem` from a console add-flow
 * selection (entry + variant).
 *
 * Vue-idiom mirror of the vanilla `add-item.ts`: resolves an add-list
 * selection to a toolbar item (`item` variants → control-only items;
 * `tool`/`action` → spec-bound tools with the family default control;
 * `set` → spec-bound tools with the bare point id). Returns `undefined`
 * when the selection cannot materialize.
 */
import {
	type AddableEntry,
	type AnyPoint,
	type DerivedVariant,
	humanizeId,
	isActionPoint,
	isNothingPoint,
	isValuedPoint,
	resolveControl,
	type SurfaceContext,
	type ToolbarItem,
} from '@palettable/core'

export type AddSelection = {
	readonly source: AddableEntry
	readonly variant: DerivedVariant
}

/** Control fallback chain for a fresh item (top surface, no explicit control). */
function controlFor(
	point: AnyPoint | undefined,
	registry: import('@palettable/core').ControlRegistry | undefined,
	defaults: import('@palettable/core').ControlDefaults | undefined
): string | undefined {
	const surface: SurfaceContext = { axis: 'horizontal', region: 'top' }
	const resolved = resolveControl(point, surface, registry, defaults, undefined)
	if (resolved !== undefined) return resolved
	if (point !== undefined && isActionPoint(point)) return 'button'
	if (point === undefined || !isValuedPoint(point)) return 'status'
	if (point.type === 'boolean') return 'toggle'
	if (point.type === 'enum') return 'select'
	return 'slider'
}

function labelOf(point: AnyPoint | undefined, fallback: string): string {
	const label = point !== undefined && 'label' in point ? point.label : undefined
	return typeof label === 'string' && label.length > 0 ? label : fallback
}

function iconOf(point: AnyPoint | undefined, fallback: string | undefined): string | undefined {
	const icon = point !== undefined && 'icon' in point ? point.icon : undefined
	return typeof icon === 'string' ? icon : fallback
}

/** Resolve the spec string for a `set` variant: always the bare `pointId`. */
function setSpec(pointId: string): string {
	return pointId
}

export function itemFromAddSelection(
	selection: AddSelection,
	points: readonly AnyPoint[],
	registry?: import('@palettable/core').ControlRegistry,
	defaults?: import('@palettable/core').ControlDefaults
): ToolbarItem | undefined {
	const { source, variant } = selection
	if (variant.kind === 'item') {
		if (!variant.control) return undefined
		const item = {
			point: variant.control,
			control: variant.control,
			config: {
				icon: variant.icon ?? '⌘',
				label: variant.label,
				hint: variant.meta,
			},
		} as ToolbarItem & { toolbar?: never[] }
		if (variant.control === 'drawer') {
			;(item as { toolbar?: never[] }).toolbar = []
		}
		return item
	}
	if (!variant.pointId) return undefined
	const pointId = variant.pointId
	const point = points.find((candidate) => candidate.id === pointId)
	if (variant.kind === 'tool') {
		if (point !== undefined && isActionPoint(point)) {
			return {
				point: pointId,
				control: controlFor(point, registry, defaults),
				config: {
					icon: iconOf(point, variant.icon ?? source.icon),
					label: labelOf(point, variant.label),
					hint: variant.meta,
				},
			} as ToolbarItem
		}
		if (!point || isActionPoint(point)) return undefined
		if (isNothingPoint(point)) {
			const control = variant.control ?? controlFor(point, registry, defaults)
			if (control === undefined) return undefined
			const item = {
				point: pointId,
				control,
				config: { icon: iconOf(point, source.icon), label: labelOf(point, source.label) },
			} as ToolbarItem & { toolbar?: never[] }
			if (control === 'drawer') {
				;(item as { toolbar?: never[] }).toolbar = []
			}
			return item
		}
		const spec = pointId
		return {
			point: spec,
			control: controlFor(point, registry, defaults),
			config: { icon: iconOf(point, source.icon), label: labelOf(point, source.label) },
		} as ToolbarItem
	}
	if (variant.kind === 'action') {
		if (!variant.action) return undefined
		if (!point || !isActionPoint(point)) return undefined
		const spec = `${pointId}:${variant.action}`
		return {
			point: spec,
			control: controlFor(point, registry, defaults),
			config: {
				icon: iconOf(point, variant.icon ?? source.icon),
				label: variant.label,
				hint: variant.meta,
			},
		} as ToolbarItem
	}
	if (variant.kind !== 'set') return undefined
	if (!point || !isValuedPoint(point)) return undefined
	const matchesFamily =
		(variant.valueType === 'boolean' && point.type === 'boolean') ||
		(variant.valueType === 'enum' && point.type === 'enum') ||
		(variant.valueType === 'number' && point.type === 'number')
	if (!matchesFamily) return undefined
	const spec = setSpec(pointId)
	return {
		point: spec,
		control: controlFor(point, registry, defaults),
		config: {
			icon: iconOf(point, source.icon),
			label: labelOf(point, humanizeId(pointId)),
			hint: variant.meta,
		},
	} as ToolbarItem
}
