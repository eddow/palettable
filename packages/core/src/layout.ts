/**
 * `@palettable/core` — layout: borders / tracks / toolbars / items (pure data).
 *
 * The core manages the hierarchical structure as plain data. Adapters perform
 * drag math / hit testing / pointer handling, then commit results through the
 * structural methods (`moveItem`, `moveToolbar`, …). Every mutation emits a
 * fresh `SerializedLayout` snapshot. Zero DOM.
 */
import { PaletteError } from './errors.js'
import { scheduleMicrotask } from './globals.js'
import type { IconToken, Unsubscribe } from './identifiers.js'
import type { PointSpec } from './specs.js'

/** Listener invoked with a fresh layout snapshot after each structural mutation. */
export type LayoutListener = (snapshot: SerializedLayout) => void

/** Named docking regions around an IDE surface. */
export type PaletteRegion = 'top' | 'right' | 'bottom' | 'left'

/** Axis constraint for a surface. `'both'` is for capability declarations only. */
export type SurfaceAxis = 'horizontal' | 'vertical' | 'both'

/** Where an item is rendered. Adapters derive `axis` from `region`. */
export type SurfaceContext = {
	readonly axis: SurfaceAxis
	readonly region?: PaletteRegion
}

/** Toolbar item bound to a point (a tool). `editor` is a variant id, `config` opaque. */
export type ToolToolbarItem<TPoint extends string = string, TEditor extends string = string> = {
	readonly tool: PointSpec<TPoint>
	editor?: TEditor
	config?: Record<string, unknown>
}

/** Pointless item: binds no point (`status`, `command-box`, … — except `drawer`, see below). */
export type PointlessToolbarItem<TEditor extends string = string> = {
	readonly tool?: undefined
	editor: TEditor
	config?: Record<string, unknown>
}

/**
 * Drawer item — a pointless tool carrying a nested toolbar.
 * The child toolbar renders **perpendicular** to its parent (enforced by adapters).
 */
export type DrawerToolbarItem<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
	readonly tool?: undefined
	readonly editor: 'drawer'
	readonly toolbar: ToolbarItem[]
	config?: {
		readonly icon?: IconToken
		readonly label?: string
		readonly hint?: string
		readonly tone?: string
		readonly open?: 'click' | 'hover' | 'press'
		readonly placement?: 'start' | 'center' | 'end'
	} & TConfig
}

/** Any item that can live in a toolbar. */
export type ToolbarItem<TPoint extends string = string, TEditor extends string = string> =
	| ToolToolbarItem<TPoint, TEditor>
	| PointlessToolbarItem<TEditor>
	| DrawerToolbarItem

export type Toolbar<TPoint extends string = string, TEditor extends string = string> = ToolbarItem<
	TPoint,
	TEditor
>[]

/** One linear track: toolbars separated by a normalized spacing value. */
export type TrackSlot<TPoint extends string = string, TEditor extends string = string> = {
	space: number
	toolbar: Toolbar<TPoint, TEditor>
}

/** One linear track: an ordered list of toolbar slots. */
export type Track<TPoint extends string = string, TEditor extends string = string> = TrackSlot<
	TPoint,
	TEditor
>[]

export type Border<TPoint extends string = string, TEditor extends string = string> = Track<
	TPoint,
	TEditor
>[]

export type Borders<TPoint extends string = string, TEditor extends string = string> = Record<
	PaletteRegion,
	Border<TPoint, TEditor>
>

/** Independent parking stack: toolbars parked outside the borders. */
export type Parking<TPoint extends string = string, TEditor extends string = string> = Toolbar<
	TPoint,
	TEditor
>[]

export type PaletteLayout<TPoint extends string = string, TEditor extends string = string> = {
	borders: Borders<TPoint, TEditor>
	parking: Parking<TPoint, TEditor>
}

// ── Serialized layout (JSON-safe persistence) ───────────────────────────────

export type SerializedToolbarItem = {
	readonly tool?: string
	readonly editor?: string
	readonly config?: Record<string, unknown>
	readonly toolbar?: readonly SerializedToolbarItem[]
}

export type SerializedLayout = {
	readonly version: 1
	readonly borders: Record<
		PaletteRegion,
		readonly {
			readonly space: number
			readonly toolbar: readonly SerializedToolbarItem[]
		}[]
	>
	readonly parking?: readonly (readonly SerializedToolbarItem[])[]
}

/** Build a trivial initial layout: one toolbar per region holding every point id. */
export function defaultLayoutFromPoints(pointIds: readonly string[]): SerializedLayout {
	const toolbar = pointIds.map((tool) => ({ tool }) as SerializedToolbarItem)
	return {
		version: 1,
		borders: {
			top: toolbar.length > 0 ? [{ space: 1, toolbar }] : [],
			right: [],
			bottom: [],
			left: [],
		},
		parking: [],
	}
}

// ── Structural locators (abstract ids, no coordinates) ──────────────────────

export type BorderToolbarLocation = {
	readonly container: 'border'
	readonly region: PaletteRegion
	readonly trackIndex: number
	readonly toolbarIndex: number
}

