/**
 * Headless palette type system for palettable.
 *
 * Vocabulary (see `docs/core-concepts.md`): **point** = the data definition of
 * what is controlled by the palette, one entry of `PaletteConfig.tools` (no
 * layout; code names `PaletteToolRun` / `PaletteEditableTool`); **tool** = a
 * toolbar-bound control that modifies a point (`PaletteToolbarItem` +
 * `PaletteEditorSpec.editor` + presenter + head component); **editor** = the
 * configuration panel that comes with a tool (`PaletteEditorSpec.configure`,
 * e.g. `BaseConfigurator`). `status` / `commandBox` / `drawer` are
 * **pointless tools**: `item`-family variants binding no point (no bound value).
 * Code names keep the historical `PaletteTool*` / `PaletteEditor*` prefixes.
 *
 * Ported from `@sursaut/ui/palette` (`ui/src/palette/types.ts`), with the
 * Sursaut runtime types replaced by Svelte 5 equivalents:
 *
 * - `JSX.Element` / `() => JSX.Element` → `Component`
 * - `JSX.IntrinsicElements['div']` → `SvelteHTMLElements['div']`
 *
 * This module is pure types — no runes, so it stays a plain `.ts` file.
 */
import type { Component } from 'svelte'
import type { SvelteHTMLElements } from 'svelte/elements'

/**
 * Icon value accepted by palette tools, toolbar items, and command entries.
 *
 * - `string` — icon name, resolved by an icon factory (or rendered as text)
 * - `Component` — a Svelte component that renders the icon
 *
 * Snippets are intentionally excluded: `Component` and `Snippet` are both
 * callables with no runtime discriminator, so the `Icon` helper could never
 * render a `Snippet` member. Callers with inline markup wrap it in a component
 * or render it directly with `{@render}` at the call site.
 */
export type PaletteIcon = string | Component

/**
 * Shared base properties for all palette points (code name: tools).
 */
type PaletteToolBase = {
	/** Optional categories for grouping related tools. */
	readonly categories?: string[]
	/** Optional icon for visual representation. */
	readonly icon?: PaletteIcon
	/** Optional keywords for search and filtering. */
	readonly keywords?: string[]
	/** Optional human-readable label. */
	readonly label?: string
}

/**
 * Shared element passthrough accepted by palette layout components.
 */
export interface PaletteComponentProps {
	/** Optional passthrough element props. */
	readonly el?: SvelteHTMLElements['div']
}

/**
 * Runnable palette point: an action definition in `PaletteConfig.tools` (no layout).
 * Binding it to a toolbar creates a button tool. Exposes an imperative `run()`
 * and a reactive `can` flag. (Code name: run tool.)
 */
export type PaletteToolRun = PaletteToolBase & {
	/** Execute the tool's action. */
	run(): void
	/** Whether the tool is currently enabled. */
	readonly can: boolean
}

/**
 * Read-only point shape shared by editable points.
 */
export type PaletteToolStatus<T> = PaletteToolBase & {
	/** The current value of the tool. */
	readonly value: T
	/** The type of the tool (e.g. 'boolean', 'number', ...). */
	type: string
}

/**
 * Mutable palette value with a restorable default.
 */
export type PaletteToolEdit<T> = PaletteToolStatus<T> & {
	/** The current value of the tool. */
	value: T
	/** The default value of the tool. */
	readonly default: T
}

/**
 * Boolean on/off palette point. Binding it to a toolbar creates a toggle tool.
 * A boolean point can also be rendered as an enum tool with predefined
 * `true` / `false` (and optionally unset) values — the point stays boolean,
 * only the tool differs. (Code name: boolean tool.)
 */
export type PaletteToolBool = PaletteToolEdit<boolean> & {
	type: 'boolean'
}

/**
 * Numeric palette point optionally constrained by `min`, `max`, and `step`.
 * Binding it to a toolbar creates a slider/stepper/stars tool — or an enum tool
 * with a list of predefined numeric presets (the point stays numeric, only the
 * tool differs). (Code name: number tool.)
 */
export type PaletteToolNumber = PaletteToolEdit<number> & {
	type: 'number'
	/** Optional minimum value. */
	min?: number
	/** Optional maximum value. */
	max?: number
	/** Optional step value. */
	step?: number
}

export type PaletteToolEnumValue<T extends string = string> = {
	/** The value of the enum option. */
	readonly value: T
	/** Optional enablement flag. */
	readonly can?: boolean
	/** Optional categories for grouping related enum options. */
	readonly categories?: string[]
	/** Optional icon for visual representation. */
	readonly icon?: PaletteIcon
	/** Optional human-readable label. */
	readonly label?: string
	/** Optional keywords for search and filtering. */
	readonly keywords?: string[]
}

