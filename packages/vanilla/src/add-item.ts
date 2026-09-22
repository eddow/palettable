/**
 * `@palettable/vanilla` — build a `ToolbarItem` from a console add-flow
 * selection (entry + variant + inline values).
 *
 * Mirrors the svelte `paletteToolbarItemFromDerivedVariant`: `item` variants
 * become control-only items; `tool`/`action` variants become spec-bound tools
 * with the default control for that spec; `set` variants become spec-bound
 * tools with the default control for the bare point id. Returns `undefined`
 * when the selection cannot materialize (unknown point, mismatched family).
 */

import {
	type AddItemSource,
	type AnyPoint,
	type DerivedVariant,
	isActionPoint,
	isNothingPoint,
	isValuedPoint,
	resolveControl,
	type SurfaceContext,
	type ToolbarItem,
} from '@palettable/core'

export type AddSelection = {
	readonly source: AddItemSource
	readonly variant: DerivedVariant
	readonly booleanValue: string
	readonly setValue: string
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
	// No registry (vanilla demo + unit fixtures pass none): fall back to
	// the family default so the draft/preview still renders a real control.
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

function humanize(id: string): string {
	return id
		.replace(/[-_]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^./, (first) => first.toUpperCase())
}

/**
 * Resolve the spec string for a `set` variant: always the bare `pointId`
 * (mirrors core `paletteDerivedVariants` + svelte
 * `paletteToolbarItemFromDerivedVariant`). The tool binds the point and
 * displays the live value — no `=value` preset is carried. The inline
 * `booleanValue`/`setValue` snapshot fields are ignored (kept in the
 * `AddSelection` shape for the `ConsoleStore` contract only).
 */
function setSpec(pointId: string, _selection: AddSelection): string {
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
		// Nothing-points bind 1:1 by plain id (mirrors the hydration
		// migration `{ point: control, control }` in `layout.ts`): a point-less
		// item breaks `canonicalItemPoint` (throws) and every head renderer
		// that resolves the point. Drawers additionally need their nested
		// track (empty until the user fills it after drop).
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
		if (!point || isActionPoint(point)) return undefined
		// Nothing-point tool: bind the point id 1:1 with its mapped control
		// (variant carries `point.controls[0]`; `controlFor` resolves the same
		// via the allowlist). Drawers need their nested track (empty until
		// the user fills it after drop).
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
	const spec = setSpec(pointId, selection)
	return {
		point: spec,
		control: controlFor(point, registry, defaults),
		config: {
			icon: iconOf(point, source.icon),
			label: labelOf(point, humanize(pointId)),
			hint: variant.meta,
		},
	} as ToolbarItem
}