export type ParkingToolbarLocation = {
	readonly container: 'parking'
	readonly toolbarIndex: number
}

export type ToolbarLocation = BorderToolbarLocation | ParkingToolbarLocation

export type ItemLocation = ToolbarLocation & { readonly itemIndex: number }

/**
 * Pure-data layout tree. Adapters perform drag math / hit testing, then commit
 * results here through structural methods. Every mutation emits a fresh
 * `SerializedLayout` snapshot to `subscribe()` listeners.
 */
export class PaletteLayoutTree {
	private layout: PaletteLayout
	private listeners = new Set<LayoutListener>()

	constructor(initial?: SerializedLayout | PaletteLayout) {
		this.layout = initial === undefined ? emptyLayout() : toPaletteLayout(initial)
	}

	/** Deep-cloned live layout (mutating the result never touches the tree). */
	getLayout(): PaletteLayout {
		return clonePaletteLayout(this.layout)
	}

	/** JSON-safe snapshot for persistence or adapter sync. */
	getSnapshot(): SerializedLayout {
		return snapshotLayout(this.layout)
	}

	/** Replace the whole layout (e.g. hydrate from storage). Always emits. */
	setLayout(next: SerializedLayout | PaletteLayout): void {
		this.layout = toPaletteLayout(next)
		this.emit()
	}

	/** Move an item between (or within) toolbars. Prunes toolbars emptied by the move. */
	moveItem(from: ItemLocation, to: ItemLocation): void {
		const source = this.toolbarAt(from)
		const target = this.toolbarAt(to)
		if (source === undefined || target === undefined)
			throw new PaletteError(`moveItem: unknown location`)
		const [item] = source.splice(from.itemIndex, 1)
		if (item === undefined)
			throw new PaletteError(`moveItem: item index ${from.itemIndex} out of bounds`)
		const insertAt =
			sameToolbar(from, to) && to.itemIndex > from.itemIndex ? to.itemIndex - 1 : to.itemIndex
		target.splice(insertAt, 0, item)
		this.pruneEmptyToolbar(from)
		this.emit()
	}

	/** Relocate a whole toolbar (identity preserved) across tracks / parking. */
	moveToolbar(from: ToolbarLocation, to: ToolbarLocation): void {
		const toolbar = this.removeToolbarAt(from)
		if (toolbar === undefined) throw new PaletteError(`moveToolbar: unknown location`)
		this.insertToolbarAt(to, toolbar)
		this.emit()
	}

	/** Insert an item at a location (adapter drop / console add-flow). */
	insertItem(at: ItemLocation, item: ToolbarItem): void {
		const toolbar = this.toolbarAt(at)
		if (toolbar === undefined) throw new PaletteError(`insertItem: unknown location`)
		toolbar.splice(at.itemIndex, 0, item)
		this.emit()
	}

	/** Remove an item (adapter delete-flow; drag uses `moveItem`). */
	removeItem(at: ItemLocation): ToolbarItem {
		const toolbar = this.toolbarAt(at)
		const [item] = toolbar?.splice(at.itemIndex, 1) ?? []
		if (toolbar === undefined || item === undefined)
			throw new PaletteError(`removeItem: unknown location`)
		this.pruneEmptyToolbar(at)
		this.emit()
		return item
	}