/**
 * Enumerated palette point with a finite list of selectable choices.
 * Binding it to a toolbar creates a select/segmented tool. (Code name: enum tool.)
 */
export type PaletteToolEnum<T extends string = string> = PaletteToolEdit<T> & {
	type: 'enum'
	/** The list of enum options. */
	readonly values: readonly PaletteToolEnumValue<T>[]
	/**
	 * How this enum appears in the palette command box **catalog** mode.
	 *
	 * - **Omitted (default):** one catalogue row whose label is the tool label, dragging the
	 *   editor `(set)` variant; run mode still lists one executable command per value.
	 * - `per-value`: one catalogue row per option (legacy behaviour).
	 */
	readonly commandBoxEnumCommands?: 'per-value'
}

export type PaletteAnyTool = PaletteToolRun | PaletteToolBool | PaletteToolNumber | PaletteToolEnum
export type PaletteTools = Record<string, PaletteAnyTool>
export type PaletteTool<TTools extends PaletteTools = PaletteTools> = TTools[keyof TTools & string]
export type PaletteEditableTool<TTools extends PaletteTools = PaletteTools> = Exclude<
	PaletteTool<TTools>,
	PaletteToolRun
>
/**
 * Point families: `run` / `boolean` / `enum` / `number` (entries of
 * `PaletteConfig.tools`) plus `item` (pointless `item`-family variants binding
 * no point: `commandBox`, `drawer`, `status`).
 */
export type PaletteToolFamily<TTools extends PaletteTools = PaletteTools> =
	| 'run'
	| 'item'
	| PaletteEditableTool<TTools>['type']

export type PaletteToolByFamily<
	TTools extends PaletteTools = PaletteTools,
	TFamily extends PaletteToolFamily<TTools> = PaletteToolFamily<TTools>,
> = TFamily extends 'run' ? PaletteToolRun : Extract<PaletteEditableTool<TTools>, { type: TFamily }>

export type PaletteEditableToolByFamily<
	TTools extends PaletteTools = PaletteTools,
	TFamily extends PaletteEditableTool<TTools>['type'] = PaletteEditableTool<TTools>['type'],
> = Extract<PaletteEditableTool<TTools>, { type: TFamily }>

export type PaletteKeystroke = string

export type PaletteKeyBindings = Record<PaletteKeystroke, string>

/**
 * Normalized keyboard binding registry for palette command specs.
 */
export interface PaletteKeys {
	/** The keyboard bindings. */
	readonly bindings: PaletteKeyBindings
	/** Find keystrokes bound to a specific tool. */
	findByTool(toolId: string): readonly PaletteKeystroke[]
	/** Resolve a keyboard event to a bound tool spec. */
	resolve(event: KeyboardEvent): string | undefined
}

/**
 * Type-level contract for a palette instance.
 *
 * `tools` defines the available command/value tools, `editorConfigs` the per-item
 * config payloads keyed by editor variant, and `item` the toolbar item union.
 */
export interface PaletteSchema<
	TTools extends PaletteTools = PaletteTools,
	TEditorConfigs extends Record<string, unknown> = Record<string, unknown>,
	TItem extends PaletteToolbarItem<
		keyof TTools & string,
		keyof TEditorConfigs & string,
		TEditorConfigs[keyof TEditorConfigs & string]
	> = PaletteToolbarItemByEditor<TEditorConfigs, keyof TTools & string>,
> {
	/** The available points (definitions, no layout). */
	readonly tools: TTools
	/** The editor config payloads. */
	readonly editorConfigs: TEditorConfigs
	/** The toolbar item union. */
	readonly item: TItem
}

export type PaletteToolbarItemBase = Record<PropertyKey, unknown>

/**
 * String form used by toolbar items and key bindings to reference a point
 * (code name: tool spec).
 *
 * - `toolId` resolves the original point
 * - `toolId=value` builds a setter runner for editable points
 *   (`toolId|value` is the legacy spelling, still accepted)
 * - `toolId:action` builds an action runner such as `fontSize:inc`
 */
export type PaletteToolSpec<TTool extends string = string> =
	| TTool
	| `${TTool}=${string}`
	| `${TTool}|${string}`
	| `${TTool}:${string}`

/**
 * Toolbar item bound to a palette point (a tool), optionally selecting a
 * tool variant (code name: editor variant).
 */
export type PaletteToolToolbarItem<
	TTool extends string = string,
	TEditor extends string = string,
	TConfig = unknown,
> = PaletteToolbarItemBase & {
	/** The tool spec. */
	readonly tool: PaletteToolSpec<TTool>
	/** Optional editor variant. */
	editor?: TEditor
	/** Optional config payload. */
	config?: TConfig
}

