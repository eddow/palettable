/**
 * `@palettable/core` — SSR render model (Phase 7).
 *
 * Implements `plans/ssr.md` §4.3–§4.8 on top of the Phases 3–5 surface:
 * a pure, synchronous resolver from (definitions + virtuals + layout +
 * values) to a render tree, plus an atomic snapshot, configuration pinning,
 * custom-type value codecs, and the import-graph / determinism guarantees.
 *
 * Guarantees: no subscriptions, no timers, no `run()`, no `set()`, no DOM;
 * same input → `JSON.stringify`-identical output. The render path imports
 * only pure modules — never `globals.ts` or `umd.ts`
 * (enforced by `render.test.ts` import-graph test).
 *
 * Context: the input shape is bag-extensible (optional `bags`, threaded
 * through for Phase 8 resolvers — not a single-store assumption).
 */
import type { PaletteConfiguration } from './configuration.js'
import { configuration } from './configuration.js'
import type { EditorCapability, EditorDefaults, EditorRegistry } from './editors.js'
import { PaletteError } from './errors.js'
import type { KeyBindings } from './keys.js'
import { findKeystrokesFor, findKeystrokesForTarget } from './keys.js'
import type {
	AnySerializedLayout,
	PaletteLayout,
	PaletteRegion,
	SerializedLayout,
	SerializedToolbarItem,
	SurfaceContext,
	ToolbarItem,
} from './layout.js'
import { isDrawerItem, snapshotLayout, validateSerializedLayout } from './layout.js'
import type { ServerPointDescriptor } from './palette.js'
import type { ActionPoint, AnyPoint, AnyValuedPoint } from './points.js'
import { isActionPoint, isNothingPoint, isValuedPoint } from './points.js'
import { axisForRegion, drawerChildAxis, resolveEditorVariant } from './presenters.js'
import { canonicalPointId, canonicalSpecId, isInlineSpec, parsePointSpec } from './specs.js'
import type { VirtualPoint } from './virtual.js'
import { isEnumFromPoint, isStashPoint, matchEnumOption } from './virtual.js'

/** Max drawer nesting depth (guards against pathological layouts). */
export const RENDER_MAX_DEPTH = 8

/** One resolved toolbar item in the render tree. */
export type ResolvedItem = {
	/** Canonical point id (`canonicalPointId`) — every tool is bound. */
	readonly pointId: string | undefined
	/** Point descriptor (no `run` closure) — nothing-points carry descriptor only. */
	readonly descriptor: ServerPointDescriptor | undefined
	/** Current value / enum-from key / stash pressed-state (see below). */
	readonly value: unknown
	/** Single resolved editor variant id (canonical fallback chain). */
	readonly editor: string | undefined
	/** Capabilities of the resolved variant (or `undefined` when unresolved). */
	readonly capability: EditorCapability | undefined
	/** Keystrokes bound to this item's spec. */
	readonly keystrokes: readonly string[]
	/**
	 * Drawer children: one track (slots with spacing + toolbar), recursive
	 * and depth-bounded; empty for non-drawers.
	 */
	readonly children: readonly ResolvedDrawerSlot[]
	/** Item config payload (by reference — adapter clones before crossing the wire). */
	readonly config: Record<string, unknown> | undefined
}

/** One resolved toolbar (ordered items). */
export type ResolvedToolbar = {
	readonly items: readonly ResolvedItem[]
}

/** One resolved track slot (spacing + toolbar). */
export type ResolvedTrackSlot = {
	readonly space: number
	readonly toolbar: ResolvedToolbar
}

/** One resolved drawer child slot (spacing + toolbar — drawer content is one track). */
export type ResolvedDrawerSlot = {
	readonly space: number
	readonly toolbar: ResolvedToolbar
}

/** Resolved region: ordered track slots. */
export type ResolvedRegion = {
	readonly slots: readonly ResolvedTrackSlot[]
}

/** Full render tree: four regions + parking. */
export type ResolvedPalette = {
	readonly borders: Record<PaletteRegion, ResolvedRegion>
	readonly parking: readonly ResolvedToolbar[]
}

/** Atomic palette snapshot (anti-tear: layout + values taken as one unit). */
export type PaletteSnapshot = {
	readonly layout: SerializedLayout
	readonly values: Record<string, unknown>
	readonly virtuals: readonly VirtualPoint[]
	readonly configuration: PaletteConfiguration
}

