/**
 * Headless command-box model for palettable: lists the palette's points
 * (`PaletteConfig.tools` data definitions, no layout) as executable
 * commands (command-palette usage). Binding a command to a toolbar creates a tool.
 *
 * Ported from `@sursaut/ui/palette` (`ui/src/palette/command-box.ts`), with the
 * Sursaut-specific runtime replaced by Svelte 5 equivalents:
 *
 * - `mutts.reactive(x)` → `$state(x)` (this file is `.svelte.ts` so runes compile)
 * - `mutts.lift(fn)` → `$derived` / `$derived.by(fn)` (see `paletteCommandBoxModel`)
 * - `string | JSX.Element | (() => JSX.Element)` icons → `PaletteIcon`
 *
 * Pure builders (`paletteCommandEntries`, `paletteAddItemEntries`,
 * `paletteDerivedVariants`, `paletteEnumSubsetValues`, catalogue payload
 * serialization) are verbatim ports. The model keeps the reference semantics:
 * `entries` may be a static array or a reader function, `can: false` entries
 * are filtered from `results`, and `execute()` clears filters + selection.
 */
import {
	hasPaletteItemTool,
	isEditableTool,
	isRunTool,
	PaletteError,
	paletteEnumValueKeywords,
	paletteTool,
	paletteToolFamily,
	valueActions,
} from './palette.svelte'
import type {
	Palette,
	PaletteEditableTool,
	PaletteIcon,
	PaletteItem,
	PaletteSchema,
	PaletteTool,
	PaletteToolEnumValue,
	PaletteToolRun,
	PaletteToolSpec,
} from './types'

function normalizeCommandBoxToken(value: string): string {
	return value.trim().toLowerCase()
}

function uniqueNormalized(values: readonly string[]): string[] {
	const seen = new Set<string>()
	const result: string[] = []
	for (const value of values) {
		const normalized = normalizeCommandBoxToken(value)
		if (!normalized || seen.has(normalized)) continue
		seen.add(normalized)
		result.push(value)
	}
	return result
}

function tokenizeQuery(value: string): string[] {
	return value
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0)
}

function trimLastToken(value: string): string {
	const tokens = tokenizeQuery(value)
	tokens.pop()
	return tokens.join(' ')
}

function matchesAllTerms(haystack: string, terms: readonly string[]): boolean {
	return terms.every((term) => haystack.includes(term))
}

/**
 * Search query accepted by `PaletteCommandBoxModel.search()`.
 */
export type PaletteCommandBoxQuery = {
	readonly free?: string
	readonly keywords?: readonly string[]
	readonly categories?: readonly string[]
}

/**
 * Command entry rendered and executed by the palette command box.
 */
export type PaletteCommandBoxEntry<TSchema extends PaletteSchema = PaletteSchema> = {
	readonly id: string
	readonly label: string
	readonly meta?: string
	readonly icon?: PaletteIcon
	readonly keywords?: readonly string[]
	readonly categories?: readonly string[]
	readonly can?: boolean
	/**
	 * When set, HTML5 catalogue drags use this payload instead of the default `{ kind: 'spec', spec: id }`.
	 */
	readonly catalogDrag?: PaletteCatalogDragPayload<TSchema>
	run(): unknown
}

/**
 * Description of an item that can be inserted into a toolbar from the add-item flow.
 */
export type PaletteAddItemSource<TSchema extends PaletteSchema = PaletteSchema> = {
	readonly id: string
	readonly label: string
	readonly meta: string
	readonly icon?: PaletteIcon
	readonly keywords?: readonly string[]
	readonly categories?: readonly string[]
	readonly kind: 'tool' | 'item'
	readonly toolId?: keyof TSchema['tools'] & string
	readonly editor?: keyof TSchema['editorConfigs'] & string
}

/**
 * Command-box entry that returns a `PaletteAddItemSource` when executed.
 */
export type PaletteAddItemCommandEntry<TSchema extends PaletteSchema = PaletteSchema> =
	PaletteCommandBoxEntry<TSchema> & {
		readonly source: PaletteAddItemSource<TSchema>
	}

/**
 * Higher-level item variants derived from a tool or editor source in the add-item flow.
 */
export type PaletteDerivedVariant<TSchema extends PaletteSchema = PaletteSchema> = {
	readonly id: string
	readonly label: string
	readonly meta: string
	readonly icon?: PaletteIcon
	readonly keywords?: readonly string[]
	readonly categories?: readonly string[]
	readonly kind: 'tool' | 'item' | 'set' | 'action'
	readonly toolId?: keyof TSchema['tools'] & string
	readonly editor?: keyof TSchema['editorConfigs'] & string
	readonly action?: string
	readonly spec?: string
	readonly valueType?: 'boolean' | 'number' | 'enum'
	readonly values?: readonly PaletteToolEnumValue[]
}

/**
 * MIME type for HTML5 drag payloads from the palette command-box catalogue.
 */
export const PALETTE_CATALOG_DRAG_MIME = 'application/x-sursaut-palette-catalog' as const

export type PaletteCatalogDragSpecPayload = {
	readonly kind: 'spec'
	readonly spec: string
}

export type PaletteCatalogDragVariantPayload<TSchema extends PaletteSchema = PaletteSchema> = {
	readonly kind: 'variant'
	readonly variant: PaletteDerivedVariant<TSchema>
}

export type PaletteCatalogDragPayload<TSchema extends PaletteSchema = PaletteSchema> =
	| PaletteCatalogDragSpecPayload
	| PaletteCatalogDragVariantPayload<TSchema>

function splitCommandWords(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[^a-zA-Z0-9]+/g, ' ')
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
}

function humanizeCommandText(value: string): string {
	const words = splitCommandWords(value)
	if (words.length === 0) return value
	return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase()).join(' ')
}

