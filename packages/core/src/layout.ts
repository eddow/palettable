/**
 * `@palettable/core` — layout: borders / tracks / toolbars / items (pure data).
 *
 * The core manages the hierarchical structure as plain data. Adapters perform
 * drag math / hit testing / pointer handling, then commit results through the
 * structural methods (`moveItem`, `moveToolbar`, …). Every mutation emits a
 * fresh `SerializedLayout` snapshot. Zero DOM.
 */

import { configuration } from './configuration.js'
// One-way: `drag.ts` takes the engine by injection (see `DragEngine`), so it
// never imports this module at runtime and there is no cycle.
import { createToolbarDrag, type GrabTarget, type ToolbarDrag } from './drag.js'
import { PaletteError } from './errors.js'
import { cloneValue, scheduleMicrotask } from './globals.js'
import type { IconToken, Unsubscribe } from './identifiers.js'
import { canonicalSpecId, isInlineSpec, type PointTarget } from './specs.js'

/** Listener invoked with a fresh layout snapshot after each structural mutation. */
export type LayoutListener = (snapshot: SerializedLayout) => void

/** Prune victim of a structural mutation: what was removed and where it lived. */
export type LayoutPruneVictim = {
	readonly kind: 'toolbar' | 'track' | 'row'
	readonly toolbar: Toolbar
	readonly from: ToolbarLocation
}

/** Op descriptor emitted per structural mutation (feeds the adapter node map). */
export type LayoutOp =
	| {
			readonly kind: 'move-item'
			readonly item: ToolbarItem
			readonly from: ItemLocation
			readonly to: ItemLocation
			readonly pruned: readonly LayoutPruneVictim[]
	  }
	| {
			readonly kind: 'move-toolbar'
			readonly toolbar: Toolbar
			/** Absent = creation (the toolbar did not exist before). */
			readonly from?: ToolbarLocation
			/** Absent = deletion (the toolbar no longer exists). */
			readonly to?: ToolbarLocation
			readonly pruned: readonly LayoutPruneVictim[]
	  }
	| { readonly kind: 'insert-item'; readonly item: ToolbarItem; readonly at: ItemLocation }
	| {
			readonly kind: 'remove-item'
			readonly item: ToolbarItem
			readonly at: ItemLocation
			readonly pruned: readonly LayoutPruneVictim[]
	  }
	| { readonly kind: 'replace'; readonly snapshot: SerializedLayout }

/** Listener invoked with the op descriptor of each structural mutation. */
export type LayoutOpListener = (op: LayoutOp) => void

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
	/**
	 * Binding to the point: a string reference (`id`, `id=value`, `id:action`)
	 * or an inline virtual definition (`StashDefinition` / `EnumFromDefinition`).
	 * Inline definitions behave like the same definition registered under
	 * their `id`, with lifetime scoped to this item.
	 */
	readonly tool: PointTarget<TPoint>
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
 * Drawer item — a pointless tool carrying a nested track.
 * The child track renders **perpendicular** to its parent (enforced by adapters).
 * Content is one `Track`: several toolbars in line along the child axis with
 * track spaces between them (same node-identity map as borders).
 */
export type DrawerToolbarItem<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
	readonly tool?: undefined
	readonly editor: 'drawer'
	readonly toolbar: Track
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
// `tool` mirrors `ToolToolbarItem.tool`: a string reference, or an inline
// virtual definition (`StashDefinition` / `EnumFromDefinition`) carried
// directly in the serialized item. Inline definitions are full JSON-safe
// definition objects (`id` + `source` + options / `stashedValue`), so a
// serialized configuration + points-list rebuilds the run-time structures
// with no separate virtuals lookup.