export type PaletteEditorOnlyToolbarItem<
	TEditor extends string = string,
	TConfig = unknown,
> = PaletteToolbarItemBase & {
	/** No point is bound to this item (pointless tool). */
	readonly tool?: undefined
	/** The tool variant (code name: editor variant). */
	editor: TEditor
	/** Optional config payload. */
	config?: TConfig
}

/**
 * Union of tool-backed items and editor-only items.
 */
export type PaletteToolbarItem<
	TTool extends string = string,
	TEditor extends string = string,
	TConfig = unknown,
> = PaletteToolToolbarItem<TTool, TEditor, TConfig> | PaletteEditorOnlyToolbarItem<TEditor, TConfig>

/**
 * Toolbar item that opens a child toolbar track **perpendicular** to its parent.
 *
 * A drawer's child popup direction inverts its parent axis: a horizontal parent opens a vertical
 * popup, and vice versa, continuing at each nesting depth. The parent `PaletteScope` (containing
 * `palette` and `region`) must be propagated into the popup root so the child `Toolbar` can
 * resolve tools and nested drawers can read their own `surface.axis`.
 */
export type PaletteDrawerToolbarItem<TConfig = unknown> = PaletteToolbarItemBase & {
	/** The drawer editor type. */
	readonly editor: 'drawer'
	/** The child toolbar to display when the drawer is open. */
	readonly toolbar: PaletteToolbar
	/** Drawer configuration options. */
	config?: {
		/** Optional icon for the drawer trigger button. */
		readonly icon?: PaletteIcon
		/** Optional label for the drawer trigger button. */
		readonly label?: string
		/** Optional hint text (tooltip / aria-label when label is suppressed). */
		readonly hint?: string
		/** Optional tone for the drawer trigger button. */
		readonly tone?: string
		/** How the drawer opens. */
		readonly open?: 'click' | 'hover' | 'press'
		/** Placement of the drawer popup relative to the trigger element. */
		readonly placement?: 'start' | 'center' | 'end'
	} & TConfig
}

/**
 * State for a drawer toolbar item.
 *
 * Carries both the **parent** axis/region and the derived **child** axis (perpendicular to parent)
 * so nested drawer levels need not recompute direction from scratch.
 */
export type PaletteDrawerState = {
	/** The drawer toolbar item. */
	readonly item: PaletteDrawerToolbarItem
	/** The parent palette region where the drawer trigger lives. */
	readonly parentRegion: PaletteRegion
	/** The axis of the parent toolbar track. */
	readonly parentAxis: 'horizontal' | 'vertical'
	/** The axis of the child toolbar track (perpendicular to parent). */
	readonly childAxis: 'horizontal' | 'vertical'
	/** Whether the drawer is currently open. */
	open: boolean
}

export type PaletteToolbarItemByEditor<
	TEditors extends Record<string, unknown>,
	TTool extends string = string,
> = {
	[K in keyof TEditors & string]: PaletteToolbarItem<TTool, K, TEditors[K]>
}[keyof TEditors & string]

export type PaletteToolbar<TItem extends PaletteToolbarItem = PaletteToolbarItem> = TItem[]

/**
 * One linear track of toolbars separated by normalized spacing values.
 */
export type PaletteTrack<TItem extends PaletteToolbarItem = PaletteToolbarItem> = {
	/** The spacing value. */
	space: number
	/** The toolbar. */
	toolbar: PaletteToolbar<TItem>
}[]

/**
 * Stack of tracks mounted on a single IDE region.
 */
export type PaletteBorder<TItem extends PaletteToolbarItem = PaletteToolbarItem> =
	PaletteTrack<TItem>[]

/**
 * Named palette docking regions around an IDE surface.
 */
export type PaletteRegion = 'top' | 'right' | 'bottom' | 'left'

/**
 * Full border layout for a palette IDE.
 */
export type PaletteBorders<TItem extends PaletteToolbarItem = PaletteToolbarItem> = {
	[K in PaletteRegion]: PaletteBorder<TItem>
}

export type PaletteItem<TSchema extends PaletteSchema = PaletteSchema> = TSchema['item']
export type PaletteEditorConfigs<TSchema extends PaletteSchema = PaletteSchema> =
	TSchema['editorConfigs']
export type PaletteToolId<TSchema extends PaletteSchema = PaletteSchema> = keyof TSchema['tools'] &
	string
export type PaletteToolOf<TSchema extends PaletteSchema = PaletteSchema> = PaletteTool<
	TSchema['tools']
>
export type PaletteEditableToolOf<TSchema extends PaletteSchema = PaletteSchema> =
	PaletteEditableTool<TSchema['tools']>
export type PaletteToolFamilyOf<TSchema extends PaletteSchema = PaletteSchema> = PaletteToolFamily<
	TSchema['tools']
