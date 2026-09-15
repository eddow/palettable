/**
 * `@palettable/vanilla` — build a `ToolbarItem` from a console add-flow
 * selection (entry + variant + inline values).
 *
 * Mirrors the svelte `paletteToolbarItemFromDerivedVariant`: `item` variants
 * become editor-only items; `tool`/`action` variants become spec-bound tools
 * with the default editor for that spec; `set` variants become spec-bound
 * tools with the default editor for the bare tool id. Returns `undefined`
 * when the selection cannot materialize (unknown point, mismatched family).
 */

import {
	type AddItemSource,
	type AnyPoint,
	type DerivedVariant,
	isActionPoint,
	isValuedPoint,
	resolveEditorVariant,
	type SurfaceContext,
	type ToolbarItem,
} from '@palettable/core'

export type AddSelection = {
	readonly source: AddItemSource
	readonly variant: DerivedVariant
	readonly booleanValue: string
	readonly setValue: string
}

/** Editor-variant fallback chain for a fresh item (top surface, no explicit editor). */
function editorFor(
	point: AnyPoint | undefined,
	registry: import('@palettable/core').EditorRegistry | undefined,
	defaults: import('@palettable/core').EditorDefaults | undefined
): string | undefined {
	const surface: SurfaceContext = { axis: 'horizontal', region: 'top' }
	return resolveEditorVariant(point, surface, registry, defaults, undefined)
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
 * Resolve the spec string for a `set` variant: `toolId` for booleans
 * (toggle flips it), `toolId=value` for numbers/enums when the inline
 * value parses, else the bare `toolId` (configured later in the inspector).
 */
function setSpec(toolId: string, selection: AddSelection): string {
	if (selection.variant.valueType === 'number') {
		const parsed = Number(selection.setValue)
		if (selection.setValue.trim() !== '' && Number.isFinite(parsed)) return `${toolId}=${parsed}`
		return toolId
	}
	if (selection.variant.valueType === 'enum') {
		if (selection.setValue !== '') return `${toolId}=${selection.setValue}`
		return toolId
	}
	return toolId
}

export function itemFromAddSelection(
	selection: AddSelection,
	points: readonly AnyPoint[],
	registry?: import('@palettable/core').EditorRegistry,
	defaults?: import('@palettable/core').EditorDefaults
): ToolbarItem | undefined {
	const { source, variant } = selection
	if (variant.kind === 'item') {
		if (!variant.editor) return undefined
		return {
			editor: variant.editor,
			config: {
				icon: variant.icon ?? '⌘',
				label: variant.label,
				hint: variant.meta,
			},
		} as ToolbarItem
	}
	if (!variant.toolId) return undefined
	const toolId = variant.toolId
	const point = points.find((candidate) => candidate.id === toolId)
	if (variant.kind === 'tool') {
		if (!point || isActionPoint(point)) return undefined
		const spec = toolId
		return {
			tool: spec,
			editor: editorFor(point, registry, defaults),
			config: { icon: iconOf(point, source.icon), label: labelOf(point, source.label) },
		} as ToolbarItem
	}
	if (variant.kind === 'action') {
		if (!variant.action) return undefined
		if (!point || !isActionPoint(point)) return undefined
		const spec = `${toolId}:${variant.action}`
		return {
			tool: spec,
			editor: editorFor(point, registry, defaults),
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
	const spec = setSpec(toolId, selection)
	return {
		tool: spec,
		editor: editorFor(point, registry, defaults),
		config: {
			icon: iconOf(point, source.icon),
			label: labelOf(point, humanize(toolId)),
			hint: variant.meta,
		},
	} as ToolbarItem
}