function collectCommandKeywords(...sources: (string | readonly string[] | undefined)[]): string[] {
	const values: string[] = []
	for (const source of sources) {
		if (!source) continue
		if (typeof source === 'string') {
			values.push(source)
			values.push(...splitCommandWords(source).map((word) => word.toLowerCase()))
			continue
		}
		for (const value of source) {
			values.push(value)
			values.push(...splitCommandWords(value).map((word) => word.toLowerCase()))
		}
	}
	return uniqueNormalized(values)
}

function commandEntryMeta<TSchema extends PaletteSchema>(
	palette: Palette<TSchema>,
	spec: string,
	fallback: string
): string {
	const keys = palette.keys.findByTool(spec)
	return keys.length > 0 ? keys.join(' / ') : fallback
}

function commandEntryCategories<TSchema extends PaletteSchema>(
	tool: PaletteTool<TSchema['tools']>,
	extra?: readonly string[]
): string[] {
	const categories = uniqueNormalized([...(tool.categories ?? []), ...(extra ?? [])])
	return categories.length > 0 ? categories : [paletteToolFamily(tool)]
}

function commandRunner<TSchema extends PaletteSchema>(
	palette: Palette<TSchema>,
	spec: string
): PaletteToolRun {
	const runner = paletteTool(palette, spec)
	if (!('run' in runner)) throw new PaletteError(`Palette command "${spec}" is not runnable`)
	return runner
}

function paletteEnumCatalogEditorVariant<TSchema extends PaletteSchema>(
	_palette: Palette<TSchema>,
	toolId: keyof TSchema['tools'] & string,
	tool: Extract<PaletteEditableTool<TSchema['tools']>, { type: 'enum' }>
): PaletteDerivedVariant<TSchema> {
	const toolLabel = tool.label ?? humanizeCommandText(toolId)
	return {
		id: `tool:${toolId}:set`,
		kind: 'set',
		toolId,
		label: `${toolLabel} (editor)`,
		meta: 'Control — choose mode in inspector',
		icon: tool.icon,
		keywords: collectCommandKeywords(toolId, toolLabel, tool.keywords, 'set', 'value'),
		categories: commandEntryCategories(tool, ['derived']),
		valueType: 'enum',
		values: tool.values,
	}
}

function generatedCommandEntry<TSchema extends PaletteSchema = PaletteSchema>(options: {
	id: string
	label: string
	meta: string
	icon?: PaletteIcon
	keywords?: readonly string[]
	categories?: readonly string[]
	can?: () => boolean
	catalogDrag?: PaletteCatalogDragPayload<TSchema>
	run(): unknown
}): PaletteCommandBoxEntry<TSchema> {
	return {
		id: options.id,
		label: options.label,
		meta: options.meta,
		icon: options.icon,
		keywords: options.keywords,
		categories: options.categories,
		...(options.catalogDrag !== undefined ? { catalogDrag: options.catalogDrag } : {}),
		get can() {
			return options.can ? options.can() : true
		},
		run() {
			return options.run()
		},
	}
}

function generatedAddItemEntry<TSchema extends PaletteSchema>(options: {
	source: PaletteAddItemSource<TSchema>
	can?: () => boolean
}): PaletteAddItemCommandEntry<TSchema> {
	return {
		id: options.source.id,
		label: options.source.label,
		meta: options.source.meta,
		icon: options.source.icon,
		keywords: options.source.keywords,
		categories: options.source.categories,
		source: options.source,
		get can() {
			return options.can ? options.can() : true
		},
		run() {
			return options.source
		},
	}
}

/**
 * Build the add-item entries used when creating new toolbar items.
 */
export function paletteAddItemEntries<TSchema extends PaletteSchema>(options: {
	palette: Palette<TSchema>
	excludeTools?: readonly string[]
}): readonly PaletteAddItemCommandEntry<TSchema>[] {
	const excluded = new Set(options.excludeTools ?? [])
	const entries: PaletteAddItemCommandEntry<TSchema>[] = []
	for (const [toolId, tool] of Object.entries(options.palette.tools)) {
		if (excluded.has(toolId)) continue
		// Runnable commands are listed in `paletteCommandEntries` (drag spec by id); add-item sources are only for editable tools.
		if (isRunTool(tool)) continue
		if (isEditableTool(tool) && tool.type === 'enum' && tool.commandBoxEnumCommands !== 'per-value')
			continue
		const toolLabel = tool.label ?? humanizeCommandText(toolId)
		entries.push(
			generatedAddItemEntry({
				source: {
					id: `tool:${toolId}`,
					kind: 'tool',
					toolId: toolId as keyof TSchema['tools'] & string,
					label: toolLabel,
					meta: `Add ${tool.type} tool`,
					icon: tool.icon,
					keywords: collectCommandKeywords(toolId, toolLabel, tool.keywords, 'add', 'tool'),
					categories: commandEntryCategories(tool, ['tools']),
				},
			})
		)
	}
	for (const editor of Object.keys(options.palette.editors?.item ?? {})) {
		entries.push(
			generatedAddItemEntry({
				source: {
					id: `item:${editor}`,
					kind: 'item',
					editor: editor as keyof TSchema['editorConfigs'] & string,
					label: humanizeCommandText(editor),
					meta: 'Add editor-only item',
					keywords: collectCommandKeywords(editor, 'add', 'editor', 'toolbox'),
					categories: ['editors', 'items'],
				},
			})
		)
	}
	return entries.toSorted((left, right) => left.label.localeCompare(right.label))
}

/**
 * Expand an add-item source into the concrete variants a user can insert.
 */