/** Input for `resolveRenderTree` (all plain data — no class instances). */
export type RenderInput = {
	readonly points: readonly AnyPoint[]
	readonly virtuals?: readonly VirtualPoint[]
	readonly layout: AnySerializedLayout | PaletteLayout
	readonly values: Readonly<Record<string, unknown>>
	readonly keys?: KeyBindings
	readonly editors?: EditorRegistry
	readonly editorDefaults?: EditorDefaults
	/**
	 * Pinned configuration (defaults to the live singleton for back-compat).
	 * Only `trackGapMinGrow` affects resting geometry: track-gap slots with
	 * `space` below the floor resolve to the floor (adapters apply the same
	 * floor at render, see `configuration.trackGapMinGrow`). The two `…Ms`
	 * timeouts never affect SSR output but are pinned for the hydration check.
	 */
	readonly configuration?: PaletteConfiguration
	/** Optional context bags (accepted, threaded through for resolvers). */
	readonly bags?: readonly unknown[]
}

/**
 * Take an atomic snapshot from live core state: layout snapshot +
 * values snapshot + virtuals + pinned configuration, captured as one unit
 * (no layout/values tear). Values are by reference (like `asObject()` —
 * the adapter must `structuredClone`/serialize before crossing the wire);
 * core never mutates a snapshot it handed out.
 */
export function snapshotPalette(input: {
	readonly virtuals?: readonly VirtualPoint[]
	readonly layout: AnySerializedLayout | PaletteLayout
	readonly values: Readonly<Record<string, unknown>>
	readonly configuration?: PaletteConfiguration
}): PaletteSnapshot {
	const version = (input.layout as { version?: unknown }).version
	const layout: SerializedLayout =
		version === 1 || version === 2
			? structuredCloneLayout(input.layout as SerializedLayout)
			: liveToSnapshot(input.layout as PaletteLayout)
	return {
		layout,
		values: { ...input.values },
		virtuals: [...(input.virtuals ?? [])],
		configuration: { ...(input.configuration ?? configuration) },
	}
}

function structuredCloneLayout(layout: SerializedLayout): SerializedLayout {
	return JSON.parse(JSON.stringify(layout)) as SerializedLayout
}

/**
 * Serialize a live layout via the canonical `layout.ts` serializer
 * (`snapshotLayout` — flat slot list, inline definitions deep-cloned via
 * `cloneValue`). No private duplicate: the render path is read-only, so
 * the same serializer the tree uses is exactly right here.
 */
function liveToSnapshot(layout: PaletteLayout): SerializedLayout {
	return snapshotLayout(layout)
}

/**
 * Pure resolver: definitions + virtuals + layout + values → render tree.
 * Never calls `run()`, never subscribes, never touches timers or DOM.
 * Same input → `JSON.stringify`-identical output.
 */
export function resolveRenderTree(input: RenderInput): ResolvedPalette {
	const definitions = new Map<string, AnyPoint>()
	for (const point of input.points) definitions.set(point.id, point)
	const virtuals = new Map<string, VirtualPoint>()
	for (const virtual of input.virtuals ?? []) virtuals.set(virtual.id, virtual)
	const values = input.values
	const keys = input.keys ?? {}
	const gapFloor = input.configuration?.trackGapMinGrow ?? configuration.trackGapMinGrow

	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	const borders = {} as Record<PaletteRegion, ResolvedRegion>
	const live = toLiveSlots(input.layout)
	for (const region of regions) {
		const axis = axisForRegion(region)
		const surface: SurfaceContext = { axis, region }
		borders[region] = {
			slots: live.borders[region].map((slot) => ({
				space: Math.max(slot.space, gapFloor),
				toolbar: {
					items: slot.toolbar.map((item) =>
						resolveItem(item, { definitions, virtuals, values, keys, surface, depth: 0, input })
					),
				},
			})),
		}
	}
	return {
		borders,
		parking: live.parking.map((toolbar) => ({
			items: toolbar.map((item) =>
				resolveItem(item, {
					definitions,
					virtuals,
					values,
					keys,
					surface: { axis: 'horizontal' },
					depth: 0,
					input,
				})
			),
		})),
	}
}

type ResolveContext = {
	readonly definitions: ReadonlyMap<string, AnyPoint>
	readonly virtuals: ReadonlyMap<string, VirtualPoint>
	readonly values: Readonly<Record<string, unknown>>
	readonly keys: KeyBindings
	readonly surface: SurfaceContext
	readonly depth: number
	readonly input: RenderInput
}