	subscribe(listener: LayoutListener): Unsubscribe {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	/** Remove all layout listeners (adapter teardown). Layout is kept. */
	clearListeners(): void {
		this.listeners.clear()
	}

	private toolbarAt(location: ToolbarLocation): Toolbar | undefined {
		if (location.container === 'parking') return this.layout.parking[location.toolbarIndex]
		return this.layout.borders[location.region][location.trackIndex]?.[location.toolbarIndex]
			?.toolbar
	}

	private removeToolbarAt(location: ToolbarLocation): Toolbar | undefined {
		if (location.container === 'parking') {
			const [toolbar] = this.layout.parking.splice(location.toolbarIndex, 1)
			return toolbar
		}
		const border = this.layout.borders[location.region]
		const track = border[location.trackIndex]
		const [slot] = track?.splice(location.toolbarIndex, 1) ?? []
		if (track !== undefined && track.length === 0) {
			border.splice(location.trackIndex, 1)
		}
		return slot?.toolbar
	}

	private insertToolbarAt(location: ToolbarLocation, toolbar: Toolbar): void {
		if (location.container === 'parking') {
			this.layout.parking.splice(location.toolbarIndex, 0, toolbar)
			return
		}
		const border = this.layout.borders[location.region]
		let track = border[location.trackIndex]
		if (track === undefined) {
			track = []
			border.splice(location.trackIndex, 0, track)
		}
		track.splice(location.toolbarIndex, 0, { space: 1, toolbar })
	}

	private pruneEmptyToolbar(location: ToolbarLocation): void {
		if (location.container === 'parking') {
			if (this.layout.parking[location.toolbarIndex]?.length === 0) {
				this.layout.parking.splice(location.toolbarIndex, 1)
			}
			return
		}
		const border = this.layout.borders[location.region]
		const track = border[location.trackIndex]
		if (track?.[location.toolbarIndex]?.toolbar.length === 0) {
			track.splice(location.toolbarIndex, 1)
			if (track.length === 0) border.splice(location.trackIndex, 1)
		}
	}

	private emit(): void {
		const snapshot = this.getSnapshot()
		for (const listener of [...this.listeners]) {
			try {
				listener(snapshot)
			} catch (error) {
				scheduleMicrotask(() => {
					throw error
				})
			}
		}
	}
}

function sameToolbar(a: ItemLocation, b: ItemLocation): boolean {
	if (a.container !== b.container) return false
	if (a.container === 'parking' && b.container === 'parking')
		return a.toolbarIndex === b.toolbarIndex
	if (a.container === 'border' && b.container === 'border')
		return (
			a.region === b.region && a.trackIndex === b.trackIndex && a.toolbarIndex === b.toolbarIndex
		)
	return false
}

function emptyLayout(): PaletteLayout {
	return { borders: { top: [], right: [], bottom: [], left: [] }, parking: [] }
}

/**
 * Normalize a serialized layout into a live `PaletteLayout` (deep clone).
 *
 * NOTE (compat): the serialized form is flat per region (one slot list —
 * track boundaries are not persisted, mirroring the Svelte adapter's
 * `serializePaletteLayout`). Hydration wraps each slot in its own
 * single-slot track, exactly like the adapter's `hydratePaletteLayout`.
 */
function fromSerializedLayout(layout: SerializedLayout): PaletteLayout {
	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	const borders = {} as PaletteLayout['borders']
	for (const region of regions) {
		const slots = layout.borders[region]
		borders[region] = slots.map((slot) => [
			{
				space: slot.space,
				toolbar: slot.toolbar.map(hydrateItem),
			},
		])
	}
	return {
		borders,
		parking: (layout.parking ?? []).map((toolbar) => toolbar.map(hydrateItem)),
	}
}

/** Type guard: serialized layouts carry a `version: 1` marker; live layouts don't. */
function isSerializedLayout(layout: SerializedLayout | PaletteLayout): layout is SerializedLayout {
	return (layout as SerializedLayout).version === 1
}

/** Normalize either layout form into a live `PaletteLayout` (deep clone). */
function toPaletteLayout(layout: SerializedLayout | PaletteLayout): PaletteLayout {
	if (!isSerializedLayout(layout)) return clonePaletteLayout(layout)
	return fromSerializedLayout(layout)
}

function hydrateItem(item: SerializedToolbarItem): ToolbarItem {
	if (item.toolbar !== undefined) {
		return {
			editor: 'drawer',
			config: item.config,
			toolbar: item.toolbar.map(hydrateItem),
		} as DrawerToolbarItem
	}
	if (item.tool === undefined) return { editor: item.editor ?? 'status', config: item.config }
	return { tool: item.tool, editor: item.editor, config: item.config }
}

function clonePaletteLayout(layout: PaletteLayout): PaletteLayout {
	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	const borders = {} as PaletteLayout['borders']
	for (const region of regions) {
		borders[region] = layout.borders[region].map((track) =>
			track.map((slot) => ({ space: slot.space, toolbar: slot.toolbar.map(cloneItem) }))
		)
	}
	return {
		borders,
		parking: layout.parking.map((toolbar) => toolbar.map(cloneItem)),
	}
}

function cloneItem(item: ToolbarItem): ToolbarItem {
	if (isDrawerItem(item)) {
		return {
			editor: 'drawer',
			config: item.config === undefined ? undefined : { ...item.config },
			toolbar: item.toolbar.map(cloneItem),
		} as DrawerToolbarItem
	}
	if (item.tool === undefined)
		return {
			editor: item.editor,
			config: item.config === undefined ? undefined : { ...item.config },
		}
	return {
		tool: item.tool,
		editor: item.editor,
		config: item.config === undefined ? undefined : { ...item.config },
	}
}

function snapshotLayout(layout: PaletteLayout): SerializedLayout {
	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	const borders = {} as SerializedLayout['borders']
	for (const region of regions) {
		// Flat slot list (mirrors the Svelte adapter's `serializePaletteLayout`:
		// `flatMap` over tracks). Track boundaries are not persisted.
		borders[region] = layout.borders[region].flatMap((track) =>
			track.map((slot) => ({
				space: slot.space,
				toolbar: slot.toolbar.map(serializeItem),
			}))
		)
	}
	return {
		version: 1,
		borders,
		parking: layout.parking.map((toolbar) => toolbar.map(serializeItem)),
	}
}

function serializeItem(item: ToolbarItem): SerializedToolbarItem {
	if (isDrawerItem(item))
		return { editor: 'drawer', config: item.config, toolbar: item.toolbar.map(serializeItem) }
	return { tool: (item as ToolToolbarItem).tool, editor: item.editor, config: item.config }
}

/** Null-safe drawer guard (a drawer is pointless + carries a nested toolbar). */
export function isDrawerItem(item: ToolbarItem | null | undefined): item is DrawerToolbarItem {
	return (
		item != null &&
		(item as DrawerToolbarItem).editor === 'drawer' &&
		Array.isArray((item as DrawerToolbarItem).toolbar)
	)
}