export type SerializedToolbarItem = {
	readonly tool?: string | import('./virtual.js').VirtualPoint
	readonly editor?: string
	readonly config?: Record<string, unknown>
	readonly toolbar?: readonly {
		readonly space: number
		readonly toolbar: readonly SerializedToolbarItem[]
	}[]
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

/**
 * Validate that an unknown value is a properly structured `SerializedLayout`.
 *
 * Headless port of the svelte adapter's `validatePaletteLayout` (which stays
 * adapter-owned until Phase 7): checks `version: 1`, the four region slot
 * lists (`space` number + `toolbar` array), and per-item shape (`tool` as a
 * string reference or an inline virtual definition object, `editor` string,
 * `config` plain object, drawer `toolbar` array). Returns `false` for
 * anything else — never throws.
 */
export function validateSerializedLayout(layout: unknown): layout is SerializedLayout {
	if (typeof layout !== 'object' || layout === null) return false
	const obj = layout as Record<string, unknown>
	if (obj.version !== 1) return false
	if (typeof obj.borders !== 'object' || obj.borders === null) return false
	const borders = obj.borders as Record<string, unknown>
	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	for (const region of regions) {
		const border = borders[region]
		if (!Array.isArray(border)) return false
		for (const slot of border) {
			if (typeof slot !== 'object' || slot === null) return false
			const slotObj = slot as Record<string, unknown>
			if (typeof slotObj.space !== 'number') return false
			if (!Array.isArray(slotObj.toolbar)) return false
			for (const item of slotObj.toolbar) {
				if (!isSerializedItem(item)) return false
			}
		}
	}
	if (obj.parking !== undefined) {
		if (!Array.isArray(obj.parking)) return false
		for (const toolbar of obj.parking) {
			if (!Array.isArray(toolbar)) return false
			for (const item of toolbar) {
				if (!isSerializedItem(item)) return false
			}
		}
	}
	return true
}

function isSerializedItem(item: unknown): boolean {
	if (typeof item !== 'object' || item === null) return false
	const itemObj = item as Record<string, unknown>
	if (itemObj.tool !== undefined) {
		if (typeof itemObj.tool === 'string') {
			// String reference — nothing more to check.
		} else if (!isInlineSpec(itemObj.tool)) {
			return false
		}
	}
	if (itemObj.editor !== undefined && typeof itemObj.editor !== 'string') return false
	if (itemObj.config !== undefined) {
		if (typeof itemObj.config !== 'object' || itemObj.config === null) return false
		if (Array.isArray(itemObj.config)) return false
	}
	if (itemObj.toolbar !== undefined) {
		if (!Array.isArray(itemObj.toolbar)) return false
		for (const slot of itemObj.toolbar) {
			if (typeof slot !== 'object' || slot === null) return false
			const slotObj = slot as Record<string, unknown>
			if (typeof slotObj.space !== 'number') return false
			if (!Array.isArray(slotObj.toolbar)) return false
			for (const child of slotObj.toolbar as unknown[]) {
				if (!isSerializedItem(child)) return false
			}
		}
	}
	return true
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
 *
 * Identity contract: `getLayout()` returns the **live** layout object — never
 * mutate the result (commit via `moveItem` / `moveToolbar` / `insertItem` /
 * `removeItem`); `setLayout()` is reserved for whole-layout loads;
 * `getSnapshot()` is the save path (`JSON.stringify` moment).
 */
export class PaletteLayoutTree {
	private layout: PaletteLayout
	private listeners = new Set<LayoutListener>()
	private opListeners = new Set<LayoutOpListener>()

	constructor(initial?: SerializedLayout | PaletteLayout) {
		this.layout = initial === undefined ? emptyLayout() : toPaletteLayout(initial)
	}

	/**
	 * Live layout (read-only — never mutate the result; commit through the
	 * structural methods). Returned by reference so adapters can key DOM
	 * nodes by object identity (`===` survives across calls).
	 */
	getLayout(): PaletteLayout {
		return this.layout
	}

	/** JSON-safe snapshot for persistence (the `JSON.stringify` moment). */
	getSnapshot(): SerializedLayout {
		return snapshotLayout(this.layout)
	}

	/**
	 * Replace the whole layout (whole-layout loads only — e.g. hydrate from
	 * storage or demo presets). Functioning edits commit through the
	 * structural methods instead. Always emits (snapshot + `replace` op).
	 */
	setLayout(next: SerializedLayout | PaletteLayout): void {
		this.layout = toPaletteLayout(next)
		const snapshot = this.getSnapshot()
		this.emit()
		this.emitOp({ kind: 'replace', snapshot })
	}

	/**
	 * Move an item between (or within) toolbars. Prunes toolbars emptied by
	 * the move. `to` is interpreted post-deletion (same-toolbar forward
	 * indices adjust for the removal). Omitting `from` is a creation
	 * (equivalent to `insertItem(to, item)`); omitting `to` is a deletion
	 * (equivalent to `removeItem(from)`).
	 */
	moveItem(from: ItemLocation | undefined, to: ItemLocation | undefined, item?: ToolbarItem): void {
		if (from === undefined && to === undefined)
			throw new PaletteError(`moveItem: from and to are both undefined`)
		if (from === undefined) {
			if (to === undefined || item === undefined)
				throw new PaletteError(`moveItem: creation needs a target location and an item`)
			this.insertItem(to, item)
			return
		}
		if (to === undefined) {
			this.removeItem(from)
			return
		}
		const source = this.toolbarAt(from)
		const target = this.toolbarAt(to)
		if (source === undefined || target === undefined)
			throw new PaletteError(`moveItem: unknown location`)
		const [moved] = source.splice(from.itemIndex, 1)
		if (moved === undefined)
			throw new PaletteError(`moveItem: item index ${from.itemIndex} out of bounds`)
		const insertAt =
			sameToolbar(from, to) && to.itemIndex > from.itemIndex ? to.itemIndex - 1 : to.itemIndex
		target.splice(insertAt, 0, moved)
		const pruned = this.pruneEmptyToolbar(from)
		this.emit()
		this.emitOp({ kind: 'move-item', item: moved, from, to, pruned })
	}

	/**
	 * Relocate a whole toolbar (identity preserved) across tracks / parking.
	 * Omitting `from` is a creation (equivalent to inserting `toolbar` at
	 * `to`); omitting `to` is a deletion. `to` is interpreted post-deletion.
	 */
	moveToolbar(
		from: ToolbarLocation | undefined,
		to: ToolbarLocation | undefined,
		toolbar?: Toolbar
	): void {
		if (from === undefined && to === undefined)
			throw new PaletteError(`moveToolbar: from and to are both undefined`)
		if (from === undefined) {
			if (to === undefined || toolbar === undefined)
				throw new PaletteError(`moveToolbar: creation needs a target location and a toolbar`)
			this.insertToolbarAt(to, toolbar)
			this.emit()
			this.emitOp({ kind: 'move-toolbar', toolbar, to, pruned: [] })
			return
		}
		if (to === undefined) {
			const removed = this.removeToolbarAt(from)
			if (removed === undefined) throw new PaletteError(`moveToolbar: unknown location`)
			this.emit()
			this.emitOp({ kind: 'move-toolbar', toolbar: removed.toolbar, from, pruned: removed.pruned })
			return
		}
		const moved = this.removeToolbarAt(from)
		if (moved === undefined) throw new PaletteError(`moveToolbar: unknown location`)
		this.insertToolbarAt(to, moved.toolbar)
		this.emit()
		this.emitOp({ kind: 'move-toolbar', toolbar: moved.toolbar, from, to, pruned: moved.pruned })
	}

	/** Insert an item at a location (adapter drop / console add-flow). */
	insertItem(at: ItemLocation, item: ToolbarItem): void {
		const toolbar = this.toolbarAt(at)
		if (toolbar === undefined) throw new PaletteError(`insertItem: unknown location`)
		toolbar.splice(at.itemIndex, 0, item)
		this.emit()
		this.emitOp({ kind: 'insert-item', item, at })
	}

	/** Remove an item (adapter delete-flow; drag uses `moveItem`). */
	removeItem(at: ItemLocation): ToolbarItem {
		const toolbar = this.toolbarAt(at)
		const [item] = toolbar?.splice(at.itemIndex, 1) ?? []
		if (toolbar === undefined || item === undefined)
			throw new PaletteError(`removeItem: unknown location`)
		const pruned = this.pruneEmptyToolbar(at)
		this.emit()
		this.emitOp({ kind: 'remove-item', item, at, pruned })
		return item
	}

	subscribe(listener: LayoutListener): Unsubscribe {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	/** Subscribe to per-mutation op descriptors (adapter node-map sync). */
	subscribeOps(listener: LayoutOpListener): Unsubscribe {
		this.opListeners.add(listener)
		return () => {
			this.opListeners.delete(listener)
		}
	}

	/**
	 * Create a drag session for one gesture (`ToolbarDrag`: `over` /
	 * `measure` / `end`, all `void`). Resolves the grab target against the
	 * live tree and throws when it is not there (a drawer child). The
	 * session holds this tree, so no session method ever takes a layout
	 * parameter.
	 */
	createDrag(target: GrabTarget): ToolbarDrag {
		return createToolbarDrag(this, target, {
			dragStart,
			dragOver,
			commitDraggedToStackSpace,
			commitDraggedToParkingRow,
			stackFlanks,
		})
	}

	/** Remove all layout listeners (adapter teardown). Layout is kept. */
	clearListeners(): void {
		this.listeners.clear()
		this.opListeners.clear()
	}

	private toolbarAt(location: ToolbarLocation): Toolbar | undefined {
		if (location.container === 'parking') return this.layout.parking[location.toolbarIndex]
		return this.layout.borders[location.region][location.trackIndex]?.[location.toolbarIndex]
			?.toolbar
	}

	/**
	 * Remove a toolbar from its container, reporting the containers the
	 * removal emptied (the toolbar's own slot, plus its track when the track
	 * became empty). Parking rows have no track level.
	 */
	private removeToolbarAt(
		location: ToolbarLocation
	): { toolbar: Toolbar; pruned: LayoutPruneVictim[] } | undefined {
		if (location.container === 'parking') {
			const [toolbar] = this.layout.parking.splice(location.toolbarIndex, 1)
			if (toolbar === undefined) return undefined
			return { toolbar, pruned: [{ kind: 'row', toolbar, from: location }] }
		}
		const border = this.layout.borders[location.region]
		const track = border[location.trackIndex]
		const [slot] = track?.splice(location.toolbarIndex, 1) ?? []
		if (slot === undefined) return undefined
		const pruned: LayoutPruneVictim[] = [{ kind: 'toolbar', toolbar: slot.toolbar, from: location }]
		if (track !== undefined && track.length === 0) {
			border.splice(location.trackIndex, 1)
			pruned.push({ kind: 'track', toolbar: slot.toolbar, from: location })
		}
		return { toolbar: slot.toolbar, pruned }
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
		// Split the target gap like every other insertion (never a raw
		// `space: 1`, which would push the track's spacing sum past 1).
		insertToolbar(track, location.toolbarIndex, toolbar, configuration.trackGapSplit)
	}

	private pruneEmptyToolbar(location: ToolbarLocation): LayoutPruneVictim[] {
		if (location.container === 'parking') {
			const victim = this.layout.parking[location.toolbarIndex]
			if (victim !== undefined && victim.length === 0) {
				this.layout.parking.splice(location.toolbarIndex, 1)
				return [{ kind: 'row', toolbar: victim, from: location }]
			}
			return []
		}
		const border = this.layout.borders[location.region]
		const track = border[location.trackIndex]
		const victim = track?.[location.toolbarIndex]?.toolbar
		if (victim !== undefined && victim.length === 0) {
			track.splice(location.toolbarIndex, 1)
			const pruned: LayoutPruneVictim[] = [{ kind: 'toolbar', toolbar: victim, from: location }]
			if (track.length === 0) {
				border.splice(location.trackIndex, 1)
				pruned.push({ kind: 'track', toolbar: victim, from: location })
			}
			return pruned
		}
		return []
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

	private emitOp(op: LayoutOp): void {
		for (const listener of [...this.opListeners]) {
			try {
				listener(op)
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
			config: item.config === undefined ? undefined : { ...item.config },
			toolbar: item.toolbar.map((slot) => ({
				space: slot.space,
				toolbar: slot.toolbar.map(hydrateItem),
			})),
		} as DrawerToolbarItem
	}
	if (item.tool === undefined)
		return {
			editor: item.editor ?? 'status',
			config: item.config === undefined ? undefined : { ...item.config },
		}
	// String references hydrate verbatim (immutable); inline virtual
	// definitions are deep-cloned (JSON-safe definition objects) so the tree
	// shares no structure with the serialized input.
	return {
		tool: typeof item.tool === 'string' ? item.tool : cloneValue(item.tool),
		editor: item.editor,
		config: item.config === undefined ? undefined : { ...item.config },
	}
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
			toolbar: item.toolbar.map((slot) => ({
				space: slot.space,
				toolbar: slot.toolbar.map(cloneItem),
			})),
		} as DrawerToolbarItem
	}
	if (item.tool === undefined)
		return {
			editor: item.editor,
			config: item.config === undefined ? undefined : { ...item.config },
		}
	return {
		// Strings are immutable; inline virtual definitions are deep-cloned
		// (JSON-safe definition objects) so the clone shares no structure.
		tool: typeof item.tool === 'string' ? item.tool : cloneValue(item.tool),
		editor: item.editor,
		config: item.config === undefined ? undefined : { ...item.config },
	}
}

/**
 * Serialize a live `PaletteLayout` into a JSON-safe `SerializedLayout`
 * (flat slot list per region — track boundaries are not persisted).
 * Exported for the SSR snapshot path (`render.ts`), which accepts either
 * layout form; the tree's own `getSnapshot()` routes through here too.
 */
export function snapshotLayout(layout: PaletteLayout): SerializedLayout {
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
		return {
			editor: 'drawer',
			config: item.config,
			toolbar: item.toolbar.map((slot) => ({
				space: slot.space,
				toolbar: slot.toolbar.map(serializeItem),
			})),
		}
	// String references serialize as-is; inline virtual definitions serialize
	// as their full definition object (JSON-safe: `id` + `source` + options /
	// `stashedValue`), so no separate virtuals lookup is needed on rebuild.
	const tool =
		typeof (item as ToolToolbarItem).tool === 'string'
			? (item as ToolToolbarItem).tool
			: cloneValue((item as ToolToolbarItem).tool)
	return { tool, editor: item.editor, config: item.config }
}

/** Null-safe drawer guard (a drawer is pointless + carries a nested toolbar). */
export function isDrawerItem(item: ToolbarItem | null | undefined): item is DrawerToolbarItem {
	return (
		item != null &&
		(item as DrawerToolbarItem).editor === 'drawer' &&
		Array.isArray((item as DrawerToolbarItem).toolbar)
	)
}

// ── Pure track-space math (Phase 2 — verbatim from the svelte adapter) ──────
// Operates on core `Track` / `Border` / `Parking` data only: no DOM, no runes,
// no store reads. Adapters commit drag results through these primitives (or
// through `PaletteLayoutTree` for location-based moves).

/** Clamp a spacing value into the unit interval (non-finite → 0). */
export function clampUnit(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/**
 * Effective spacing of the gap at `index` in a track: the stored slot space
 * for a leading gap, the remaining share (`1 − Σ`) for the trailing gap,
 * `0` out of range.
 */
export function actualTrackSpaceAt(track: Track, index: number): number {
	return index < track.length
		? clampUnit(track[index]!.space)
		: index === track.length
			? clampUnit(track.reduce((remaining, slot) => remaining - slot.space, 1))
			: 0
}

function actualTrackSpaces(track: Track): number[] {
	const spaces = track.map((slot) => clampUnit(slot.space))
	const trailing = clampUnit(1 - spaces.reduce((sum, space) => sum + space, 0))
	return [...spaces, trailing]
}

function applyTrackSpaces(track: Track, spaces: readonly number[]): void {
	for (let index = 0; index < track.length; index += 1)
		track[index]!.space = clampUnit(spaces[index] ?? 0)
}

/**
 * Removes a toolbar from a track and merges its surrounding spacing into a single gap.
 *
 * @returns The removed toolbar slot index, or `-1` when the toolbar is not in the track.
 */
export function removeToolbar(track: Track, toolbar: Toolbar): number {
	const index = track.findIndex((slot) => slot.toolbar === toolbar)
	if (index < 0) return -1
	const spaces = actualTrackSpaces(track)
	const merged = (spaces[index] ?? 0) + (spaces[index + 1] ?? 0)
	spaces.splice(index, 2, merged)
	track.splice(index, 1)
	applyTrackSpaces(track, spaces)
	return index
}

/** Removes a track from a border when it no longer contains any toolbars. */
export function removeEmptyTrack(border: Border, track: Track): void {
	if (track.length > 0) return
	const trackIndex = border.indexOf(track)
	if (trackIndex < 0) return
	border.splice(trackIndex, 1)
}

/**
 * Removes a toolbar from the parking stack by identity.
 *
 * Parking rows have no spacing to merge — the stack is a plain list.
 *
 * @returns The removed index, or `-1` when the toolbar is not parked.
 */
export function removeParkedToolbar(parking: Parking, toolbar: Toolbar): number {
	const index = parking.indexOf(toolbar)
	if (index < 0) return -1
	parking.splice(index, 1)
	return index
}

/**
 * Inserts a toolbar into an existing track and splits the target gap according to `split`.
 */
export function insertToolbar(track: Track, index: number, toolbar: Toolbar, split: number): void {
	const insertionIndex = Math.min(Math.max(index, 0), track.length)
	const spaces = actualTrackSpaces(track)
	const merged = spaces[insertionIndex] ?? 0
	const before = merged * clampUnit(split)
	const after = merged - before
	spaces.splice(insertionIndex, 1, before, after)
	track.splice(insertionIndex, 0, { space: 0, toolbar })
	applyTrackSpaces(track, spaces)
}

/** Rebalances the spaces around an existing toolbar within a track. */
export function resizeToolbar(track: Track, index: number, split: number): void {
	if (index < 0 || index >= track.length) return
	const spaces = actualTrackSpaces(track)
	const merged = (spaces[index] ?? 0) + (spaces[index + 1] ?? 0)
	const before = merged * clampUnit(split)
	const after = merged - before
	spaces.splice(index, 2, before, after)
	applyTrackSpaces(track, spaces)
}

/**
 * Inserts a new single-toolbar track into a border at a clamped index.
 * Stack-gap commit primitive (no drag-state reads — adapters pass the
 * already-resolved destination toolbar).
 */
export function insertTrackWithToolbar(
	border: Border,
	index: number,
	toolbar: Toolbar
): { track: Track; trackIndex: number } {
	const trackIndex = Math.min(Math.max(index, 0), border.length)
	const track: Track = [{ space: 0, toolbar }]
	border.splice(trackIndex, 0, track)
	return { track, trackIndex }
}

// ── Drag session state (explicit param — no module globals) ───────────────
// Headless port of the svelte adapter's `PaletteDragging` session shape
// (`types.ts`), minus the palette instance (core never holds adapters).
// Adapters own the live session, pass it explicitly to every helper below,
// and refresh `origin` after each commit so subsequent hovers move from the
// new location.

/** Origin of the dragged tools before they were picked up. */
export type DragOrigin =
	| {
			/** Border container discriminator. */
			kind: 'border'
			/** The toolbar the dragged tools came from. */
			toolbar: Toolbar
			/** The track that toolbar was in. */
			track: Track
			/** The border that track was in. */
			border: Border
	  }
	| {
			/** Parking container discriminator. */
			kind: 'parking'
			/** The toolbar the dragged tools came from. */
			toolbar: Toolbar
			/** The parking stack that toolbar lives in. */
			parking: Parking
			/** Index of the toolbar within the parking stack. */
			index: number
	  }

/** A toolbar living in a border track (with its track + border). */
export type DragBorderLocation = Extract<DragOrigin, { kind: 'border' }>

/** A toolbar living in the parking stack (with its stack index). */
export type DragParkingLocation = Extract<DragOrigin, { kind: 'parking' }>

/**
 * What the drag selection means right now: `'slide'` when the dragged tools
 * are the entire content of their toolbar (the toolbar itself moves),
 * `'restructure'` when they are a subset (extracted into a fresh toolbar).
 * Recomputed after every structural commit, never re-derived per pointer move.
 */
export type DragMode = 'restructure' | 'slide'

/** Explicit drag session passed to every veto / commit helper below. */
export type DraggingState = {
	/** The selected tools (single tool click, or whole toolbar content). */
	tools: ToolbarItem[]
	/** Where the dragged tools currently live. Updated after each commit. */
	origin: DragOrigin
	/**
	 * What the selection means right now. Recomputed after every structural
	 * commit: a subset selection is `'restructure'`, the full content of a
	 * toolbar is `'slide'`.
	 */
	mode: DragMode
	/**
	 * Stored whole-toolbar flag: `true` when the dragged tools are the
	 * entire content of their toolbar. Set at drag-start via
	 * `startDraggingState` and refreshed by `refreshDragMode` after every
	 * commit — adapters read it, never re-derive it. Mirrors `mode` so
	 * both the cached mode and the explicit flag stay in sync.
	 */
	isWholeToolbar: boolean
}

/** Check whether a toolbar item is part of the drag selection. */
export function isDraggingTool(dragging: DraggingState | undefined, item: ToolbarItem): boolean {
	if (!dragging) return false
	return dragging.tools.includes(item)
}

/**
 * Check whether an item-space index is free: neither neighbouring tool (if
 * any) is part of the drag selection. Space `index` sits between
 * `toolbar[index - 1]` and `toolbar[index]`. A DZ beside a dragged tool is
 * never highlighted — when ABCD has D dragged, the gap after D stays dark
 * and the candidate moves out to the track gap after the toolbar (see
 * `trackSpaceHighlight` fallback below).
 */
export function isItemSpaceFree(
	dragging: DraggingState | undefined,
	toolbar: Toolbar,
	index: number
): boolean {
	const before = toolbar[index - 1]
	const after = toolbar[index]
	if (before !== undefined && isDraggingTool(dragging, before)) return false
	if (after !== undefined && isDraggingTool(dragging, after)) return false
	return true
}

/**
 * Nearest free item-space at or before `from`. Scans `from` down to `0`;
 * returns `undefined` when every candidate touches a dragged tool (caller
 * falls back to the gap-between-toolbars).
 */
export function nearestFreeItemSpaceBefore(
	dragging: DraggingState | undefined,
	toolbar: Toolbar,
	from: number
): number | undefined {
	const start = Math.min(from, toolbar.length)
	for (let index = start; index >= 0; index -= 1) {
		if (isItemSpaceFree(dragging, toolbar, index)) return index
	}
	return undefined
}

/**
 * Nearest free item-space at or after `from`. Scans `from` up to
 * `toolbar.length`; returns `undefined` when every candidate touches a
 * dragged tool (caller falls back to the gap-between-toolbars).
 */
export function nearestFreeItemSpaceAfter(
	dragging: DraggingState | undefined,
	toolbar: Toolbar,
	from: number
): number | undefined {
	const start = Math.max(from, 0)
	for (let index = start; index <= toolbar.length; index += 1) {
		if (isItemSpaceFree(dragging, toolbar, index)) return index
	}
	return undefined
}

/**
 * Check whether the drag selection covers a whole toolbar.
 *
 * Container-scoped: only the session's own origin toolbar can match. A
 * structurally identical toolbar in another container never counts — position
 * is part of instance identity.
 */
export function isDraggingWholeToolbar(
	dragging: DraggingState | undefined,
	toolbar: Toolbar
): boolean {
	if (!dragging || dragging.tools.length === 0) return false
	if (toolbar !== dragging.origin.toolbar) return false
	if (dragging.tools.length !== toolbar.length) return false
	return dragging.tools.every((tool) => toolbar.includes(tool))
}

/**
 * Check whether a toolbar is the session's dragged toolbar *in its own
 * container*. Pass the toolbar's location alongside it: the same object
 * rendered in two places matches only where the drag originated.
 */
export function isDraggedToolbarAt(
	dragging: DraggingState | undefined,
	toolbar: Toolbar,
	location: DragBorderLocation | DragParkingLocation
): boolean {
	if (!dragging) return false
	if (toolbar !== dragging.origin.toolbar) return false
	if (location.kind !== dragging.origin.kind) return false
	if (location.kind === 'border' && dragging.origin.kind === 'border') {
		return location.track === dragging.origin.track && location.border === dragging.origin.border
	}
	if (location.kind === 'parking' && dragging.origin.kind === 'parking') {
		return location.parking === dragging.origin.parking && location.index === dragging.origin.index
	}
	return false
}

/**
 * Derive the drag mode from the live selection: `'slide'` when the dragged
 * tools are the *entire* content of their current toolbar (nothing else is
 * left behind), `'restructure'` otherwise.
 *
 * @deprecated Phase 7 — becomes a session internal; do not add new callers.
 *
 * This is the single question the whole drag engine asks: *"is there anything
 * else than `dragging` in my toolbar?"* — no → the toolbar itself moves;
 * yes → the selection is a subset being restructured.
 */
export function resolveDragMode(dragging: DraggingState): DragMode {
	return isDraggingWholeToolbar(dragging, dragging.origin.toolbar) ? 'slide' : 'restructure'
}

/**
 * Recompute `dragging.mode` after a structural change (a commit). Cached on
 * the session rather than derived per pointer move, so a drag that started as
 * a subset can *become* a slide once its tools are extracted into a toolbar of
 * their own — and a slide can *become* a restructure once a merge puts other
 * items back beside it. Also refreshes the stored `isWholeToolbar` flag so
 * adapters always read the current value. Returns the new mode.
 *
 * @deprecated Phase 7 — becomes a session internal; do not add new callers.
 */
export function refreshDragMode(dragging: DraggingState): DragMode {
	dragging.mode = resolveDragMode(dragging)
	dragging.isWholeToolbar = dragging.mode === 'slide'
	return dragging.mode
}

/**
 * Build a drag session with the whole-toolbar flag derived once, at
 * drag-start. Adapters must use this (never a literal) so the stored flag
 * and `mode` start in sync; every commit refreshes both via
 * `refreshDragMode`.
 *
 * @deprecated Phase 7 — the session resolves the grab target itself; do not add new callers.
 *
 * NOTE: `startDraggingState` is the legacy entry point (tools + origin
 * only). New code should use `dragStart` below, which takes the grabbed
 * element (tool or toolbar) plus the pointer position and resolves the
 * origin itself.
 */
export function startDraggingState(options: {
	tools: ToolbarItem[]
	origin: DragOrigin
}): DraggingState {
	const dragging: DraggingState = {
		tools: options.tools,
		origin: options.origin,
		mode: 'restructure',
		isWholeToolbar: false,
	}
	refreshDragMode(dragging)
	return dragging
}

// ── Core drag engine: drag-start / drag-over ─────────────────────────────
// The core decides the action (restructure vs translate); adapters only
// report the grabbed element (tool / toolbar / DZ) and the pointer position.
// Element identity is by live object reference (`Toolbar` / `ToolbarItem`
// arrays from `getLayout()`); position is an abstract slot/gap index plus
// the pointer pixel (for slide-follow), never DOM.

/**
 * Element the pointer grabbed or hovered: a tool, a toolbar, or a DZ gap.
 *
 * @deprecated Phase 7 — replaced by the session `Hoverable` vocabulary; do not add new uses.
 */
export type DragElement =
	| { readonly kind: 'tool'; readonly toolbar: Toolbar; readonly item: ToolbarItem }
	| { readonly kind: 'toolbar'; readonly toolbar: Toolbar }
	| {
			readonly kind: 'item-gap'
			readonly toolbar: Toolbar
			readonly track: Track
			readonly border: Border
			readonly gap: number
	  }
	| {
			readonly kind: 'track-gap'
			readonly track: Track
			readonly border: Border
			readonly gap: number
	  }
	| {
			readonly kind: 'stack-gap'
			readonly border: Border
			readonly gap: number
	  }
	| {
			readonly kind: 'track'
			readonly border: Border
			readonly trackIndex: number
	  }
	| {
			readonly kind: 'parking-gap'
			readonly parking: Parking
			readonly gap: number
	  }
	| {
			readonly kind: 'parking-row-gap'
			readonly toolbar: Toolbar
			readonly parking: Parking
			readonly index: number
			readonly gap: number
	  }

/**
 * Pointer position: abstract indices (resolved by the adapter's hit test).
 *
 * @deprecated Phase 7 — replaced by `PointerSample` + `SlideFrame`; do not add new uses.
 */
export type DragPointer = {
	/** Item index under the pointer (active-item fallback), if any. */
	readonly activeItem?: number
	/** Pointer pixel along the slide axis (for slide-follow). */
	readonly client?: number
}

/**
 * What the core decided on drag-over: highlight paint + optional commit.
 *
 * @deprecated Phase 7 — methods return `void` and raise `DragEvent`s; do not add new readers.
 */
export type DragOverDecision = {
	/** Item-space gaps to paint per toolbar (adapter applies as classes). */
	readonly itemHighlights: readonly {
		readonly toolbar: Toolbar
		readonly gaps: readonly number[]
	}[]
	/** Track gaps to paint per track. */
	readonly trackHighlights: readonly { readonly track: Track; readonly gaps: readonly number[] }[]
	/** Stack gaps to paint per border. */
	readonly stackHighlights: readonly { readonly border: Border; readonly gaps: readonly number[] }[]
	/** Parking gaps to paint. */
	readonly parkingHighlights: readonly { readonly gaps: readonly number[] }[]
	/** Neighbour TB edges for a whole-toolbar drag (same track). */
	readonly neighbourEdges: readonly { readonly toolbar: Toolbar; readonly gap: number }[]
	/** Whether a restructure commit landed on this hover. */
	readonly moved: boolean
	/** Refreshed whole-toolbar flag (also stored on the session). */
	readonly isWholeToolbar: boolean
}

/** Locate the track + border holding `toolbar` (identity scan). */
function locateToolbar(
	toolbar: Toolbar,
	borders: Borders,
	parking: Parking
):
	| { readonly kind: 'border'; readonly track: Track; readonly border: Border }
	| { readonly kind: 'parking'; readonly parking: Parking; readonly index: number }
	| undefined {
	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	for (const region of regions) {
		const border = borders[region]
		for (const track of border) {
			for (const slot of track) {
				if (slot.toolbar === toolbar) return { kind: 'border', track, border }
			}
		}
	}
	const index = parking.indexOf(toolbar)
	if (index >= 0) return { kind: 'parking', parking, index }
	return undefined
}

/**
 * Core drag-start: given the grabbed element (tool or toolbar) plus the
 * pointer position, build the session. The core decides whole-toolbar vs
 * subset from the live layout — the adapter never derives it.
 *
 * @deprecated Phase 7 — creation is `layout.createDrag(target)`; do not add new callers.
 */
export function dragStart(
	layout: { readonly borders: Borders; readonly parking: Parking },
	element: DragElement,
	_pointer?: DragPointer
): DraggingState {
	if (element.kind === 'tool') {
		const at = locateToolbar(element.toolbar, layout.borders, layout.parking)
		if (at === undefined) throw new PaletteError(`dragStart: toolbar not found in layout`)
		if (at.kind === 'parking') {
			return startDraggingState({
				tools: [element.item],
				origin: { kind: 'parking', toolbar: element.toolbar, parking: at.parking, index: at.index },
			})
		}
		return startDraggingState({
			tools: [element.item],
			origin: { kind: 'border', toolbar: element.toolbar, track: at.track, border: at.border },
		})
	}
	if (element.kind === 'toolbar') {
		const at = locateToolbar(element.toolbar, layout.borders, layout.parking)
		if (at === undefined) throw new PaletteError(`dragStart: toolbar not found in layout`)
		if (at.kind === 'parking') {
			return startDraggingState({
				tools: [...element.toolbar],
				origin: { kind: 'parking', toolbar: element.toolbar, parking: at.parking, index: at.index },
			})
		}
		return startDraggingState({
			tools: [...element.toolbar],
			origin: { kind: 'border', toolbar: element.toolbar, track: at.track, border: at.border },
		})
	}
	throw new PaletteError(`dragStart: cannot start a drag from a DZ gap`)
}

/**
 * Core drag-over: given the hovered element (tool / toolbar / DZ gap) plus
 * the pointer position, decide highlight paint + restructure commit. The
 * core decides the action (restructure into a highlighted DZ, translate the
 * sliding toolbar); the adapter applies the returned paint sets as classes
 * and re-renders on `moved`.
 *
 * @deprecated Phase 7 — the session `over()` raises `DragEvent`s; do not add new callers.
 *
 * Restructuring happens ONLY on a highlighted DZ: hovering a dark gap
 * returns `moved: false` with no paint for that gap.
 */
export function dragOver(
	dragging: DraggingState,
	layout: { readonly borders: Borders; readonly parking: Parking },
	element: DragElement,
	pointer: DragPointer,
	editing: boolean
): DragOverDecision {
	const empty: DragOverDecision = {
		itemHighlights: [],
		trackHighlights: [],
		stackHighlights: [],
		parkingHighlights: [],
		neighbourEdges: [],
		moved: false,
		isWholeToolbar: dragging.isWholeToolbar,
	}
	if (!editing) return empty
	// Hovering a tool (not a gap): active-item fallback highlight.
	if (element.kind === 'tool') {
		const highlight = itemSpaceHighlight({
			toolbar: element.toolbar,
			activeItem: pointer.activeItem ?? element.toolbar.indexOf(element.item),
			hovered: undefined,
			editing: true,
			dragging,
		})
		const itemHighlights =
			highlight.highlighted.size > 0
				? [{ toolbar: element.toolbar, gaps: [...highlight.highlighted] }]
				: []
		// Dry side falls back to the flanking track gap — except while a
		// whole toolbar is dragged (neighbour TB edges instead).
		const at = locateToolbar(element.toolbar, layout.borders, layout.parking)
		if (at?.kind === 'border' && pointer.activeItem !== undefined) {
			const slotIndex = at.track.findIndex((entry) => entry.toolbar === element.toolbar)
			if (dragging.isWholeToolbar) {
				return {
					...empty,
					itemHighlights,
					neighbourEdges: wholeToolbarNeighbourEdges({
						track: at.track,
						slotIndex,
						dragging,
						editing: true,
					}),
				}
			}
			const fallback = trackSpaceHighlight({
				track: at.track,
				toolbar: element.toolbar,
				slotIndex,
				activeSlot: pointer.activeItem,
				hovered: undefined,
				editing: true,
				dragging,
			})
			if (fallback.highlighted.size > 0) {
				return {
					...empty,
					itemHighlights,
					trackHighlights: [{ track: at.track, gaps: [...fallback.highlighted] }],
				}
			}
		}
		return { ...empty, itemHighlights }
	}
	// Hovering a toolbar body: same fallback, anchored on the pointer item.
	if (element.kind === 'toolbar') {
		const at = locateToolbar(element.toolbar, layout.borders, layout.parking)
		if (at?.kind !== 'border' || pointer.activeItem === undefined) return empty
		const slotIndex = at.track.findIndex((entry) => entry.toolbar === element.toolbar)
		if (dragging.isWholeToolbar) {
			return {
				...empty,
				neighbourEdges: wholeToolbarNeighbourEdges({
					track: at.track,
					slotIndex,
					dragging,
					editing: true,
				}),
			}
		}
		const fallback = trackSpaceHighlight({
			track: at.track,
			toolbar: element.toolbar,
			slotIndex,
			activeSlot: pointer.activeItem,
			hovered: undefined,
			editing: true,
			dragging,
		})
		if (fallback.highlighted.size > 0) {
			return { ...empty, trackHighlights: [{ track: at.track, gaps: [...fallback.highlighted] }] }
		}
		return empty
	}
	// Hovering an item-space DZ: paint + commit when highlighted.
	if (element.kind === 'item-gap') {
		const highlight = itemSpaceHighlight({
			toolbar: element.toolbar,
			activeItem: undefined,
			hovered: element.gap,
			editing: true,
			dragging,
		})
		if (!highlight.highlighted.has(element.gap)) {
			return { ...empty, itemHighlights: [] }
		}
		const result = commitDraggedToItemSpace(
			dragging,
			element.toolbar,
			element.track,
			element.border,
			element.gap
		)
		return {
			...empty,
			itemHighlights: [{ toolbar: element.toolbar, gaps: [element.gap] }],
			moved: result.moved,
			isWholeToolbar: result.isWholeToolbar,
		}
	}
	// Hovering a track gap: paint + commit when highlighted (not a slide flank).
	// Direct hover only needs the flank veto, so the toolbar/slot are unused.
	if (element.kind === 'track-gap') {
		const highlight = trackSpaceHighlight({
			track: element.track,
			toolbar: [],
			slotIndex: 0,
			activeSlot: undefined,
			hovered: element.gap,
			editing: true,
			dragging,
		})
		if (!highlight.highlighted.has(element.gap)) {
			return { ...empty, trackHighlights: [] }
		}
		const result = commitDraggedToTrackSpace(dragging, element.track, element.border, element.gap)
		return {
			...empty,
			trackHighlights: [{ track: element.track, gaps: [element.gap] }],
			moved: result.moved,
			isWholeToolbar: result.isWholeToolbar,
		}
	}
	// Hovering a stack gap: paint when highlighted; the dwell commit stays
	// adapter-owned (timer), core only decides paint here.
	if (element.kind === 'stack-gap') {
		const highlight = borderStackHighlight({
			border: element.border,
			active: undefined,
			hovered: element.gap,
			editing: true,
			dragging,
		})
		if (!highlight.highlighted.has(element.gap)) return { ...empty, stackHighlights: [] }
		return { ...empty, stackHighlights: [{ border: element.border, gaps: [element.gap] }] }
	}
	// Hovering a track background (not a gap): highlight the two flanking
	// stack gaps (active-track fallback, no commit).
	if (element.kind === 'track') {
		const highlight = borderStackHighlight({
			border: element.border,
			active: element.trackIndex,
			hovered: undefined,
			editing: true,
			dragging,
		})
		if (highlight.highlighted.size === 0) return { ...empty, stackHighlights: [] }
		return {
			...empty,
			stackHighlights: [{ border: element.border, gaps: [...highlight.highlighted] }],
		}
	}
	// Hovering a parking gap / row gap: paint when highlighted.
	if (element.kind === 'parking-gap') {
		const highlight = parkingGapHighlight({
			parking: element.parking,
			active: undefined,
			hovered: element.gap,
			editing: true,
			dragging,
		})
		if (!highlight.highlighted.has(element.gap)) return { ...empty, parkingHighlights: [] }
		return { ...empty, parkingHighlights: [{ gaps: [element.gap] }] }
	}
	const highlight = itemSpaceHighlight({
		toolbar: element.toolbar,
		activeItem: undefined,
		hovered: element.gap,
		editing: true,
		dragging,
	})
	if (!highlight.highlighted.has(element.gap)) {
		return { ...empty, itemHighlights: [] }
	}
	const result = commitDraggedToParking(
		dragging,
		element.toolbar,
		element.parking,
		element.index,
		element.gap
	)
	return {
		...empty,
		itemHighlights: [{ toolbar: element.toolbar, gaps: [element.gap] }],
		moved: result.moved,
		isWholeToolbar: result.isWholeToolbar,
	}
}

/**
 * Index of the track the drag would empty: the track holding a single toolbar
 * whose whole content is dragged. Returns `undefined` when no such track
 * exists in `border` (partial drag, multi-toolbar track, another
 * border/region, or a parking drag — parking has no tracks).
 */
export function draggingEmptiesTrackIndex(
	dragging: DraggingState | undefined,
	border: Border
): number | undefined {
	if (!dragging || dragging.tools.length === 0) return undefined
	if (dragging.origin.kind !== 'border') return undefined
	for (let index = 0; index < border.length; index += 1) {
		const track = border[index]
		if (track.length !== 1) continue
		const sole = track[0]
		if (sole && isDraggingWholeToolbar(dragging, sole.toolbar)) return index
	}
	return undefined
}

/**
 * Index of the parking row the drag would empty: the row whose whole content
 * is dragged while the stack holds a single row. Returns `undefined` when no
 * such row exists in `parking` (partial drag, multi-row stack, or a border
 * drag — borders have no rows).
 */
export function draggingEmptiesParkingRow(
	dragging: DraggingState | undefined,
	parking: Parking
): number | undefined {
	if (!dragging || dragging.tools.length === 0) return undefined
	if (dragging.origin.kind !== 'parking') return undefined
	if (parking.length !== 1) return undefined
	const sole = parking[0]
	if (sole && isDraggingWholeToolbar(dragging, sole)) return 0
	return undefined
}

// ── Drop-zone highlight (pure, no DOM) ────────────────────────────────────
// Decides which gaps paint, given a `GapDwellState` plus the session. The
// adapter diffs the returned set against the previous one and toggles
// `highlighted` / `hovered` classes on the existing gap nodes.

/** Highlight decision for one gap container (border stack / parking / toolbar). */
export type GapHighlight = {
	/** Indices that paint `highlighted`. */
	readonly highlighted: ReadonlySet<number>
	/** The directly-hovered gap (paints `hovered`, doubled size); `undefined` when none. */
	readonly hovered: number | undefined
}

function stackHighlight(options: {
	gapCount: number
	active: number | undefined
	hovered: number | undefined
	editing: boolean
	dragging: DraggingState | undefined
	emptied: number | undefined
	maskActive: boolean
	endGap: number
}): GapHighlight {
	const { gapCount, active, hovered, editing, dragging, emptied, maskActive, endGap } = options
	if (!editing || !dragging) return { highlighted: new Set(), hovered: undefined }
	const highlighted = new Set<number>()
	if (maskActive) {
		if (endGap >= 0 && endGap < gapCount) highlighted.add(endGap)
		return { highlighted, hovered: undefined }
	}
	const add = (gap: number) => {
		if (gap < 0 || gap >= gapCount) return
		if (emptied !== undefined && (gap === emptied || gap === emptied + 1)) return
		highlighted.add(gap)
	}
	if (hovered !== undefined) {
		add(hovered)
		return { highlighted, hovered }
	}
	if (active === undefined) return { highlighted, hovered: undefined }
	add(active)
	add(active + 1)
	return { highlighted, hovered: undefined }
}

/**
 * Border stack gaps (`border.length + 1` of them): hovering a track highlights
 * the two surrounding stacks; hovering a gap directly highlights only it.
 * The two stacks touching the would-be-emptied track never highlight.
 */
export function borderStackHighlight(options: {
	border: Border
	active: number | undefined
	hovered: number | undefined
	editing: boolean
	dragging: DraggingState | undefined
	maskActive?: boolean
}): GapHighlight {
	return stackHighlight({
		gapCount: options.border.length + 1,
		active: options.active,
		hovered: options.hovered,
		editing: options.editing,
		dragging: options.dragging,
		emptied: draggingEmptiesTrackIndex(options.dragging, options.border),
		maskActive: options.maskActive ?? false,
		endGap: options.border.length,
	})
}

/**
 * The two stack gaps flanking `trackIndex` in `border` (the "active track"
 * fallback), with the would-be-emptied-track veto applied — the paint every
 * in-track hover derives in addition to its own DZs (`Hoverable` carries no
 * `track-background` kind; this is how a track hover lights its neighbours).
 * Empty when both flanking stacks are vetoed (the drag would empty the track).
 */
export function stackFlanks(
	dragging: DraggingState | undefined,
	border: Border,
	trackIndex: number
): readonly number[] {
	const emptied = draggingEmptiesTrackIndex(dragging, border)
	const out: number[] = []
	for (const gap of [trackIndex, trackIndex + 1]) {
		if (gap < 0 || gap > border.length) continue
		if (emptied !== undefined && (gap === emptied || gap === emptied + 1)) continue
		out.push(gap)
	}
	return out
}

/**
 * Parking stack gaps (`parking.length + 1` of them): same protocol as border
 * stacks, with the would-be-emptied row veto.
 */
export function parkingGapHighlight(options: {
	parking: Parking
	active: number | undefined
	hovered: number | undefined
	editing: boolean
	dragging: DraggingState | undefined
	maskActive?: boolean
}): GapHighlight {
	return stackHighlight({
		gapCount: options.parking.length + 1,
		active: options.active,
		hovered: options.hovered,
		editing: options.editing,
		dragging: options.dragging,
		emptied: draggingEmptiesParkingRow(options.dragging, options.parking),
		maskActive: options.maskActive ?? false,
		endGap: options.parking.length,
	})
}

/**
 * Item-space gaps inside one toolbar (`toolbar.length + 1` of them): a gap
 * touching a dragged tool never highlights — when ABCD has D dragged, the
 * gap after D stays dark and the candidate moves out to the track gap after
 * the toolbar (the caller paints it via `trackSpaceHighlight`, see below).
 * Direct hover wins, otherwise the nearest free gap on each side of the
 * hovered item highlights. When no free gap exists on a side (`nearestFree*`
 * returns `undefined`), that side falls back to the neighbouring track gap.
 */
export function itemSpaceHighlight(options: {
	toolbar: Toolbar
	activeItem: number | undefined
	hovered: number | undefined
	editing: boolean
	dragging: DraggingState | undefined
}): GapHighlight {
	const { toolbar, activeItem, hovered, editing, dragging } = options
	if (!editing || !dragging) return { highlighted: new Set(), hovered: undefined }
	const highlighted = new Set<number>()
	if (hovered !== undefined) {
		if (isItemSpaceFree(dragging, toolbar, hovered)) highlighted.add(hovered)
		return { highlighted, hovered }
	}
	if (activeItem === undefined) return { highlighted, hovered: undefined }
	const before = nearestFreeItemSpaceBefore(dragging, toolbar, activeItem)
	const after = nearestFreeItemSpaceAfter(dragging, toolbar, activeItem + 1)
	if (before !== undefined) highlighted.add(before)
	if (after !== undefined) highlighted.add(after)
	return { highlighted, hovered: undefined }
}

/**
 * Track gaps flanking one toolbar slot (`track.length + 1` of them): the
 * fallback paint when `itemSpaceHighlight` runs short on a side. `before`
 * (`slotIndex`) / `after` (`slotIndex + 1`) paint exactly when the matching
 * `nearestFree*` side returned `undefined` — i.e. every item-space on that
 * side touches a dragged tool, so the candidate moves out to the
 * gap-between-toolbars. Direct gap hover wins (paints only it); otherwise
 * the `activeSlot` flanks paint. While sliding, the two gaps flanking the
 * moved toolbar never paint (mirrors the `commitDraggedToTrackSpace` veto:
 * hovering them is just continuing to move the toolbar).
 */
export function trackSpaceHighlight(options: {
	track: Track
	toolbar: Toolbar
	slotIndex: number
	activeSlot: number | undefined
	hovered: number | undefined
	editing: boolean
	dragging: DraggingState | undefined
}): GapHighlight {
	const { track, toolbar, slotIndex, activeSlot, hovered, editing, dragging } = options
	if (!editing || !dragging) return { highlighted: new Set(), hovered: undefined }
	const highlighted = new Set<number>()
	const gapCount = track.length + 1
	const add = (gap: number) => {
		if (gap < 0 || gap >= gapCount) return
		if (isSlidingFlank(dragging, track, gap)) return
		highlighted.add(gap)
	}
	if (hovered !== undefined) {
		add(hovered)
		return { highlighted, hovered }
	}
	if (activeSlot === undefined) return { highlighted, hovered: undefined }
	// Only the flanks of the hovered toolbar's own slot are candidates; each
	// paints only when the item-space side ran dry. `activeSlot` is the
	// hovered *item* index inside the toolbar (mirrors `itemSpaceHighlight`'s
	// `activeItem`): the before side scans back from it, the after side
	// scans forward from `activeSlot + 1`.
	const beforeFree = nearestFreeItemSpaceBefore(dragging, toolbar, activeSlot)
	const afterFree = nearestFreeItemSpaceAfter(dragging, toolbar, activeSlot + 1)
	if (beforeFree === undefined) add(slotIndex)
	if (afterFree === undefined) add(slotIndex + 1)
	return { highlighted, hovered: undefined }
}

/** Sliding veto shared by the track-gap highlight + commit: the two gaps
 * flanking the moved toolbar are not destinations while sliding. Reads the
 * stored whole-toolbar flag (set at drag-start, refreshed after every
 * commit) — never re-derived per pointer move. */
function isSlidingFlank(dragging: DraggingState, track: Track, gap: number): boolean {
	if (dragging.origin.kind !== 'border') return false
	if (dragging.origin.track !== track) return false
	if (!dragging.isWholeToolbar) return false
	const slot = track.findIndex((entry) => entry.toolbar === dragging.origin.toolbar)
	if (slot < 0) return false
	return gap === slot || gap === slot + 1
}

/**
 * Neighbour TB-edge highlight for a whole-toolbar drag (same track only):
 * while the dragged toolbar itself moves, the only TB-DZ candidates are
 * the last gap of the previous toolbar and the first gap of the next
 * toolbar. Returns the `{ toolbar, gap }` pairs the adapter should paint
 * (empty when not a whole-toolbar border drag, or no neighbours exist).
 *
 * @deprecated Phase 7 — the return-value form goes away with `DragOverDecision`; do not add new callers.
 */
export function wholeToolbarNeighbourEdges(options: {
	track: Track
	slotIndex: number
	dragging: DraggingState | undefined
	editing: boolean
}): readonly { readonly toolbar: Toolbar; readonly gap: number }[] {
	const { track, slotIndex, dragging, editing } = options
	if (!editing || !dragging) return []
	if (!dragging.isWholeToolbar) return []
	if (dragging.origin.kind !== 'border') return []
	if (dragging.origin.track !== track) return []
	const out: { readonly toolbar: Toolbar; readonly gap: number }[] = []
	const prev = track[slotIndex - 1]?.toolbar
	if (prev !== undefined) out.push({ toolbar: prev, gap: prev.length })
	const next = track[slotIndex + 1]?.toolbar
	if (next !== undefined) out.push({ toolbar: next, gap: 0 })
	return out
}

// ── Movement commits (explicit drag state, no module globals) ─────────────
// Each commit mutates the passed-in containers, refreshes `dragging.origin`
// to the placed toolbar, recomputes `dragging.mode`, and returns whether a
// placement landed. Adapters call these from pointer handlers / dwell fires,
// then sync their DOM node map from the live objects.

function pruneDragOrigin(dragging: DraggingState): void {
	const origin = dragging.origin
	const originToolbar = origin.toolbar
	for (const tool of dragging.tools) {
		const index = originToolbar.indexOf(tool)
		if (index >= 0) originToolbar.splice(index, 1)
	}
	if (originToolbar.length > 0) return
	if (origin.kind === 'border') {
		removeToolbar(origin.track, originToolbar)
		removeEmptyTrack(origin.border, origin.track)
	} else {
		removeParkedToolbar(origin.parking, originToolbar)
	}
}

function takeDraggedTools(
	dragging: DraggingState,
	mode: DragMode
): { destination: Toolbar; prunedSlot: number } {
	if (mode === 'slide') {
		let prunedSlot = -1
		if (dragging.origin.kind === 'border') {
			prunedSlot = removeToolbar(dragging.origin.track, dragging.origin.toolbar)
			removeEmptyTrack(dragging.origin.border, dragging.origin.track)
		} else {
			removeParkedToolbar(dragging.origin.parking, dragging.origin.toolbar)
		}
		return { destination: dragging.origin.toolbar, prunedSlot }
	}
	pruneDragOrigin(dragging)
	return { destination: [], prunedSlot: -1 }
}

/**
 * Commit the dragged tools into a target toolbar at an item-space index.
 * The origin is pruned when emptied; the session origin follows the tools.
 *
 * Restructuring happens only on a highlighted DZ: callers must gate on
 * `isItemSpaceFree` (which mirrors the highlight decision) and skip the
 * commit otherwise — hovering a dark gap never moves tools.
 *
 * Same-toolbar forward moves adjust for the prune shift: the hovered gap
 * index is read against the pre-prune toolbar, but the tools land in the
 * pruned one — so a gap after removed tools shifts back by the count of
 * dragged tools before it. ABCD with B dragged onto gap 3 (between C and
 * D) lands between C and D, not after D.
 *
 * Returns the refreshed whole-toolbar flag (also stored on the session)
 * so adapters update without re-deriving.
 */
export function commitDraggedToItemSpace(
	dragging: DraggingState,
	targetToolbar: Toolbar,
	targetTrack: Track,
	targetBorder: Border,
	itemSpaceIndex: number
): { readonly moved: boolean; readonly isWholeToolbar: boolean } {
	if (dragging.tools.length === 0) return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	// Dark DZs never restructure: the gap must be highlighted (free).
	if (!isItemSpaceFree(dragging, targetToolbar, itemSpaceIndex))
		return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	const sameToolbar = targetToolbar === dragging.origin.toolbar
	let removedBefore = 0
	if (sameToolbar) {
		for (let index = 0; index < itemSpaceIndex && index <= targetToolbar.length; index += 1) {
			const tool = targetToolbar[index]
			if (tool !== undefined && dragging.tools.includes(tool)) removedBefore += 1
		}
	}
	pruneDragOrigin(dragging)
	const clampedIndex = Math.min(Math.max(itemSpaceIndex - removedBefore, 0), targetToolbar.length)
	targetToolbar.splice(clampedIndex, 0, ...dragging.tools)
	dragging.origin = {
		kind: 'border',
		toolbar: targetToolbar,
		track: targetTrack,
		border: targetBorder,
	}
	refreshDragMode(dragging)
	return { moved: true, isWholeToolbar: dragging.isWholeToolbar }
}

/**
 * Commit the dragged tools into a track gap, entering (or continuing)
 * toolbar sliding. `'slide'` relocates `origin.toolbar` itself (identity
 * preserved); `'restructure'` extracts the tools into a fresh singleton.
 * While sliding, the two gaps flanking the toolbar are not destinations.
 *
 * Restructuring happens only on a highlighted DZ: the sliding-flank veto
 * mirrors the highlight decision, so hovering a dark gap never moves tools.
 * Returns the refreshed whole-toolbar flag (also stored on the session).
 */
export function commitDraggedToTrackSpace(
	dragging: DraggingState,
	targetTrack: Track,
	targetBorder: Border,
	trackSpaceIndex: number
): { readonly moved: boolean; readonly isWholeToolbar: boolean } {
	if (dragging.tools.length === 0) return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	if (isSlidingFlank(dragging, targetTrack, trackSpaceIndex))
		return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	const originTrack = dragging.origin.kind === 'border' ? dragging.origin.track : undefined
	const mode = dragging.isWholeToolbar ? 'slide' : 'restructure'
	const taken = takeDraggedTools(dragging, mode)
	const destination = taken.destination
	const prunedSlot = taken.prunedSlot
	let insertionIndex = trackSpaceIndex
	if (
		originTrack !== undefined &&
		targetTrack === originTrack &&
		prunedSlot >= 0 &&
		prunedSlot < trackSpaceIndex
	) {
		insertionIndex -= 1
	}
	insertionIndex = Math.min(Math.max(insertionIndex, 0), targetTrack.length)
	insertToolbar(targetTrack, insertionIndex, destination, configuration.trackGapSplit)
	if (mode === 'restructure') destination.push(...dragging.tools)
	const placed = targetTrack[insertionIndex]?.toolbar ?? destination
	dragging.origin = { kind: 'border', toolbar: placed, track: targetTrack, border: targetBorder }
	refreshDragMode(dragging)
	return { moved: true, isWholeToolbar: dragging.isWholeToolbar }
}

/**
 * Commit the dragged tools into a stack gap, creating a new single-toolbar
 * track at that stack. The emptied-track veto mirrors the highlight rule: a
 * drag that would empty its origin track cannot land on the two stacks
 * touching that track. Returns the refreshed whole-toolbar flag (also
 * stored on the session).
 */
export function commitDraggedToStackSpace(
	dragging: DraggingState,
	targetBorder: Border,
	stackIndex: number
): { readonly moved: boolean; readonly isWholeToolbar: boolean } {
	if (dragging.tools.length === 0) return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	const mode = dragging.isWholeToolbar ? 'slide' : 'restructure'
	if (dragging.origin.kind === 'border') {
		const emptied = draggingEmptiesTrackIndex(dragging, targetBorder)
		if (emptied !== undefined && (stackIndex === emptied || stackIndex === emptied + 1))
			return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	}
	const originBorder = dragging.origin.kind === 'border' ? dragging.origin.border : undefined
	const originTrack = dragging.origin.kind === 'border' ? dragging.origin.track : undefined
	const originTrackBefore =
		originBorder !== undefined && originTrack !== undefined ? originBorder.indexOf(originTrack) : -1
	const destination = takeDraggedTools(dragging, mode).destination
	let at = stackIndex
	if (
		originBorder !== undefined &&
		originTrack !== undefined &&
		targetBorder === originBorder &&
		originTrackBefore >= 0 &&
		!originBorder.includes(originTrack) &&
		originTrackBefore < stackIndex
	) {
		at -= 1
	}
	if (mode === 'restructure') destination.push(...dragging.tools)
	const { track: placedTrack, trackIndex } = insertTrackWithToolbar(targetBorder, at, destination)
	const placed = targetBorder[trackIndex] ?? placedTrack
	const placedToolbar = placed[0]?.toolbar ?? destination
	dragging.origin = { kind: 'border', toolbar: placedToolbar, track: placed, border: targetBorder }
	refreshDragMode(dragging)
	return { moved: true, isWholeToolbar: dragging.isWholeToolbar }
}

/**
 * Commit the dragged tools into a parking stack gap, creating a new row at
 * that gap. Parking analogue of `commitDraggedToStackSpace` (no tracks, no
 * spacing to split). The emptied-row veto mirrors the highlight rule.
 * Returns the refreshed whole-toolbar flag (also stored on the session).
 */
export function commitDraggedToParkingRow(
	dragging: DraggingState,
	targetParking: Parking,
	gapIndex: number
): { readonly moved: boolean; readonly isWholeToolbar: boolean } {
	if (dragging.tools.length === 0) return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	const mode = dragging.isWholeToolbar ? 'slide' : 'restructure'
	if (dragging.origin.kind === 'parking') {
		const emptied = draggingEmptiesParkingRow(dragging, targetParking)
		if (emptied !== undefined && (gapIndex === emptied || gapIndex === emptied + 1))
			return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	}
	const originParking = dragging.origin.kind === 'parking' ? dragging.origin.parking : undefined
	const originRowBefore =
		originParking !== undefined ? originParking.indexOf(dragging.origin.toolbar) : -1
	const { destination } = takeDraggedTools(dragging, mode)
	let at = gapIndex
	if (
		originParking !== undefined &&
		targetParking === originParking &&
		originRowBefore >= 0 &&
		targetParking.indexOf(dragging.origin.toolbar) < 0 &&
		originRowBefore < gapIndex
	) {
		at -= 1
	}
	at = Math.min(Math.max(at, 0), targetParking.length)
	if (mode === 'restructure') destination.push(...dragging.tools)
	targetParking.splice(at, 0, destination)
	const placed = targetParking[at] ?? destination
	dragging.origin = { kind: 'parking', toolbar: placed, parking: targetParking, index: at }
	refreshDragMode(dragging)
	return { moved: true, isWholeToolbar: dragging.isWholeToolbar }
}

/**
 * Commit the dragged tools into a parking row at an item-space index
 * (ownership-transfer merge into an existing row). Restructuring happens
 * only on a highlighted DZ: dark gaps never move tools. Returns the
 * refreshed whole-toolbar flag (also stored on the session).
 */
export function commitDraggedToParking(
	dragging: DraggingState,
	targetToolbar: Toolbar,
	targetParking: Parking,
	targetIndex: number,
	itemSpaceIndex: number
): { readonly moved: boolean; readonly isWholeToolbar: boolean } {
	if (dragging.tools.length === 0) return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	if (!isItemSpaceFree(dragging, targetToolbar, itemSpaceIndex))
		return { moved: false, isWholeToolbar: dragging.isWholeToolbar }
	pruneDragOrigin(dragging)
	const clampedIndex = Math.min(Math.max(itemSpaceIndex, 0), targetToolbar.length)
	targetToolbar.splice(clampedIndex, 0, ...dragging.tools)
	const placed = targetParking[targetIndex] ?? targetToolbar
	dragging.origin = {
		kind: 'parking',
		toolbar: placed,
		parking: targetParking,
		index: Math.min(Math.max(targetIndex, 0), Math.max(targetParking.length - 1, 0)),
	}
	refreshDragMode(dragging)
	return { moved: true, isWholeToolbar: dragging.isWholeToolbar }
}

/**
 * Relocate a toolbar between tracks / stacks (whole-toolbar slide commit).
 * Thin wrapper over the track primitives for the release path.
 */
export function moveToolbarToTrack(
	dragging: DraggingState,
	targetTrack: Track,
	targetBorder: Border,
	trackSpaceIndex: number
): { readonly moved: boolean; readonly isWholeToolbar: boolean } {
	return commitDraggedToTrackSpace(dragging, targetTrack, targetBorder, trackSpaceIndex)
}

/**
 * Relocate a toolbar to a stack gap (new single-toolbar track).
 * Thin wrapper over the stack primitive for the release path.
 */
export function moveToolbarToStack(
	dragging: DraggingState,
	targetBorder: Border,
	stackIndex: number
): { readonly moved: boolean; readonly isWholeToolbar: boolean } {
	return commitDraggedToStackSpace(dragging, targetBorder, stackIndex)
}

/**
 * Canonical point id for a toolbar item: the string spec's point id
 * (setter `=`/`|` and action `:` suffixes stripped, so `alertLevel`,
 * `alertLevel=red`, and `alertLevel|red` fingerprint as the same point),
 * or the inline definition's own `id`. Pointless items fingerprint on `editor`.
 */
export function canonicalItemTool(item: ToolbarItem): string {
	const spec = (item as { tool?: unknown }).tool
	if (typeof spec === 'string') {
		const setter = spec.search(/[=|]/)
		const colon = spec.indexOf(':')
		const cut =
			setter >= 0 && (colon < 0 || setter < colon) ? setter : colon >= 0 ? colon : spec.length
		return spec.slice(0, cut)
	}
	if (spec !== null && typeof spec === 'object') return canonicalSpecId(spec as never) ?? ''
	return ''
}

/**
 * Stable structural fingerprint of an instantiated tool: canonical point (or
 * pointless editor) + editor variant + stable-stringified config.
 * Position is NOT part of the fingerprint — it is the container that makes
 * two identical fingerprints two distinct instances.
 */
export function itemFingerprint(item: ToolbarItem): string {
	const tool = canonicalItemTool(item)
	const editor = (item as { editor?: unknown }).editor
	const config = (item as { config?: unknown }).config
	return JSON.stringify([tool, typeof editor === 'string' ? editor : null, stableStringify(config)])
}

function stableStringify(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableStringify)
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>
		const sorted: Record<string, unknown> = {}
		for (const key of Object.keys(record).sort()) sorted[key] = stableStringify(record[key])
		return sorted
	}
	return value ?? null
}

/**
 * Single-ownership invariant: every toolbar/item object lives in exactly one
 * container. Scans borders + parking for shared `===` references (the same
 * object rendered twice) and for structural duplicates (same fingerprint in
 * two places).
 *
 * @returns Human-readable violations (empty = invariant holds).
 */
export function findOwnershipViolations(options: {
	borders: Borders
	parking?: Parking
}): string[] {
	const { borders, parking } = options
	const violations: string[] = []
	const toolbarOwners = new Map<Toolbar, string>()
	const itemOwners = new Map<ToolbarItem, string>()
	const fingerprints = new Map<string, string>()
	function claimToolbar(toolbar: Toolbar, where: string): void {
		const owner = toolbarOwners.get(toolbar)
		if (owner !== undefined) violations.push(`toolbar shared by ${owner} and ${where}`)
		else toolbarOwners.set(toolbar, where)
	}
	function claimItem(item: ToolbarItem, where: string): void {
		const owner = itemOwners.get(item)
		if (owner !== undefined) violations.push(`item shared by ${owner} and ${where}`)
		else itemOwners.set(item, where)
		const fingerprint = itemFingerprint(item)
		const first = fingerprints.get(fingerprint)
		if (first !== undefined)
			violations.push(`duplicate item ${fingerprint} in ${first} and ${where}`)
		else fingerprints.set(fingerprint, where)
	}
	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	for (const region of regions) {
		const border = borders[region] ?? []
		border.forEach((track, trackIndex) => {
			track.forEach((slot, slotIndex) => {
				const where = `${region}[${trackIndex}][${slotIndex}]`
				claimToolbar(slot.toolbar, where)
				slot.toolbar.forEach((item, itemIndex) => claimItem(item, `${where}#${itemIndex}`))
			})
		})
	}
	parking?.forEach((toolbar, index) => {
		const where = `parking[${index}]`
		claimToolbar(toolbar, where)
		toolbar.forEach((item, itemIndex) => claimItem(item, `${where}#${itemIndex}`))
	})
	return violations
}