export function paletteDerivedVariants<TSchema extends PaletteSchema>(options: {
	palette: Palette<TSchema>
	entry: PaletteAddItemCommandEntry<TSchema> | PaletteAddItemSource<TSchema>
}): readonly PaletteDerivedVariant<TSchema>[] {
	const source = 'source' in options.entry ? options.entry.source : options.entry
	if (source.kind === 'item') {
		return [
			{
				id: `${source.id}:item`,
				kind: 'item',
				editor: source.editor,
				label: source.label,
				meta: 'Editor-only item',
				icon: source.icon,
				keywords: source.keywords,
				categories: source.categories,
			},
		]
	}
	if (!source.toolId) return []
	const tool = options.palette.tools[source.toolId]
	if (!tool) return []
	const toolLabel = tool.label ?? humanizeCommandText(source.toolId)
	// Add-item sources omit runnable tools (`paletteAddItemEntries`); this branch remains for callers passing a synthetic `tool` source.
	if (isRunTool(tool)) {
		return [
			{
				id: `${source.id}:tool`,
				kind: 'tool',
				toolId: source.toolId,
				label: toolLabel,
				meta: 'Toolbar command',
				icon: tool.icon,
				keywords: collectCommandKeywords(source.toolId, toolLabel, tool.keywords),
				categories: commandEntryCategories(tool, ['tool']),
			},
		]
	}
	if (!isEditableTool(tool)) return []
	const editableTool = tool
	const variants: PaletteDerivedVariant<TSchema>[] = []
	if (editableTool.type === 'boolean') {
		variants.push({
			id: `${source.id}:set`,
			kind: 'set',
			toolId: source.toolId,
			label: `${toolLabel} (editor)`,
			meta: 'Control — configure on/off in inspector',
			icon: editableTool.icon,
			keywords: collectCommandKeywords(
				source.toolId,
				toolLabel,
				editableTool.keywords,
				'set',
				'toggle'
			),
			categories: commandEntryCategories(editableTool, ['derived']),
			valueType: 'boolean',
		})
		return variants
	}
	if (editableTool.type === 'enum') {
		variants.push({
			id: `${source.id}:set`,
			kind: 'set',
			toolId: source.toolId,
			label: `${toolLabel} (editor)`,
			meta: 'Control — choose mode in inspector',
			icon: editableTool.icon,
			keywords: collectCommandKeywords(
				source.toolId,
				toolLabel,
				editableTool.keywords,
				'set',
				'value'
			),
			categories: commandEntryCategories(editableTool, ['derived']),
			valueType: 'enum',
			values: editableTool.values,
		})
		return variants
	}
	if (editableTool.type === 'number') {
		variants.push({
			id: `${source.id}:set`,
			kind: 'set',
			toolId: source.toolId,
			label: `${toolLabel} (editor)`,
			meta: 'Control — numeric field in inspector',
			icon: editableTool.icon,
			keywords: collectCommandKeywords(
				source.toolId,
				toolLabel,
				editableTool.keywords,
				'set',
				'value'
			),
			categories: commandEntryCategories(editableTool, ['derived']),
			valueType: 'number',
		})
		// `paletteCommandEntries` already exposes `toolId:inc` / `toolId:dec` for catalogue drag; do not duplicate here.
	}
	return variants
}

/**
 * Filter enum values using keyword matches derived from `paletteEnumValueKeywords()`.
 */
export function paletteEnumSubsetValues<TValue extends string>(options: {
	values: readonly PaletteToolEnumValue<TValue>[]
	keywords?: readonly string[]
}): readonly PaletteToolEnumValue<TValue>[] {
	const keywords = options.keywords?.map((entry) => normalizeCommandBoxToken(entry)).filter(Boolean)
	if (!keywords?.length) return options.values
	return options.values.filter((value) => {
		const actual = new Set(
			paletteEnumValueKeywords(value).map((entry) => normalizeCommandBoxToken(entry))
		)
		for (const keyword of keywords) {
			if (actual.has(keyword)) return true
		}
		return false
	})
}

/**
 * Build the executable command entries for a palette instance.
 *
 * In `catalog` mode, entries stay enabled for search and catalogue drag; `run()` behaviour is unchanged.
 */