>
export type PaletteToolByFamilyOf<
	TSchema extends PaletteSchema = PaletteSchema,
	TFamily extends PaletteToolFamilyOf<TSchema> = PaletteToolFamilyOf<TSchema>,
> = PaletteToolByFamily<TSchema['tools'], TFamily>
export type PaletteEditableToolByFamilyOf<
	TSchema extends PaletteSchema = PaletteSchema,
	TFamily extends PaletteEditableToolOf<TSchema>['type'] = PaletteEditableToolOf<TSchema>['type'],
> = PaletteEditableToolByFamily<TSchema['tools'], TFamily>
export type PaletteToolItem<
	TSchema extends PaletteSchema = PaletteSchema,
	TFamily extends PaletteToolFamilyOf<TSchema> = PaletteToolFamilyOf<TSchema>,
> = {
	[K in PaletteToolId<TSchema>]: TSchema['tools'][K] extends PaletteToolByFamilyOf<TSchema, TFamily>
		? Extract<TSchema['item'], { tool: K }>
		: never
}[PaletteToolId<TSchema>]
export type PaletteEditorOnlyItem<TSchema extends PaletteSchema = PaletteSchema> = Extract<
	TSchema['item'],
	{ tool?: undefined }
>

export type PaletteOf<TSchema extends PaletteSchema = PaletteSchema> = Palette<TSchema>

/**
 * One selectable editor variant for an item's configuration surface.
 *
 * Computed by `describeItemConfiguration`; also injected into the configurator
 * scope as `editorChoices` (see `PaletteScope`).
 */
export type PaletteEditorChoice = {
	readonly id: string
	readonly label: string
	readonly selected: boolean
}

/**
 * Rendering scope shared across palette editors and layout components.
 *
 * `palette` / `region` are the typed core; the index signature preserves
 * parity with `@sursaut/ui/palette` (whose JSX factories accepted arbitrary
 * extra scope entries). Prefer the typed fields over spread-by-convention:
 * read `editorChoices` via `describeItemConfiguration` (or the
 * `resolveConfiguratorScope` helper) instead of inventing new keys.
 *
 * When a drawer editor creates a portal, `palette` and `region` must be propagated to the new root
 * scope so the child `Toolbar` can resolve tools and nested drawers receive a valid `surface.axis`.
 * The record is the serializable payload passed through `mount` props to the portal root.
 */
export type PaletteScope<TSchema extends PaletteSchema = PaletteSchema> = Record<
	string,
	unknown
> & {
	/** The palette instance. */
	palette?: Palette<TSchema>
	/** The docking region. */
	region?: PaletteRegion
	/**
	 * Computed editor choices for the current item, injected by
	 * `resolveConfiguratorScope` (sursaut's `augmentedScope`).
	 * Present on configurator scopes; absent elsewhere.
	 */
	editorChoices?: readonly PaletteEditorChoice[]
}

export type PaletteEditorFootprint = 'square' | 'free' | 'horizontal' | 'vertical'

/**
 * Optional layout hints declared by an editor implementation.
 */
export interface PaletteEditorFlags {
	/** The footprint hint. */
	readonly footprint?: PaletteEditorFootprint
}

// ── Surface Context ──

/**
 * Axis constraint for palette surface orientation.
 *
 * - `'horizontal'` — items laid out left-to-right (top/bottom toolbar borders)
 * - `'vertical'` — items laid out top-to-bottom (left/right toolbar borders)
 * - `'both'` — no constraint (used for editor capability declarations)
 */
export type PaletteSurfaceAxis = 'horizontal' | 'vertical' | 'both'

/**
 * Context describing the surface where an item is rendered.
 *
 * `axis` is derived from `PaletteScope.region`: `top`/`bottom` → `horizontal`,
 * `left`/`right` → `vertical`, `undefined` → `horizontal` (default). Drawer editors must
 * **invert** this axis for their child toolbar direction.
 */
export type PaletteSurfaceContext = {
	readonly axis: PaletteSurfaceAxis
	readonly region?: PaletteRegion
}

// ── Editor Capability ──

/**
 * Descriptor for an editor variant's capabilities.
 *
 * Used to compute which editor choices are valid for a given item and surface.
 */
export type PaletteEditorCapability = {
	readonly id: string
	readonly label: string
	readonly families: readonly PaletteToolFamily[]
	readonly supportedAxes?: PaletteSurfaceAxis
	readonly compact?: boolean
	readonly inline?: boolean
	readonly requiresConfigSurface?: boolean
	readonly hidden?: boolean
	readonly accepts?: (props: {
		readonly palette: Palette
		readonly item: PaletteToolbarItem
		readonly tool: PaletteTool | undefined
		readonly surface: PaletteSurfaceContext
	}) => boolean
}