function resolveItem(item: ToolbarItem, context: ResolveContext): ResolvedItem {
	const bound = (item as { tool?: unknown }).tool
	if (typeof bound !== 'string' && !isInlineSpec(bound))
		throw new PaletteError('resolveRenderTree: toolbar item has no bound point')
	if (isDrawerItem(item)) {
		if (typeof bound !== 'string')
			throw new PaletteError('resolveRenderTree: drawer must bind a nothing-point by id')
		if (context.depth >= RENDER_MAX_DEPTH)
			throw new PaletteError(`resolveRenderTree: drawer nesting exceeds ${RENDER_MAX_DEPTH}`)
		const drawerParsed = parsePointSpec(bound)
		const drawerDef = context.definitions.get(drawerParsed.pointId)
		if (drawerDef === undefined || !isNothingPoint(drawerDef))
			throw new PaletteError(`resolveRenderTree: drawer "${bound}" must bind a nothing-point`)
		const { can: _drawerCan, ...drawerDescriptor } = drawerDef as Record<string, unknown>
		const childAxis = drawerChildAxis(
			context.surface.axis === 'vertical' ? 'vertical' : 'horizontal'
		)
		const childSurface: SurfaceContext = { axis: childAxis, region: context.surface.region }
		return {
			pointId: drawerParsed.pointId,
			descriptor: { ...drawerDescriptor } as ServerPointDescriptor,
			value: undefined,
			editor: 'drawer',
			capability: lookupCapability(context, 'item', 'drawer'),
			keystrokes: findKeystrokesFor(context.keys, drawerParsed.pointId),
			children: item.toolbar.map((slot) => ({
				space: slot.space,
				toolbar: {
					items: slot.toolbar.map((child) =>
						resolveItem(child, { ...context, surface: childSurface, depth: context.depth + 1 })
					),
				},
			})),
			config: item.config as Record<string, unknown> | undefined,
		}
	}
	if (isInlineSpec(bound)) {
		return resolveInlineItem(item, bound, context)
	}
	const spec = bound as string
	const parsed = parsePointSpec(spec)
	const pointId = parsed.pointId
	const virtual = context.virtuals.get(canonicalPointId(spec))
	if (virtual !== undefined) {
		return resolveVirtualItem(item, virtual, parsed, context)
	}
	const def = context.definitions.get(pointId)
	if (def === undefined) throw new PaletteError(`resolveRenderTree: unknown point "${pointId}"`)
	return resolvePointItem(item, def, spec, context)
}

function resolveInlineItem(
	item: ToolbarItem,
	virtual: VirtualPoint,
	context: ResolveContext
): ResolvedItem {
	const source = context.definitions.get(virtual.source)
	const sourceValue = source !== undefined ? context.values[source.id] : undefined
	// Virtuals have no point definition — resolve the editor variant against
	// the family they present as (`enum` for enum-from, `action` for stash)
	// so server/client agree on variant eligibility (SSR §4.3).
	// Family probe carries no `defaultValue` (core holds no defaults).
	const familyPoint = (
		isEnumFromPoint(virtual)
			? { id: virtual.id, label: virtual.label, type: 'enum' }
			: { id: virtual.id, label: virtual.label, type: 'action', run: () => {} }
	) as AnyPoint
	const editor = resolveEditorVariant(
		familyPoint,
		context.surface,
		context.input.editors,
		context.input.editorDefaults,
		(item as { editor?: string }).editor
	)
	if (isEnumFromPoint(virtual)) {
		const key = matchEnumOption(virtual, sourceValue)?.key
		return {
			pointId: virtual.id,
			descriptor: undefined,
			value: key,
			editor,
			capability: lookupCapability(context, 'enum', editor),
			keystrokes: findKeystrokesForTarget(context.keys, virtual),
			children: [],
			config: (item as { config?: Record<string, unknown> }).config,
		}
	}
	return {
		pointId: virtual.id,
		descriptor: undefined,
		value: Object.is(sourceValue, virtual.stashedValue),
		editor,
		capability: lookupCapability(context, 'action', editor),
		keystrokes: findKeystrokesForTarget(context.keys, virtual),
		children: [],
		config: (item as { config?: Record<string, unknown> }).config,
	}
}