export function paletteCommandEntries<TSchema extends PaletteSchema>(options: {
	palette: Palette<TSchema>
	excludeTools?: readonly string[]
	mode?: 'run' | 'catalog'
}): readonly PaletteCommandBoxEntry<TSchema>[] {
	const catalog = options.mode === 'catalog'
	const excluded = new Set(options.excludeTools ?? [])
	const entries: PaletteCommandBoxEntry<TSchema>[] = []
	for (const [toolId, tool] of Object.entries(options.palette.tools)) {
		if (excluded.has(toolId)) continue
		const toolLabel = tool.label ?? humanizeCommandText(toolId)
		if (isRunTool(tool)) {
			const spec = toolId
			entries.push(
				generatedCommandEntry({
					id: spec,
					label: toolLabel,
					meta: commandEntryMeta(options.palette, spec, 'Run command'),
					icon: tool.icon,
					keywords: collectCommandKeywords(toolId, toolLabel, tool.keywords),
					categories: commandEntryCategories(tool),
					can: catalog ? undefined : () => tool.can,
					run() {
						return commandRunner(options.palette, spec).run()
					},
				})
			)
			continue
		}
		if (tool.type === 'boolean') {
			for (const [value, verb, keywords] of [
				[true, 'Enable', ['enable', 'on', 'true']],
				[false, 'Disable', ['disable', 'off', 'false']],
			] as const) {
				const spec = `${toolId}=${value}`
				const presetLabel = value ? 'On' : 'Off'
				entries.push(
					generatedCommandEntry({
						id: spec,
						label: catalog ? `${toolLabel} → ${presetLabel} (preset)` : `${verb} ${toolLabel}`,
						meta: catalog
							? 'Preset — fixed on/off on toolbar'
							: commandEntryMeta(options.palette, spec, `Set ${toolLabel}`),
						icon: tool.icon,
						keywords: collectCommandKeywords(toolId, toolLabel, tool.keywords, keywords),
						categories: commandEntryCategories(tool),
						can: catalog ? undefined : () => tool.value !== value,
						run() {
							return commandRunner(options.palette, spec).run()
						},
					})
				)
			}
			continue
		}
		if (tool.type === 'enum') {
			if (catalog && tool.commandBoxEnumCommands !== 'per-value') {
				const variant = paletteEnumCatalogEditorVariant(
					options.palette,
					toolId as keyof TSchema['tools'] & string,
					tool as Extract<PaletteEditableTool<TSchema['tools']>, { type: 'enum' }>
				)
				const catalogDrag: PaletteCatalogDragVariantPayload<TSchema> = {
					kind: 'variant',
					variant,
				}
				entries.push(
					generatedCommandEntry({
						id: `${toolId}:catalog-enum`,
						label: toolLabel,
						meta: 'Control — add to toolbar; value is chosen on the bar or in the inspector',
						icon: tool.icon,
						keywords: collectCommandKeywords(
							toolId,
							toolLabel,
							tool.keywords,
							'set',
							'value',
							'choose'
						),
						categories: commandEntryCategories(tool),
						catalogDrag,
						run() {
							return variant
						},
					})
				)
				continue
			}
			for (const value of tool.values) {
				const valueLabel = value.label ?? humanizeCommandText(value.value)
				const spec = `${toolId}=${value.value}`
				entries.push(
					generatedCommandEntry({
						id: spec,
						label: catalog
							? `${toolLabel} → ${valueLabel} (preset)`
							: `Set ${toolLabel} to ${valueLabel}`,
						meta: catalog
							? 'Preset — fixed value on toolbar'
							: commandEntryMeta(options.palette, spec, toolLabel),
						icon: value.icon ?? tool.icon,
						keywords: collectCommandKeywords(
							toolId,
							toolLabel,
							tool.keywords,
							value.value,
							valueLabel,
							value.keywords
						),
						categories: commandEntryCategories(tool, value.categories),
						can: catalog ? undefined : () => value.can !== false && tool.value !== value.value,
						run() {
							return commandRunner(options.palette, spec).run()
						},
					})
				)
			}
			continue
		}
		// TODO: use the generic `paletteConfig.runner` that should provide with a title instead of these hard-coded for inc/dec - as these tools are supposed to be customizable
		if (tool.type === 'number') {
			for (const [action, run] of Object.entries(valueActions.number)) {
				const spec = `${toolId}:${action}`
				const actionLabel =
					action === 'inc'
						? `Increase ${toolLabel}`
						: action === 'dec'
							? `Decrease ${toolLabel}`
							: `${humanizeCommandText(action)} ${toolLabel}`
				const actionKeywords =
					action === 'inc'
						? ['increase', 'increment', 'up', 'more']
						: action === 'dec'
							? ['decrease', 'decrement', 'down', 'less']
							: [action]
				entries.push(
					generatedCommandEntry({
						id: spec,
						label: actionLabel,
						meta: commandEntryMeta(options.palette, spec, `Adjust ${toolLabel}`),
						icon: tool.icon,
						keywords: collectCommandKeywords(toolId, toolLabel, tool.keywords, actionKeywords),
						categories: commandEntryCategories(tool),
						can: catalog ? undefined : () => run(tool).can,
						run() {
							return commandRunner(options.palette, spec).run()
						},
					})
				)
			}
		}
	}
	return entries
}

/**
 * Full edit-mode catalogue: runnable commands (all values enabled) plus flattened add-item variants.
 */
export function paletteCatalogEntries<TSchema extends PaletteSchema>(options: {
	palette: Palette<TSchema>
	excludeTools?: readonly string[]
}): readonly PaletteCommandBoxEntry<TSchema>[] {
	const command = paletteCommandEntries({ ...options, mode: 'catalog' })
	const addSources = paletteAddItemEntries(options)
	const addEntries: PaletteCommandBoxEntry<TSchema>[] = []
	for (const entry of addSources) {
		for (const variant of paletteDerivedVariants({ palette: options.palette, entry })) {
			const catalogEntry: PaletteCommandBoxEntry<TSchema> = {
				id: `add:${variant.id}`,
				label: variant.label,
				meta: variant.meta,
				icon: variant.icon,
				keywords: variant.keywords,
				categories: [...(variant.categories ?? []), 'add'],
				catalogDrag: { kind: 'variant', variant: variant as PaletteDerivedVariant },
				run() {
					return variant
				},
			}
			addEntries.push(catalogEntry)
		}
	}
	return [...command, ...addEntries].toSorted((left, right) =>
		left.label.localeCompare(right.label)
	)
}

function paletteDefaultEditorVariantForToolSpec<TSchema extends PaletteSchema>(
	palette: Palette<TSchema>,
	spec: string
): keyof TSchema['editorConfigs'] & string {
	const probe = { tool: spec } as PaletteItem<TSchema>
	if (!hasPaletteItemTool(probe)) throw new PaletteError(`Invalid tool spec "${spec}"`)
	const tool = palette.tool(spec)
	const family = paletteToolFamily(tool)
	const defaults = palette.editorDefaults?.[family]
	if (defaults) return defaults as keyof TSchema['editorConfigs'] & string
	const registry = palette.editors?.[family]
	if (!registry) throw new PaletteError(`No editor registry for tool family of spec "${spec}"`)
	const first = Object.keys(registry)[0]
	if (!first) throw new PaletteError(`Empty editor registry for spec "${spec}"`)
	return first as keyof TSchema['editorConfigs'] & string
}