/**
 * Context received by palette tools (toolbar components) and editors
 * (configuration panels).
 */
export interface PaletteEditorContext<
	TTool extends PaletteAnyTool | undefined = PaletteAnyTool | undefined,
	TItem extends PaletteToolbarItem = PaletteToolbarItem,
	TSchema extends PaletteSchema = PaletteSchema,
> {
	/** The toolbar item. */
	readonly item: TItem
	/** The tool instance. */
	readonly tool: TTool
	/** The rendering scope. */
	readonly scope: PaletteScope<TSchema>
	/** The layout hints. */
	readonly flags: PaletteEditorFlags
	/** The surface context (axis and region) for axis-aware configuration. */
	readonly surface?: PaletteSurfaceContext
}

/**
 * Tool render component for a palette toolbar item — a Svelte component that receives a
 * `context` prop of type {@link PaletteEditorContext} (code name: editor component).
 */
export type PaletteEditorComponent<
	TTool extends PaletteAnyTool | undefined = PaletteAnyTool | undefined,
	TItem extends PaletteToolbarItem = PaletteToolbarItem,
	TSchema extends PaletteSchema = PaletteSchema,
> = Component<{ context: PaletteEditorContext<TTool, TItem, TSchema> }>

/**
 * Optional tool configuration-panel renderer — a Svelte component receiving a
 * `context` prop of type {@link PaletteEditorContext} (code name: configurator
 * component). Rendered in the console *Details* panel, never on the toolbar.
 */
export type PaletteConfiguratorComponent<
	TTool extends PaletteAnyTool | undefined = PaletteAnyTool | undefined,
	TItem extends PaletteToolbarItem = PaletteToolbarItem,
	TSchema extends PaletteSchema = PaletteSchema,
> = Component<{ context: PaletteEditorContext<TTool, TItem, TSchema> }>

/**
 * Registered tool variant for a point family or pointless item kind
 * (code name: editor spec): the toolbar component (`.editor`, i.e. the tool)
 * plus its configuration panel (`.configure`, i.e. the editor).
 */
export interface PaletteEditorSpec<
	TTool extends PaletteAnyTool | undefined = PaletteAnyTool | undefined,
	TItem extends PaletteToolbarItem = PaletteToolbarItem,
	TSchema extends PaletteSchema = PaletteSchema,
> {
	/** The editor render component. */
	readonly editor: PaletteEditorComponent<TTool, TItem, TSchema>
	/** Optional configurator render component. */
	readonly configure?: PaletteConfiguratorComponent<TTool, TItem, TSchema>
	/** Optional layout hints. */
	readonly flags?: PaletteEditorFlags
}

/**
 * Registry of tool variants for a specific point family (code name:
 * editor family registry).
 */
export type PaletteEditorFamilyRegistry<
	TSchema extends PaletteSchema = PaletteSchema,
	TFamily extends PaletteToolFamilyOf<TSchema> = PaletteToolFamilyOf<TSchema>,
> = Record<
	string,
	PaletteEditorSpec<
		PaletteToolByFamilyOf<TSchema, TFamily>,
		PaletteToolItem<TSchema, TFamily>,
		TSchema
	>
>

/**
 * Registry for pointless tools that bind no point (code name: editor-only
 * registry).
 */
export type PaletteEditorOnlyRegistry<TSchema extends PaletteSchema = PaletteSchema> = Record<
	string,
	PaletteEditorSpec<undefined, PaletteEditorOnlyItem<TSchema>, TSchema>
>

/**
 * Complete tool registry keyed first by point family, then by tool variant
 * name (code name: editor registry).
 */
export type PaletteEditorRegistry<TSchema extends PaletteSchema = PaletteSchema> = {
	[K in PaletteToolFamilyOf<TSchema>]?: PaletteEditorFamilyRegistry<TSchema, K>
} & {
	item?: PaletteEditorOnlyRegistry<TSchema>
}

/**
 * Runtime configuration used to construct a `Palette` instance.
 * `tools` holds the point definitions (no layout); `editors` maps each
 * family to its toolbar tool variants; `editorDefaults` picks the tool variant
 * when an item omits `editor`.
 */