function resolveVirtualItem(
	item: ToolbarItem,
	virtual: VirtualPoint,
	parsed: ReturnType<typeof parsePointSpec>,
	context: ResolveContext
): ResolvedItem {
	const virtualId: string = virtual.id
	const source = context.definitions.get(virtual.source)
	const sourceValue = source !== undefined ? context.values[source.id] : undefined
	// Same family-point trick as `resolveInlineItem` (SSR §4.3).
	const familyPoint = (
		isEnumFromPoint(virtual)
			? { id: virtual.id, label: virtual.label, type: 'enum' }
			: { id: virtual.id, label: virtual.label, type: 'action', run: () => {} }
	) as AnyPoint
	const editor = resolveEditorVariant(
		familyPoint,
		context.surface,
		context.input.editors,
		context.input.editorDefaults,
		(item as { editor?: string }).editor
	)
	if (isEnumFromPoint(virtual)) {
		const key =
			parsed.kind === 'setter'
				? parsed.value
				: (matchEnumOption(virtual, sourceValue)?.key ?? undefined)
		return {
			pointId: virtual.id,
			descriptor: undefined,
			value: key,
			editor,
			capability: lookupCapability(context, 'enum', editor),
			keystrokes: findKeystrokesFor(context.keys, virtual.id),
			children: [],
			config: (item as { config?: Record<string, unknown> }).config,
		}
	}
	if (isStashPoint(virtual)) {
		return {
			pointId: virtual.id,
			descriptor: undefined,
			value: Object.is(sourceValue, virtual.stashedValue),
			editor,
			capability: lookupCapability(context, 'action', editor),
			keystrokes: findKeystrokesFor(context.keys, virtual.id),
			children: [],
			config: (item as { config?: Record<string, unknown> }).config,
		}
	}
	throw new PaletteError(`resolveRenderTree: unknown virtual kind "${virtualId}"`)
}

function resolvePointItem(
	item: ToolbarItem,
	def: AnyPoint,
	spec: string,
	context: ResolveContext
): ResolvedItem {
	const pointId = canonicalPointId(spec)
	const editor = resolveEditorVariant(
		def,
		context.surface,
		context.input.editors,
		context.input.editorDefaults,
		(item as { editor?: string }).editor
	)
	const family = isActionPoint(def)
		? 'action'
		: isValuedPoint(def)
			? def.type
			: ('nothing' as const)
	const keystrokes = findKeystrokesFor(context.keys, pointId)
	const config = (item as { config?: Record<string, unknown> }).config
	if (isActionPoint(def)) {
		const { run: _run, can: _can, ...descriptor } = def as ActionPoint & Record<string, unknown>
		return {
			pointId,
			descriptor: { ...descriptor } as ServerPointDescriptor,
			value: undefined,
			editor,
			capability: lookupCapability(context, family, editor),
			keystrokes,
			children: [],
			config,
		}
	}
	if (isValuedPoint(def)) {
		const { can: _can, ...descriptor } = def as AnyValuedPoint & Record<string, unknown>
		return {
			pointId,
			descriptor: { ...descriptor } as ServerPointDescriptor,
			value: context.values[pointId],
			editor,
			capability: lookupCapability(context, family, editor),
			keystrokes,
			children: [],
			config,
		}
	}
	// Nothing-points carry no value (Context §1.2): descriptor only.
	const { can: _nothingCan, ...nothingDescriptor } = def as Record<string, unknown>
	return {
		pointId,
		descriptor: { ...nothingDescriptor } as ServerPointDescriptor,
		value: undefined,
		editor,
		capability: lookupCapability(context, family, editor),
		keystrokes,
		children: [],
		config,
	}
}

function lookupCapability(
	context: ResolveContext,
	family: string,
	editor: string | undefined
): EditorCapability | undefined {
	if (editor === undefined) return undefined
	const variants = context.input.editors?.[family as keyof typeof context.input.editors] as
		| Record<string, EditorCapability>
		| undefined
	return variants?.[editor]
}

// ── Wire snapshot helpers ───────────────────────────────────────────────────

type LiveSlots = {
	readonly borders: Record<
		PaletteRegion,
		readonly { readonly space: number; readonly toolbar: readonly ToolbarItem[] }[]
	>
	readonly parking: readonly (readonly ToolbarItem[])[]
}

function toLiveSlots(layout: AnySerializedLayout | PaletteLayout): LiveSlots {
	const version = (layout as { version?: unknown }).version
	if (version === 1 || version === 2) {
		const serialized = layout as AnySerializedLayout
		let validated = false
		try {
			validated = validateSerializedLayout(serialized)
		} catch {
			validated = false
		}
		if (!validated) throw new PaletteError('resolveRenderTree: invalid SerializedLayout')
		const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
		const borders = {} as Record<
			PaletteRegion,
			{ readonly space: number; readonly toolbar: readonly ToolbarItem[] }[]
		>
		for (const region of regions) {
			// v2 regions are track lists (boundaries preserved); v1 regions
			// are flat slot lists (each slot = its own single-slot track).
			const border =
				version === 2
					? (serialized as SerializedLayout).borders[region].flat()
					: (serialized as import('./layout.js').SerializedLayoutV1).borders[region]
			borders[region] = border.map((slot) => ({
				space: slot.space,
				toolbar: slot.toolbar.map((item) => serializedItemToLive(item)),
			}))
		}
		return {
			borders,
			parking: (serialized.parking ?? []).map((toolbar) =>
				toolbar.map((item) => serializedItemToLive(item))
			),
		}
	}
	if (version !== undefined)
		throw new PaletteError(`resolveRenderTree: unknown layout version ${String(version)}`)
	const live = layout as PaletteLayout
	const regions = ['top', 'right', 'bottom', 'left'] as const
	const borders = {} as LiveSlots['borders']
	try {
		for (const region of regions) {
			borders[region] = live.borders[region].flatMap((track) =>
				track.map((slot) => ({
					space: (slot as { space: number }).space,
					toolbar: (slot as { toolbar: readonly ToolbarItem[] }).toolbar,
				}))
			)
		}
		return {
			borders,
			parking: live.parking as LiveSlots['parking'],
		}
	} catch {
		throw new PaletteError('resolveRenderTree: invalid SerializedLayout')
	}
}