function paletteToolbarItemFromSpec<TSchema extends PaletteSchema>(
	palette: Palette<TSchema>,
	spec: string
): PaletteItem<TSchema> {
	const editor = paletteDefaultEditorVariantForToolSpec(palette, spec)
	const toolResolved = palette.tool(spec)
	const baseId = spec.split(/[|=]/)[0]?.split(':')[0] ?? spec
	const label =
		'label' in toolResolved && typeof toolResolved.label === 'string'
			? toolResolved.label
			: humanizeCommandText(baseId)
	const icon =
		'icon' in toolResolved && typeof toolResolved.icon === 'string' ? toolResolved.icon : undefined
	return {
		tool: spec as PaletteToolSpec<keyof TSchema['tools'] & string>,
		editor,
		config: { icon, label, hint: commandEntryMeta(palette, spec, label) },
	} as PaletteItem<TSchema>
}

function paletteToolbarItemFromDerivedVariant<TSchema extends PaletteSchema>(
	palette: Palette<TSchema>,
	variant: PaletteDerivedVariant<TSchema>
): PaletteItem<TSchema> | undefined {
	if (variant.kind === 'item') {
		if (!variant.editor) return undefined
		return {
			editor: variant.editor,
			config: { icon: variant.icon ?? '⌘', label: variant.label, hint: variant.meta },
		} as PaletteItem<TSchema>
	}
	if (!variant.toolId) return undefined
	const toolId = variant.toolId
	const tool = palette.tools[toolId]
	if (!tool) return undefined
	if (variant.kind === 'tool') {
		const spec = toolId
		const editor = paletteDefaultEditorVariantForToolSpec(palette, spec)
		const toolLabel =
			'label' in tool && typeof tool.label === 'string' ? tool.label : humanizeCommandText(toolId)
		const toolIcon = 'icon' in tool && typeof tool.icon === 'string' ? tool.icon : undefined
		return {
			tool: spec as PaletteToolSpec<keyof TSchema['tools'] & string>,
			editor,
			config: { icon: toolIcon, label: toolLabel, hint: variant.meta },
		} as PaletteItem<TSchema>
	}
	if (variant.kind === 'action') {
		if (!variant.action) return undefined
		const spec = `${toolId}:${variant.action}` as PaletteToolSpec<keyof TSchema['tools'] & string>
		const editor = paletteDefaultEditorVariantForToolSpec(palette, spec)
		const toolIcon = 'icon' in tool && typeof tool.icon === 'string' ? tool.icon : undefined
		return {
			tool: spec,
			editor,
			config: { icon: variant.icon ?? toolIcon, label: variant.label, hint: variant.meta },
		} as PaletteItem<TSchema>
	}
	if (variant.kind !== 'set') return undefined
	if (!isEditableTool(tool)) return undefined
	// The three `set` branches differ only in the type guard: every `set`
	// variant carries the bare `toolId` spec with the tool's own label/icon.
	if (
		(variant.valueType === 'boolean' && tool.type === 'boolean') ||
		(variant.valueType === 'enum' && tool.type === 'enum') ||
		(variant.valueType === 'number' && tool.type === 'number')
	) {
		const spec = toolId as PaletteToolSpec<keyof TSchema['tools'] & string>
		const editor = paletteDefaultEditorVariantForToolSpec(palette, spec)
		const toolIcon = typeof tool.icon === 'string' ? tool.icon : undefined
		const toolLabel = typeof tool.label === 'string' ? tool.label : humanizeCommandText(toolId)
		return {
			tool: spec,
			editor,
			config: { icon: toolIcon, label: toolLabel, hint: variant.meta },
		} as PaletteItem<TSchema>
	}
	return undefined
}

export function serializePaletteCatalogDragPayload(payload: PaletteCatalogDragPayload): string {
	return JSON.stringify(payload)
}

export function parsePaletteCatalogDragPayload(raw: string): PaletteCatalogDragPayload | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw) as unknown
	} catch {
		return undefined
	}
	if (!parsed || typeof parsed !== 'object') return undefined
	const record = parsed as Record<string, unknown>
	if (record.kind === 'spec' && typeof record.spec === 'string')
		return { kind: 'spec', spec: record.spec }
	if (record.kind === 'variant' && record.variant && typeof record.variant === 'object') {
		const variant = record.variant as Record<string, unknown>
		if (
			typeof variant.id !== 'string' ||
			typeof variant.label !== 'string' ||
			typeof variant.meta !== 'string' ||
			typeof variant.kind !== 'string'
		)
			return undefined
		return {
			kind: 'variant',
			variant: variant as unknown as PaletteDerivedVariant,
		}
	}
	return undefined
}

export function paletteToolbarItemFromCatalogPayload<TSchema extends PaletteSchema>(
	palette: Palette<TSchema>,
	payload: PaletteCatalogDragPayload
): PaletteItem<TSchema> | undefined {
	if (payload.kind === 'spec') {
		try {
			return paletteToolbarItemFromSpec(palette, payload.spec)
		} catch {
			return undefined
		}
	}
	return paletteToolbarItemFromDerivedVariant(
		palette,
		payload.variant as PaletteDerivedVariant<TSchema>
	)
}

type PaletteCommandKeywordToken = {
	readonly keyword: string
}

/**
 * Keyword suggestion presented while typing in the palette command box.
 */
export interface PaletteCommandBoxKeywordSuggestion {
	readonly keyword: string
	readonly isActive: boolean
}

/**
 * Headless state and actions for the palette command box.
 */