export interface PaletteConfig<TSchema extends PaletteSchema = PaletteSchema> {
	/** The available points (definitions, no layout). */
	readonly tools: TSchema['tools']
	/**
	 * Keyboard bindings: either a raw `{ keystroke: toolSpec }` map (normalized
	 * internally via `createPaletteKeys`) or a prebuilt `PaletteKeys` registry.
	 */
	readonly keys: PaletteKeys | PaletteKeyBindings
	/** Whether the palette is editable. */
	readonly editable?: boolean
	/** The tool registry (family → tool variant). */
	readonly editors?: PaletteEditorRegistry<TSchema>
	/** Default tool variants for each action/option family. */
	readonly editorDefaults?: Partial<Record<PaletteToolFamilyOf<TSchema>, string>>
	/** Optional tool render function (fallback when no registry entry matches). */
	readonly editor?: (
		item: PaletteItem<TSchema>,
		tool: PaletteToolOf<TSchema> | undefined,
		scope: PaletteScope<TSchema>
	) => PaletteEditorComponent<PaletteToolOf<TSchema> | undefined, PaletteItem<TSchema>, TSchema>
	/** Optional configurator render function (fallback). */
	readonly configurator?: (
		item: PaletteItem<TSchema>,
		tool: PaletteToolOf<TSchema> | undefined,
		scope: PaletteScope<TSchema>
	) =>
		| PaletteConfiguratorComponent<
				PaletteToolOf<TSchema> | undefined,
				PaletteItem<TSchema>,
				TSchema
		  >
		| undefined
	/** Optional runner factory for creating tool runners. */
	readonly runner?: <TTool extends PaletteEditableToolOf<TSchema>>(
		runner: PaletteToolRun,
		from: TTool,
		spec: string
	) => PaletteToolRun
	/** Optional setter factory for creating tool setters. */
	readonly setter?: <TTool extends PaletteEditableToolOf<TSchema>>(
		runner: PaletteToolRun,
		from: TTool,
		value: TTool['value']
	) => PaletteToolRun
	/** Optional editor capability descriptors for computing available editor choices. */
	readonly editorCapabilities?: Record<string, PaletteEditorCapability>
}

// ── Configuration Descriptors ──

/**
 * Runtime reference to a configured toolbar item.
 */
export type PaletteConfiguredItemTarget = {
	readonly toolbar: PaletteToolbar
	readonly item: PaletteToolbarItem
	readonly index: number
	readonly region?: PaletteRegion
}

/**
 * Structural actions available for a toolbar item.
 */
export type PaletteItemStructureSection = {
	readonly moveBackward?: { readonly enabled: boolean }
	readonly moveForward?: { readonly enabled: boolean }
	readonly moveTargets?: readonly {
		readonly toolbar: PaletteToolbar
		readonly label: string
	}[]
	readonly removable?: boolean
}

/**
 * Presentation choices available for a toolbar item.
 */
export type PaletteItemPresentationSection = {
	readonly currentEditor?: string
	readonly editorChoices: readonly PaletteEditorChoice[]
	readonly showText?: {
		readonly value: boolean
		readonly enabled: boolean
	}
	readonly compact?: {
		readonly value: boolean
		readonly enabled: boolean
	}
}

/**
 * Keyboard binding information for a toolbar item.
 */
export type PaletteItemBindingSection = {
	readonly shortcut?: string
	readonly editable?: boolean
}

/**
 * Complete headless descriptor for an item's configuration surface.
 *
 * Computed by `describeItemConfiguration`. Adapters render this as UI; the palette owns the
 * semantics.
 */
export type PaletteItemConfigurationDescriptor = {
	readonly target: PaletteConfiguredItemTarget
	readonly surface: PaletteSurfaceContext
	readonly title: string
	readonly subtitle?: string
	readonly structure: PaletteItemStructureSection
	readonly presentation: PaletteItemPresentationSection
	readonly bindings?: PaletteItemBindingSection
}

/**
 * Documented contract for palette item movement.
 *
 * - `drop-only`: items move only on drop release (no hover preview)
 * - `preview-only`: hover shows visual preview but does not commit
 * - `commit`: hover commits the move immediately (with optional revert)
 */
export type PaletteItemMoveContract = 'drop-only' | 'preview-only' | 'commit'

export interface PaletteBase {
	/** The palette ID. */
	readonly id: string
	/** Dispose of the palette instance. */
	dispose(): void
}

/**
 * Runtime palette object used by the layout components and command helpers.
 */