function serializedItemToLive(item: SerializedToolbarItem): ToolbarItem {
	if (item.toolbar !== undefined) {
		return {
			tool: typeof item.tool === 'string' ? item.tool : (item.tool ?? 'drawer'),
			editor: 'drawer',
			config: item.config,
			toolbar: item.toolbar.map((slot) => ({
				space: slot.space,
				toolbar: slot.toolbar.map((child) => serializedItemToLive(child)),
			})),
		} as ToolbarItem
	}
	if (item.tool === undefined) {
		// Back-compat: pre-nothing-point payloads carry bare
		// `{ editor: 'status' }` — migrate to `{ tool: editor, editor }`.
		return {
			tool: item.editor ?? 'status',
			editor: item.editor ?? 'status',
			config: item.config,
		} as ToolbarItem
	}
	return { tool: item.tool, editor: item.editor, config: item.config } as ToolbarItem
}

// ── Value codecs (custom types) ─────────────────────────────────────────────
// Built-ins use identity; custom `TypeMap` entries register a codec or are
// SSR-unsafe-by-default (loud failure, never silent mismatch).

/** JSON-safe value codec for one custom point type. */
export type ValueCodec<T = unknown> = {
	serialize(value: T): unknown
	deserialize(json: unknown): T
}

const valueCodecs = new Map<string, ValueCodec>()

/** Register a value codec for a custom point type id. */
export function registerValueCodec(type: string, codec: ValueCodec): void {
	valueCodecs.set(type, codec)
}

/** Clear all registered value codecs (tests). */
export function clearValueCodecs(): void {
	valueCodecs.clear()
}

/**
 * Serialize a value for the wire snapshot. Built-ins pass through;
 * custom types need a registered codec, else throw (SSR-unsafe-by-default).
 */
export function serializeValue(type: string, value: unknown): unknown {
	if (type === 'boolean' || type === 'number' || type === 'string' || type === 'enum') {
		return value
	}
	const codec = valueCodecs.get(type)
	if (codec === undefined)
		throw new PaletteError(
			`serializeValue: no codec registered for custom type "${type}" (SSR-unsafe by default)`
		)
	return codec.serialize(value)
}

/**
 * Deserialize a wire value. Built-ins pass through; custom types need a
 * registered codec, else throw.
 */
export function deserializeValue(type: string, json: unknown): unknown {
	if (type === 'boolean' || type === 'number' || type === 'string' || type === 'enum') {
		return json
	}
	const codec = valueCodecs.get(type)
	if (codec === undefined)
		throw new PaletteError(
			`deserializeValue: no codec registered for custom type "${type}" (SSR-unsafe by default)`
		)
	return codec.deserialize(json)
}

/** Serialize a values record for the wire (built-ins identity, customs via codecs). */
export function serializeValues(
	values: Readonly<Record<string, unknown>>,
	points: readonly AnyPoint[]
): Record<string, unknown> {
	const types = new Map(points.map((point) => [point.id, point.type]))
	const out: Record<string, unknown> = {}
	for (const [id, value] of Object.entries(values)) {
		out[id] = serializeValue(types.get(id) ?? 'string', value)
	}
	return out
}

/** Deserialize a wire values record (built-ins identity, customs via codecs). */
export function deserializeValues(
	values: Readonly<Record<string, unknown>>,
	points: readonly AnyPoint[]
): Record<string, unknown> {
	const types = new Map(points.map((point) => [point.id, point.type]))
	const out: Record<string, unknown> = {}
	for (const [id, value] of Object.entries(values)) {
		out[id] = deserializeValue(types.get(id) ?? 'string', value)
	}
	return out
}

// ── Canonical spec id (re-export for render consumers) ──────────────────────

export { canonicalSpecId }