export interface PaletteCommandBoxModel<TSchema extends PaletteSchema = PaletteSchema> {
	readonly input: {
		value: string
		readonly placeholder?: string
		clear(): void
	}
	readonly query: {
		readonly free: string
		readonly keywords: readonly string[]
		readonly categories: readonly string[]
	}
	readonly results: readonly PaletteCommandBoxEntry<TSchema>[]
	readonly suggestions: readonly PaletteCommandBoxKeywordSuggestion[]
	readonly categories: {
		readonly available: readonly string[]
		readonly active: readonly string[]
		toggle(category: string): void
		removeLast(): string | undefined
		clear(): void
	}
	readonly keywords: {
		readonly available: readonly string[]
		readonly tokens: readonly PaletteCommandKeywordToken[]
		readonly active: readonly string[]
		addToken(keyword: string): void
		removeLast(): PaletteCommandKeywordToken | undefined
		removeToken(keyword: string): boolean
		clear(): void
	}
	readonly selection: {
		readonly index: number
		readonly item: PaletteCommandBoxEntry<TSchema> | undefined
		select(entryId?: string): PaletteCommandBoxEntry<TSchema> | undefined
		set(index: number): void
		next(): void
		previous(): void
		clear(): void
	}
	select(entryId?: string): PaletteCommandBoxEntry<TSchema> | undefined
	execute(entryId?: string): unknown
	search(query: PaletteCommandBoxQuery): void
	handleKeyDown(event: KeyboardEvent): boolean
}

/**
 * Sync an input event into a command-box model.
 */
export function setPaletteCommandBoxInput<TSchema extends PaletteSchema>(
	commandBox: PaletteCommandBoxModel<TSchema>,
	event: Event
) {
	if (event.currentTarget instanceof HTMLInputElement) {
		commandBox.input.value = event.currentTarget.value
	}
}

/**
 * Keyboard helper for removable category and keyword chips.
 */
export function handlePaletteCommandChipKeydown<TSchema extends PaletteSchema>(options: {
	commandBox: PaletteCommandBoxModel<TSchema>
	event: KeyboardEvent
	token: string
	type?: 'category' | 'keyword'
}) {
	const { commandBox, event, token, type = 'keyword' } = options
	if (!['Backspace', 'Delete', 'Enter', ' '].includes(event.key)) return false
	event.preventDefault()
	if (type === 'category') commandBox.categories.toggle(token)
	else commandBox.keywords.removeToken(token)
	return true
}

/**
 * Keyboard helper for the command-box input field.
 */
export function handlePaletteCommandBoxInputKeydown<TSchema extends PaletteSchema>(options: {
	commandBox: PaletteCommandBoxModel<TSchema>
	event: KeyboardEvent
	onAfterExecute?: () => void
}) {
	const { commandBox, event, onAfterExecute } = options
	const handled = commandBox.handleKeyDown(event)
	if (handled && event.key === 'Enter') onAfterExecute?.()
	return handled
}

/**
 * Create a headless command-box model for a palette command list.
 *
 * Svelte port notes: `mutts.reactive` state becomes `$state` fields and
 * `mutts.lift` derivations become `$derived` values. `$state`/`$derived` are
 * only legal inside `.svelte.ts` at component/module init, so the model must
 * be created during initialization (not in a late event handler or async
 * callback) — the same init-time constraint as `hydratePaletteLayout`.
 *
 * WARNING (init-time constraint): calling this factory outside component/module
 * init (e.g. inside an event handler, `setTimeout`, or after `await`) throws
 * Svelte's `rune_outside_svelte`-style init error (or creates detached,
 * non-reactive state, depending on the Svelte version). Always create the model
 * during component/module initialization and store it (e.g. `const box =
 * paletteCommandBoxModel(...)` at the top of the component script), then drive
 * it from handlers via `box.search()` / `box.execute()` / `box.input.value`.
 */
