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
	isNothingPoint,
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
	const resolved = resolveEditorVariant(point, surface, registry, defaults, undefined)
	if (resolved !== undefined) return resolved
	// No registry (vanilla demo + unit fixtures pass none): fall back to
	// the family default so the draft/preview still renders a real editor.
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
 * Resolve the spec string for a `set` variant: always the bare `toolId`
 * (mirrors core `paletteDerivedVariants` + svelte
 * `paletteToolbarItemFromDerivedVariant`). The tool binds the point and
 * displays the live value — no `=value` preset is carried. The inline
 * `booleanValue`/`setValue` snapshot fields are ignored (kept in the
 * `AddSelection` shape for the `ConsoleStore` contract only).
 */
function setSpec(toolId: string, _selection: AddSelection): string {
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
		// Nothing-points bind 1:1 by plain id (mirrors the hydration
		// migration `{ tool: editor, editor }` in `layout.ts`): a tool-less
		// item breaks `canonicalItemTool` (throws) and every head renderer
		// that resolves the point. Drawers additionally need their nested
		// track (empty until the user fills it after drop).
		const item = {
			tool: variant.editor,
			editor: variant.editor,
			config: {
				icon: variant.icon ?? '⌘',
				label: variant.label,
				hint: variant.meta,
			},
		} as ToolbarItem & { toolbar?: never[] }
		if (variant.editor === 'drawer') {
			;(item as { toolbar?: never[] }).toolbar = []
		}
		return item
	}
	if (!variant.toolId) return undefined
	const toolId = variant.toolId
	const point = points.find((candidate) => candidate.id === toolId)
	if (variant.kind === 'tool') {
		if (!point || isActionPoint(point)) return undefined
		// Nothing-point tool: bind the point id 1:1 with its mapped editor
		// (variant carries `point.editors[0]`; `editorFor` resolves the same
		// via the allowlist). Drawers need their nested track (empty until
		// the user fills it after drop).
		if (isNothingPoint(point)) {
			const editor = variant.editor ?? editorFor(point, registry, defaults)
			if (editor === undefined) return undefined
			const item = {
				tool: toolId,
				editor,
				config: { icon: iconOf(point, source.icon), label: labelOf(point, source.label) },
			} as ToolbarItem & { toolbar?: never[] }
			if (editor === 'drawer') {
				;(item as { toolbar?: never[] }).toolbar = []
			}
			return item
		}
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