export interface Palette<TSchema extends PaletteSchema = PaletteSchema> {
	/** The palette ID. */
	readonly id: string
	/** The runtime configuration. */
	readonly config: PaletteConfig<TSchema>
	/** The available points (definitions, no layout). */
	readonly tools: TSchema['tools']
	/** The keyboard bindings. */
	readonly keys: PaletteKeys
	/** The tool registry (family → tool variant). */
	readonly editors?: PaletteEditorRegistry<TSchema>
	/** Default tool variants for each point family. */
	readonly editorDefaults?: Partial<Record<PaletteToolFamilyOf<TSchema>, string>>
	/** Optional tool render function. */
	readonly editor?: PaletteConfig<TSchema>['editor']
	/** Optional configurator render function. */
	readonly configurator?: PaletteConfig<TSchema>['configurator']
	/** Optional runner factory for creating tool runners. */
	readonly runner?: PaletteConfig<TSchema>['runner']
	/** Optional setter factory for creating tool setters. */
	readonly setter?: PaletteConfig<TSchema>['setter']
	/** Whether the palette is currently editing. */
	readonly editing: boolean
	/** Resolve a tool spec to a tool instance. */
	tool(spec: string): PaletteToolOf<TSchema>
	/** Resolve an editor for a given item and tool. */
	resolveEditor<
		TTool extends PaletteToolOf<TSchema> | undefined,
		TItem extends PaletteItem<TSchema>,
	>(item: TItem, tool: TTool): PaletteEditorSpec<TTool, TItem, TSchema> | undefined
	/** Render an editor for a given item and tool. */
	renderEditor<
		TTool extends PaletteToolOf<TSchema> | undefined,
		TItem extends PaletteItem<TSchema>,
	>(
		item: TItem,
		tool: TTool,
		scope: PaletteScope<TSchema>
	): PaletteEditorComponent<TTool, TItem, TSchema>
	/** Render a configurator for a given item and tool. */
	renderConfigurator<
		TTool extends PaletteToolOf<TSchema> | undefined,
		TItem extends PaletteItem<TSchema>,
	>(
		item: TItem,
		tool: TTool,
		scope: PaletteScope<TSchema>
	): PaletteConfiguratorComponent<TTool, TItem, TSchema> | undefined
	/**
	 * Compute the augmented configurator scope (sursaut's `augmentedScope`):
	 * `scope` plus `editorChoices` for the item.
	 */
	resolveConfiguratorScope<TItem extends PaletteItem<TSchema>>(
		item: TItem,
		scope: PaletteScope<TSchema>
	): PaletteScope<TSchema>
	/**
	 * Build the `context` prop an adapter binds when rendering an editor or
	 * configurator component.
	 */
	resolveEditorContext<
		TTool extends PaletteToolOf<TSchema> | undefined,
		TItem extends PaletteItem<TSchema>,
	>(
		item: TItem,
		tool: TTool,
		scope: PaletteScope<TSchema>,
		flags?: PaletteEditorFlags
	): PaletteEditorContext<TTool, TItem, TSchema>
	/**
	 * Build the `context` prop for a configurator component.
	 *
	 * Same shape as `resolveEditorContext`, but `scope` is the augmented
	 * configurator scope (with `editorChoices` injected). Adapters render
	 * `renderConfigurator`'s returned component with this context.
	 */
	resolveConfiguratorContext<
		TTool extends PaletteToolOf<TSchema> | undefined,
		TItem extends PaletteItem<TSchema>,
	>(
		item: TItem,
		tool: TTool,
		scope: PaletteScope<TSchema>,
		flags?: PaletteEditorFlags
	): PaletteEditorContext<TTool, TItem, TSchema>
	/**
	 * Compute a headless configuration descriptor for a toolbar item.
	 *
	 * Adapters consume this descriptor to render item configuration UI.
	 * The palette owns the semantics; adapters own the rendering.
	 */
	describeItemConfiguration(
		target: PaletteConfiguredItemTarget,
		surface: PaletteSurfaceContext
	): PaletteItemConfigurationDescriptor
	/** Dispose of the palette instance. */
	dispose(): void
}

/**
 * Origin of the dragged tools before they were picked up.
 *
 * An instantiated tool is `tool + editor + config + position`: the same
 * tool+config object must never live in two containers at once (single
 * ownership). Every drag source therefore carries its container, so the
 * "dragged tools are the ones in this toolbar?" question can never confuse
 * two containers holding structurally identical items.
 *
 * - `border` — a toolbar living in an IDE border track.
 * - `parking` — a toolbar living in the independent parking stack.
 *
 * `track`/`border` (or `parking`/`index`) are only needed to prune the origin
 * when it empties; they're refreshed after each commit so subsequent DZ
 * hovers always move from the current location.
 */
export type PaletteDragOrigin =
	| {
			/** Border container discriminator. */
			kind: 'border'
			/** The toolbar the dragged tools came from. */
			toolbar: PaletteToolbar
			/** The track that toolbar was in. */
			track: PaletteTrack
			/** The border that track was in. */
			border: PaletteBorder
	  }
	| {
			/** Parking container discriminator. */
			kind: 'parking'
			/** The toolbar the dragged tools came from. */
			toolbar: PaletteToolbar
			/** The parking stack that toolbar lives in. */
			parking: PaletteParking
			/** Index of the toolbar within the parking stack. */
			index: number
	  }

/** A toolbar living in a border track (with its track + border). */
export type PaletteBorderLocation = Extract<PaletteDragOrigin, { kind: 'border' }>