export function paletteCommandBoxModel<TSchema extends PaletteSchema = PaletteSchema>(options: {
	entries:
		| readonly PaletteCommandBoxEntry<TSchema>[]
		| (() => readonly PaletteCommandBoxEntry<TSchema>[])
	placeholder?: string
	enterAction?: 'execute' | 'select' | (() => 'execute' | 'select')
}): PaletteCommandBoxModel<TSchema> {
	function readEntries(): readonly PaletteCommandBoxEntry<TSchema>[] {
		return typeof options.entries === 'function' ? options.entries() : options.entries
	}

	const inputState = $state({ value: '' })
	const categoryState = $state({ manual: [] as string[] })
	const keywordState = $state({ tokens: [] as PaletteCommandKeywordToken[] })
	const selectionState = $state({ index: -1 })
	const manualQueryState = $state({
		active: false,
		free: '',
		keywords: [] as string[],
		categories: [] as string[],
	})
	const inputPlaceholder = options.placeholder

	const availableCategories = $derived.by(() => {
		const values = readEntries().flatMap((entry) => entry.categories ?? [])
		return uniqueNormalized(values).sort((left, right) => left.localeCompare(right))
	})

	const availableKeywords = $derived.by(() => {
		const values = readEntries().flatMap((entry) => entry.keywords ?? [])
		return uniqueNormalized(values).sort((left, right) => left.localeCompare(right))
	})

	const keywordAliases = $derived.by(() => {
		const aliases: Record<string, string> = {}
		for (const keyword of availableKeywords) aliases[normalizeCommandBoxToken(keyword)] = keyword
		return aliases
	})

	const categoryAliases = $derived.by(() => {
		const aliases: Record<string, string> = {}
		for (const category of availableCategories)
			aliases[normalizeCommandBoxToken(category)] = category
		return aliases
	})

	const parsedInput = $derived.by(() => {
		const categories: string[] = []
		const keywords: string[] = []
		const textTokens: string[] = []
		for (const token of tokenizeQuery(inputState.value)) {
			const categoryToken = token.startsWith('#') ? token.slice(1) : token
			const category = categoryAliases[normalizeCommandBoxToken(categoryToken)]
			if (category && token.startsWith('#')) {
				if (!categories.includes(category)) categories.push(category)
				continue
			}
			const keyword = keywordAliases[normalizeCommandBoxToken(token)]
			if (keyword) {
				if (!keywords.includes(keyword)) keywords.push(keyword)
				continue
			}
			textTokens.push(token)
		}
		return {
			categories,
			keywords,
			text: textTokens.join(' '),
		}
	})

	const activeCategories = $derived.by(() => {
		return uniqueNormalized([...categoryState.manual, ...parsedInput.categories])
	})

	const activeKeywords = $derived.by(() => {
		const manual = keywordState.tokens.map((token) => token.keyword)
		return uniqueNormalized([...manual, ...parsedInput.keywords])
	})

	function useLocalQuery() {
		manualQueryState.active = false
	}

	const query = {
		get free() {
			if (manualQueryState.active) return manualQueryState.free
			return parsedInput.text
		},
		get keywords() {
			if (manualQueryState.active) return manualQueryState.keywords
			return activeKeywords
		},
		get categories() {
			if (manualQueryState.active) return manualQueryState.categories
			return activeCategories
		},
	}

	function entrySearchData(entry: PaletteCommandBoxEntry<TSchema>) {
		const keywords = uniqueNormalized(entry.keywords ?? [])
		const categories = uniqueNormalized(entry.categories ?? [])
		const searchable = normalizeCommandBoxToken(
			[entry.id, entry.label, entry.meta ?? '', ...keywords, ...categories].join(' ')
		)
		return {
			keywords: keywords.map((keyword) => normalizeCommandBoxToken(keyword)),
			categories: categories.map((category) => normalizeCommandBoxToken(category)),
			searchable,
			label: normalizeCommandBoxToken(entry.label),
		}
	}

	function entryScore(
		entry: PaletteCommandBoxEntry<TSchema>,
		freeTerms: readonly string[]
	): number {
		const data = entrySearchData(entry)
		let score = 0
		for (const term of freeTerms) {
			if (data.label === term) score += 8
			else if (data.label.startsWith(term)) score += 5
			else if (data.searchable.includes(term)) score += 2
		}
		return score
	}

	const resultsValue = $derived.by(() => {
		const freeTerms = tokenizeQuery(query.free).map((term) => normalizeCommandBoxToken(term))
		const categoryTerms = query.categories.map((term) => normalizeCommandBoxToken(term))
		const keywordTerms = query.keywords.map((term) => normalizeCommandBoxToken(term))
		return readEntries()
			.filter((entry) => {
				if (entry.can === false) return false
				const data = entrySearchData(entry)
				if (!matchesAllTerms(data.searchable, freeTerms)) return false
				if (
					!keywordTerms.every(
						(term) => data.keywords.includes(term) || data.searchable.includes(term)
					)
				) {
					return false
				}
				if (!categoryTerms.every((term) => data.categories.includes(term))) return false
				return true
			})
			.toSorted((left, right) => {
				const score = entryScore(right, freeTerms) - entryScore(left, freeTerms)
				if (score !== 0) return score
				return left.label.localeCompare(right.label)
			})
	})

	const suggestionsValue = $derived.by(() => {
		const currentWord = tokenizeQuery(inputState.value).at(-1)
		const prefix = currentWord ? normalizeCommandBoxToken(currentWord.replace(/^#/, '')) : ''
		if (!prefix || currentWord?.startsWith('#')) return [] as PaletteCommandBoxKeywordSuggestion[]
		const active = new Set(activeKeywords.map((keyword) => normalizeCommandBoxToken(keyword)))
		const remainingKeywords = new Set<string>()
		for (const entry of resultsValue) {
			for (const keyword of entry.keywords ?? []) {
				const normalized = normalizeCommandBoxToken(keyword)
				if (!active.has(normalized)) remainingKeywords.add(keyword)
			}
		}
		return Array.from(remainingKeywords)
			.filter((keyword) => normalizeCommandBoxToken(keyword).startsWith(prefix))
			.sort((left, right) => left.localeCompare(right))
			.map((keyword) => ({ keyword, isActive: false }))
	})

	function clearFilters() {
		useLocalQuery()
		inputState.value = ''
		categoryState.manual.splice(0, categoryState.manual.length)
		keywordState.tokens.splice(0, keywordState.tokens.length)
	}

	function removeLastCategory(): string | undefined {
		const active = activeCategories
		const category = active[active.length - 1]
		if (!category) return undefined
		const normalized = normalizeCommandBoxToken(category)
		for (let index = categoryState.manual.length - 1; index >= 0; index -= 1) {
			if (normalizeCommandBoxToken(categoryState.manual[index]) !== normalized) continue
			const [removed] = categoryState.manual.splice(index, 1)
			return removed
		}
		return undefined
	}

	const input = {
		get value() {
			return inputState.value
		},
		set value(value: string) {
			useLocalQuery()
			inputState.value = value
			selection.clear()
		},
		get placeholder() {
			return inputPlaceholder
		},
		clear() {
			input.value = ''
		},
	}

	const categories = {
		get available() {
			return availableCategories
		},
		get active() {
			return activeCategories
		},
		toggle(category: string) {
			useLocalQuery()
			const normalized = normalizeCommandBoxToken(category)
			const index = categoryState.manual.findIndex(
				(value) => normalizeCommandBoxToken(value) === normalized
			)
			if (index >= 0) categoryState.manual.splice(index, 1)
			else {
				const resolved = categoryAliases[normalized] ?? category
				categoryState.manual.push(resolved)
			}
			selection.clear()
		},
		removeLast() {
			useLocalQuery()
			const removed = removeLastCategory()
			if (removed) selection.clear()
			return removed
		},
		clear() {
			if (categoryState.manual.length === 0) return
			useLocalQuery()
			categoryState.manual.splice(0, categoryState.manual.length)
			selection.clear()
		},
	}

	const keywords = {
		get available() {
			return availableKeywords
		},
		get tokens() {
			return keywordState.tokens
		},
		get active() {
			return activeKeywords
		},
		addToken(keyword: string) {
			useLocalQuery()
			const resolved = keywordAliases[normalizeCommandBoxToken(keyword)] ?? keyword
			if (
				keywordState.tokens.some(
					(token) => normalizeCommandBoxToken(token.keyword) === normalizeCommandBoxToken(resolved)
				)
			)
				return
			keywordState.tokens.push({ keyword: resolved })
			selection.clear()
		},
		removeLast() {
			useLocalQuery()
			const removed = keywordState.tokens.pop()
			if (removed) selection.clear()
			return removed
		},
		removeToken(keyword: string) {
			useLocalQuery()
			const normalized = normalizeCommandBoxToken(keyword)
			const index = keywordState.tokens.findIndex(
				(token) => normalizeCommandBoxToken(token.keyword) === normalized
			)
			if (index < 0) return false
			keywordState.tokens.splice(index, 1)
			selection.clear()
			return true
		},
		clear() {
			if (keywordState.tokens.length === 0) return
			useLocalQuery()
			keywordState.tokens.splice(0, keywordState.tokens.length)
			selection.clear()
		},
	}

	const selection = {
		get index() {
			return selectionState.index
		},
		get item() {
			return selectionState.index >= 0 && selectionState.index < model.results.length
				? model.results[selectionState.index]
				: undefined
		},
		set(index: number) {
			selectionState.index = Math.max(-1, Math.min(index, model.results.length - 1))
		},
		select(entryId?: string) {
			const index = entryId
				? model.results.findIndex((candidate) => candidate.id === entryId)
				: selectionState.index >= 0
					? selectionState.index
					: model.results.length > 0
						? 0
						: -1
			selection.set(index)
			return index >= 0 ? model.results[index] : undefined
		},
		next() {
			if (model.results.length === 0) {
				selection.clear()
				return
			}
			selection.set(selectionState.index >= model.results.length - 1 ? 0 : selectionState.index + 1)
		},
		previous() {
			if (model.results.length === 0) {
				selection.clear()
				return
			}
			selection.set(selectionState.index <= 0 ? model.results.length - 1 : selectionState.index - 1)
		},
		clear() {
			selectionState.index = -1
		},
	}

	const model: PaletteCommandBoxModel<TSchema> = {
		input,
		query,
		get results() {
			return resultsValue
		},
		get suggestions() {
			return suggestionsValue
		},
		categories,
		keywords,
		selection,
		select(entryId?: string) {
			return selection.select(entryId)
		},
		execute(entryId?: string) {
			const entry = entryId
				? readEntries().find((candidate) => candidate.id === entryId)
				: selection.item
			if (!entry || entry.can === false) return undefined
			const result = entry.run()
			clearFilters()
			selection.clear()
			return result
		},
		search(nextQuery: PaletteCommandBoxQuery) {
			manualQueryState.active = true
			manualQueryState.free = nextQuery.free ?? ''
			manualQueryState.keywords.splice(
				0,
				manualQueryState.keywords.length,
				...uniqueNormalized(nextQuery.keywords ?? []).map(
					(keyword) => keywordAliases[normalizeCommandBoxToken(keyword)] ?? keyword
				)
			)
			manualQueryState.categories.splice(
				0,
				manualQueryState.categories.length,
				...uniqueNormalized(nextQuery.categories ?? []).map(
					(category) => categoryAliases[normalizeCommandBoxToken(category)] ?? category
				)
			)
			selection.clear()
		},
		handleKeyDown(event: KeyboardEvent) {
			if (event.key === 'ArrowDown') {
				event.preventDefault()
				selection.next()
				return true
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault()
				selection.previous()
				return true
			}
			if (event.key === 'Enter') {
				const entry = selection.item ?? model.results[0]
				if (!entry || entry.can === false) return false
				event.preventDefault()
				const resolvedEnter =
					typeof options.enterAction === 'function'
						? options.enterAction()
						: (options.enterAction ?? 'execute')
				if (resolvedEnter === 'select') model.select(entry.id)
				else model.execute(entry.id)
				return true
			}
			if (event.key === 'Backspace' && inputState.value.length === 0) {
				const removedKeyword = keywords.removeLast()
				if (removedKeyword) {
					event.preventDefault()
					return true
				}
				const removedCategory = categories.removeLast()
				if (removedCategory) {
					event.preventDefault()
					return true
				}
			}
			if (event.key === 'Escape') {
				if (selection.index >= 0) {
					event.preventDefault()
					selection.clear()
					return true
				}
				if (inputState.value || categories.active.length > 0 || keywords.tokens.length > 0) {
					event.preventDefault()
					clearFilters()
					return true
				}
			}
			if (event.key === ' ' || event.key === 'Tab') {
				const currentWord = tokenizeQuery(inputState.value).at(-1)
				const normalizedWord = currentWord ? normalizeCommandBoxToken(currentWord) : ''
				const suggestion = normalizedWord
					? suggestionsValue.find((entry) =>
							normalizeCommandBoxToken(entry.keyword).startsWith(normalizedWord)
						)
					: undefined
				if (suggestion) {
					event.preventDefault()
					keywords.addToken(suggestion.keyword)
					input.value = trimLastToken(inputState.value)
					return true
				}
			}
			return false
		},
	}

	return model
}