/** A toolbar living in the parking stack (with its stack index). */
export type PaletteParkingLocation = Extract<PaletteDragOrigin, { kind: 'parking' }>

/**
 * Wherever a toolbar can live: a border track or the parking stack.
 * Used by view predicates (`isDraggedToolbar`) so the same toolbar object
 * rendered in two places can never match both.
 */
export type PaletteToolbarLocation = PaletteDragOrigin

/**
 * What the drag selection means right now, derived and cached.
 *
 * Ask *"is there anything else than my dragged tools left in my toolbar?"*
 *
 * - **no** → `'slide'`: the selection is the toolbar's entire content, so the
 *   toolbar itself is what moves. Track gaps flanking it are "keep moving",
 *   not a destination. This holds whether the grab was a whole toolbar or a
 *   single tool that happens to be its only item.
 * - **yes** → `'restructure'`: the tools are a subset, so the origin toolbar
 *   stays behind and the selection is being restructured — a track-gap commit
 *   extracts the tools into a fresh singleton toolbar.
 *
 * The mode is recomputed after every structural commit, never re-derived per
 * pointer move. That is what makes the gap commit idempotent *and* what stops
 * slide-follow the instant a merge turns the selection back into a subset.
 * Without a recorded mode, a drag that started inside a multi-tool toolbar
 * reads as "partial" forever and each new gap hover builds *another* toolbar
 * holding the same tools.
 */
export type PaletteDragMode = 'restructure' | 'slide'

/**
 * Simulated drag session state.
 *
 * Centralised on `palettes.dragging`: a click on a tool selects that single
 * tool, a click on a toolbar selects its whole content. Hovering a free DZ
 * commits the move immediately (the dragged tools are transferred from their
 * origin to the landing spot) so the DOM updates and re-highlighting follows.
 */
export interface PaletteDragging<TPalette extends Palette = Palette> {
	/** The palette instance. */
	palette: TPalette
	/** The selected tools (single tool click, or whole toolbar content). */
	tools: PaletteToolbarItem[]
	/** Where the dragged tools currently live. Updated after each commit. */
	origin: PaletteDragOrigin
	/**
	 * What the selection means right now (see `PaletteDragMode`). Recomputed
	 * after every structural commit: a subset selection is `'restructure'`,
	 * the full content of a toolbar is `'slide'`.
	 */
	mode: PaletteDragMode
	/**
	 * Pixel grab offset of the cursor within the dragged toolbar, axis-agnostic.
	 *
	 * Captured once on mousedown (`toolbarGrabOffset`); preserved across
	 * track/border moves so a relocated toolbar keeps the same delta even
	 * when the axis changes (x becomes y). Absent for a restructure drag whose
	 * toolbar does not exist yet: the first placement recenters it to half the
	 * fresh toolbar's size (the caller measures the DOM element).
	 */
	grabOffset?: number
}

/**
 * Independent parking stack: toolbars parked outside the IDE borders.
 *
 * Parking is NOT a view over a border — it owns its toolbars outright
 * (single ownership: a toolbar/item object lives in exactly one container).
 * It is a plain `Stack<Toolbar>`: each entry is a full toolbar so parking
 * rows reuse the same `Toolbar` renderer and drag engine as borders, scoped
 * by the `parking` origin kind. Its stack gaps are highlight-only — drops
 * land via the toolbar item-space DZs, never by hovering a gap.
 */
export type PaletteParking<TItem extends PaletteToolbarItem = PaletteToolbarItem> =
	PaletteToolbar<TItem>[]

/**
 * Serialized parking row: one toolbar's items.
 */
export type SerializedParkingToolbar = readonly {
	readonly tool?: string
	readonly editor?: string
	readonly config?: Record<string, unknown>
}[]

/**
 * Serialized palette layout for persistence.
 *
 * Unlike the runtime `PaletteBorders` (object identity + reactive arrays), this format uses plain
 * JSON-serializable structures.
 */
export type SerializedPaletteLayout = {
	/** The serialization format version. */
	readonly version: 1
	/** The border layout for each palette region. */
	readonly borders: Record<
		PaletteRegion,
		readonly {
			/** The spacing value for this track. */
			readonly space: number
			/** The toolbar items in this track. */
			readonly toolbar: readonly {
				/** The tool spec (e.g. "toolId", "toolId|value", "toolId:action"). */
				readonly tool?: string
				/** The editor variant. */
				readonly editor?: string
				/** Optional config payload. */
				readonly config?: Record<string, unknown>
			}[]
		}[]
	>
	/** Optional parking area: independent stack of toolbars, persisted. */
	readonly parking?: readonly SerializedParkingToolbar[]
}
