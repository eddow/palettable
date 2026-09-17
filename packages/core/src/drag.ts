/**
 * `@palettable/core` — drag session (Phases 1–3 of the drag-interface plan).
 *
 * `GrabTarget` / `Hoverable` / `PointerSample` are the wire vocabulary for the
 * session interface (`PaletteLayoutTree.createDrag`): `Hoverable` in,
 * `DragEvent` out. `DragElement` / `DragPointer` stay as deprecated aliases
 * until the Phase 7 close-out so existing call sites (`layout.test.ts`) keep
 * compiling while the session is mounted.
 */

import { configuration } from './configuration.js'
import { PaletteError } from './errors.js'
import { clearHostTimeout, scheduleHostTimeout, scheduleMicrotask } from './globals.js'
import type {
	Border,
	DragElement,
	DraggingState,
	DragOverDecision,
	LayoutOp,
	PaletteLayout,
	PaletteLayoutTree,
	Parking,
	Toolbar,
	ToolbarItem,
	Track,
} from './layout.js'

/**
 * The legacy drag engine the session delegates to.
 *
 * @deprecated Phase 7 — folds into the session; do not add new callers.
 *
 * Injected by `layout.ts` rather than imported: `layout.ts` owns the engine
 * (`dragStart` / `dragOver` / `commitDraggedTo*`) and imports this module for
 * `createDrag`, so a value import back would be a module cycle. Phase 7 folds
 * the engine into the session and this parameter disappears.
 */
export type DragEngine = {
	dragStart(layout: PaletteLayout, element: DragElement): DraggingState
	dragOver(
		session: DraggingState,
		layout: PaletteLayout,
		element: DragElement,
		pointer: { readonly activeItem?: number; readonly client?: number },
		editing: boolean
	): DragOverDecision
	commitDraggedToStackSpace(
		session: DraggingState,
		targetBorder: Border,
		stackIndex: number
	): { readonly moved: boolean; readonly isWholeToolbar: boolean }
	commitDraggedToParkingRow(
		session: DraggingState,
		targetParking: Parking,
		gapIndex: number
	): { readonly moved: boolean; readonly isWholeToolbar: boolean }
	/**
	 * Phase 5 flank derivation: the stack gaps flanking `trackIndex` in
	 * `border` (emptied veto applied) — what every in-track hover paints in
	 * addition to its own DZs. Implemented in `layout.ts` so the veto rule
	 * (and the module cycle) stay there.
	 */
	stackFlanks(session: DraggingState, border: Border, trackIndex: number): readonly number[]
}

/** What was grabbed. `catalog` has no container — it is a creation (Phase 6). */
export type GrabTarget =
	| { readonly kind: 'tool'; readonly toolbar: Toolbar; readonly item: ToolbarItem }
	| { readonly kind: 'toolbar'; readonly toolbar: Toolbar }
	| { readonly kind: 'catalog'; readonly item: ToolbarItem }

/** A gap that can paint: the `highlight` event payload (Phase 2). */
export type DropZone =
	| { readonly kind: 'item-gap'; readonly toolbar: Toolbar; readonly gap: number }
	| { readonly kind: 'track-gap'; readonly track: Track; readonly gap: number }
	| { readonly kind: 'stack-gap'; readonly border: Border; readonly gap: number }
	| { readonly kind: 'parking-gap'; readonly parking: Parking; readonly gap: number }
	/** Beside `border`, aligned with its stack gap `gap` (same index space; Phase 6). */
	| { readonly kind: 'outside'; readonly border: Border; readonly gap: number }

/** `off` clears the gap; `double` is the directly-hovered parallel stack DZ. */
export type HighlightState = 'off' | 'on' | 'double'

/** Events the session raises on the layout's single event stream. */
export type DragEvent =
	| { readonly type: 'highlight'; readonly dz: DropZone; readonly state: HighlightState }
	| { readonly type: 'slide'; readonly toolbar: Toolbar; readonly delta: number }
	| { readonly type: 'clearSlide'; readonly toolbar: Toolbar }
	/** Slide release: the two flanking `space` values were written by core. */
	| {
			readonly type: 'resize'
			readonly track: Track
			readonly index: number
			readonly split: number
	  }
	| { readonly type: 'structure'; readonly op: LayoutOp }

/** Listener invoked with each drag event, in emission order. */
export type DragEventListener = (event: DragEvent) => void

/**
 * What the adapter hit-tested under the cursor. Tagged union, never a bare
 * array — discrimination never depends on "does this object happen to have
 * a `kind`".
 *
 * `track` is the **track-background** hover (the pointer is inside a track but
 * on neither a toolbar nor a gap). The spec drops it in Phase 5, where every
 * in-track hover derives the flanking stack paints instead; until then it is
 * the only path that paints the flanking pair, so it stays.
 */
export type Hoverable =
	| { readonly kind: 'toolbar'; readonly toolbar: Toolbar; readonly activeItem?: number }
	| { readonly kind: 'tool'; readonly toolbar: Toolbar; readonly item: ToolbarItem }
	| { readonly kind: 'track'; readonly border: Border; readonly trackIndex: number }
	| DropZone

/** Two raw client numbers, passed on every hover. No measurement, no axis. */
export type PointerSample = { readonly clientX: number; readonly clientY: number }

/**
 * Adapter-measured slide frame: axis-projected plain numbers, no DOM.
 * Measured when the adapter arms slide-follow (at grab time for a
 * whole-toolbar or lone-tool grab, and again after every `structure` event,
 * because that is exactly when the DOM moved) — never per pointer move.
 */
export type SlideFrame = {
	/** Slide axis: the axis of the dragged toolbar's own track. */
	readonly axis: 'horizontal' | 'vertical'
	/** Free span of the slot: leading gap's edge → trailing gap's end. */
	readonly start: number
	readonly available: number
	/** Toolbar's resting leading edge − `start` (the leading gap's width). */
	readonly resting: number
	/** Cursor offset inside the toolbar, captured at grab time. */
	readonly grab: number
}

/**
 * One gesture. Created by `PaletteLayoutTree.createDrag(target)`;
 * `layout` is the live tree, so no method ever takes a layout parameter.
 *
 * Phase 2: `over` delegates to the legacy `dragOver` internally, diffs the
 * returned paint against its baseline, and emits `highlight` events for
 * changed gaps (structure resets the baseline — full behaviour in Phase 3).
 * `measure` is accepted (slide geometry lands in Phase 4); `end` clears
 * paint + cancels dwell.
 */
export interface ToolbarDrag {
	readonly layout: PaletteLayoutTree
	/** `null` = the pointer left every container: all lit DZs flip `off`. */
	over(hover: Hoverable | null, sample: PointerSample): void
	/** Push the measured frame when slide-follow (re)arms; `undefined` disarms. */
	measure(frame: SlideFrame | undefined): void
	end(): void
	/** Subscribe to drag events (highlight diffs + structure + slide). */
	subscribe(listener: DragEventListener): () => void
}

/**
 * Translate the session vocabulary (`Hoverable`) to the legacy engine
 * vocabulary (`DragElement`). Container references (`track` / `border` /
 * `parking`) are resolved by `===` scan against the live layout — the
 * adapter never re-resolves positions, it only passes live objects.
 */
function toDragElement(hover: Hoverable, layout: PaletteLayout): DragElement | undefined {
	switch (hover.kind) {
		case 'tool':
			return { kind: 'tool', toolbar: hover.toolbar, item: hover.item }
		case 'toolbar': {
			// The legacy engine has no toolbar-background element that paints the
			// active-item fallback (its `toolbar` branch returns neighbour edges /
			// track flanks only), so an anchored background hover is expressed as
			// the item under the pointer. Without an anchor there is nothing to
			// paint — the legacy `toolbar` element returns empty.
			const item = hover.activeItem !== undefined ? hover.toolbar[hover.activeItem] : undefined
			if (item === undefined) return { kind: 'toolbar', toolbar: hover.toolbar }
			return { kind: 'tool', toolbar: hover.toolbar, item }
		}
		case 'item-gap': {
			const at = locateContainerOf(hover.toolbar, layout)
			if (at === undefined) return undefined
			// The container decides the commit: a border toolbar merges, a parking
			// row transfers ownership. Same hover kind, two legacy elements.
			if (at.kind === 'parking') {
				return {
					kind: 'parking-row-gap',
					toolbar: hover.toolbar,
					parking: at.parking,
					index: at.index,
					gap: hover.gap,
				}
			}
			return {
				kind: 'item-gap',
				toolbar: hover.toolbar,
				track: at.track,
				border: at.border,
				gap: hover.gap,
			}
		}
		case 'track-gap':
			return {
				kind: 'track-gap',
				track: hover.track,
				border: borderOf(hover.track, layout),
				gap: hover.gap,
			}
		case 'track':
			return { kind: 'track', border: hover.border, trackIndex: hover.trackIndex }
		case 'stack-gap':
			return { kind: 'stack-gap', border: hover.border, gap: hover.gap }
		case 'parking-gap':
			return { kind: 'parking-gap', parking: hover.parking, gap: hover.gap }
		case 'outside':
			// Phase 6: paints + dwells exactly like `stack-gap`.
			return { kind: 'stack-gap', border: hover.border, gap: hover.gap }
	}
}

/** Where a toolbar lives: a border track, or a parking row. */
type ToolbarContainer =
	| { readonly kind: 'border'; readonly track: Track; readonly border: Border }
	| { readonly kind: 'parking'; readonly parking: Parking; readonly index: number }

function locateContainerOf(toolbar: Toolbar, layout: PaletteLayout): ToolbarContainer | undefined {
	const regions = ['top', 'right', 'bottom', 'left'] as const
	for (const region of regions) {
		const border = layout.borders[region]
		for (const track of border) {
			for (const slot of track) {
				if (slot.toolbar === toolbar) return { kind: 'border', track, border }
			}
		}
	}
	const index = layout.parking.indexOf(toolbar)
	if (index >= 0) return { kind: 'parking', parking: layout.parking, index }
	return undefined
}

function borderOf(track: Track, layout: PaletteLayout): Border {
	const regions = ['top', 'right', 'bottom', 'left'] as const
	for (const region of regions) {
		const border = layout.borders[region]
		if (border.includes(track)) return border
	}
	throw new PaletteError(`toDragElement: track not found in layout`)
}

/**
 * The border track a hover resolved inside, for the Phase 5 flank
 * derivation: a `toolbar` / `tool` hover and an `item-gap` / `track-gap` all
 * carry their container, so the containing track is a pure lookup. Parking
 * rows have no track — they are excluded.
 */
function trackContextOf(
	hover: Hoverable,
	layout: PaletteLayout
): { readonly border: Border; readonly trackIndex: number } | undefined {
	// The `track` hover already carries the border + index.
	if (hover.kind === 'track') return { border: hover.border, trackIndex: hover.trackIndex }
	const at =
		hover.kind === 'toolbar' || hover.kind === 'tool' || hover.kind === 'item-gap'
			? locateContainerOf(hover.toolbar, layout)
			: hover.kind === 'track-gap'
				? ({ kind: 'border', track: hover.track, border: borderOf(hover.track, layout) } as const)
				: undefined
	if (at === undefined || at.kind !== 'border') return undefined
	const trackIndex = at.border.indexOf(at.track)
	if (trackIndex < 0) return undefined
	return { border: at.border, trackIndex }
}

/** Session implementation: owns the legacy `DraggingState`, delegates `over`. */
class CoreToolbarDrag implements ToolbarDrag {
	readonly layout: PaletteLayoutTree
	private readonly engine: DragEngine
	private readonly session: DraggingState
	private readonly dragListeners = new Set<DragEventListener>()
	private ended = false
	/**
	 * Paint baseline: the DZs currently lit, keyed by a stable string.
	 * `over` diffs the fresh decision against it and emits `highlight`
	 * only for changed gaps; `end` / `null` hover flips every lit DZ `off`.
	 *
	 * A `structure` event clears the baseline **without** emitting `off`:
	 * the adapter rebuilds the affected nodes from the live layout, so the
	 * fresh DOM carries no paint — the next `paintZones` re-emits `on`.
	 */
	private readonly painted = new Map<string, DropZone>()
	/** Dwell timer for directly-hovered stack/parking gaps (Phase 3). */
	private dwellTimer: unknown | undefined = undefined
	/** The directly-hovered gap the dwell is armed on (gap change cancels). */
	private dwellGap: string | undefined = undefined
	/** One-shot latch: the gap that already fired (re-arm needs a leave). */
	private dwellCommitted: string | undefined = undefined

	constructor(layout: PaletteLayoutTree, target: GrabTarget, engine: DragEngine) {
		this.layout = layout
		this.engine = engine
		if (target.kind === 'catalog') {
			throw new PaletteError(`createDrag: catalog grabs land in Phase 6`)
		}
		this.session = engine.dragStart(layout.getLayout(), {
			kind: target.kind,
			toolbar: target.toolbar,
			...(target.kind === 'tool' ? { item: target.item } : {}),
		} as DragElement)
	}

	over(hover: Hoverable | null, _sample: PointerSample): void {
		if (this.ended) return
		// A hover that resolves to nothing (pointer left every container, or a
		// hover the legacy engine cannot express) clears the paint baseline —
		// otherwise the adapter re-applies stale paint.
		if (hover === null) {
			this.cancelDwell()
			this.dwellCommitted = undefined
			this.clearPaint()
			return
		}
		const live = this.layout.getLayout()
		const element = toDragElement(hover, live)
		if (element === undefined) {
			this.cancelDwell()
			this.clearPaint()
			return
		}
		// Delegate the decision to the engine, then raise the events that let
		// the adapter follow it: `structure` (whole-op, when a commit landed),
		// then the `highlight` diff. The adapter never reconciles a return
		// value — it subscribes once and applies in emission order.
		// `activeItem` travels on the `tool` hover via the item identity
		// (the engine derives the index itself) or on the `toolbar` hover
		// explicitly.
		const pointer =
			hover.kind === 'toolbar' && hover.activeItem !== undefined
				? { activeItem: hover.activeItem }
				: hover.kind === 'tool'
					? { activeItem: hover.toolbar.indexOf(hover.item) }
					: {}
		const decision = this.engine.dragOver(this.session, live, element, pointer, true)
		const zones = this.decisionDropZones(decision)
		// Phase 5: every hover resolving inside a border track *additionally*
		// paints that track's two flanking stack gaps (emptied veto applies).
		this.addTrackFlanks(hover, zones)
		// Structure first — it is what lets the adapter create/remove nodes and
		// paint them in the same pass. A commit resets the paint baseline with
		// no `off` emissions: the adapter rebuilds the affected subtree, so the
		// fresh DOM carries no paint and the diff below re-emits `on`.
		if (decision.moved) {
			this.emit({ type: 'structure', op: this.commitOp() })
			this.afterStructure()
		}
		this.paintZones(zones)
		this.armDwell(hover)
	}

	/**
	 * The `LayoutOp` describing the commit the engine just applied to the live
	 * arrays. The engine mutates in place, so the op is a fresh `replace`
	 * snapshot: the adapter re-reads the live layout through its existing
	 * `applyOp` path (node map rebuilt from the live objects, never a diff
	 * against nodes a re-render destroyed).
	 */
	private commitOp(): LayoutOp {
		return { kind: 'replace', snapshot: liveSnapshot(this.layout.getLayout()) }
	}

	/**
	 * Phase 5 in-track flanks: resolve the border track the hover landed in
	 * and merge its two flanking stack gaps into `zones` (no commit). Uses the
	 * engine's `stackFlanks` so the emptied veto (and the `layout.ts`
	 * ownership of it) stays in one place.
	 */
	private addTrackFlanks(hover: Hoverable, zones: Map<string, DropZone>): void {
		const live = this.layout.getLayout()
		const at = trackContextOf(hover, live)
		if (at === undefined) return
		for (const gap of this.engine.stackFlanks(this.session, at.border, at.trackIndex)) {
			const dz: DropZone = { kind: 'stack-gap', border: at.border, gap }
			const key = dropZoneKey(dz, live)
			if (!zones.has(key)) zones.set(key, dz)
		}
	}

	/**
	 * Flatten a legacy decision into the live DZ set: every painted gap as
	 * a `DropZone`. Keys are structural (container index + gap), not
	 * identity: tracks/borders are re-created across commits, but the
	 * toolbar object survives — so item-gaps key on the toolbar's live
	 * index while track/stack/parking gaps key on container position.
	 */
	private decisionDropZones(decision: DragOverDecision): Map<string, DropZone> {
		const live = this.layout.getLayout()
		const out = new Map<string, DropZone>()
		for (const paint of decision.itemHighlights) {
			for (const gap of paint.gaps) {
				const dz: DropZone = { kind: 'item-gap', toolbar: paint.toolbar, gap }
				out.set(dropZoneKey(dz, live), dz)
			}
		}
		for (const paint of decision.trackHighlights) {
			for (const gap of paint.gaps) {
				const dz: DropZone = { kind: 'track-gap', track: paint.track, gap }
				out.set(dropZoneKey(dz, live), dz)
			}
		}
		for (const paint of decision.stackHighlights) {
			for (const gap of paint.gaps) {
				const dz: DropZone = { kind: 'stack-gap', border: paint.border, gap }
				out.set(dropZoneKey(dz, live), dz)
			}
		}
		for (const paint of decision.parkingHighlights) {
			for (const gap of paint.gaps) {
				const dz: DropZone = { kind: 'parking-gap', parking: live.parking, gap }
				out.set(dropZoneKey(dz, live), dz)
			}
		}
		for (const edge of decision.neighbourEdges) {
			const dz: DropZone = { kind: 'item-gap', toolbar: edge.toolbar, gap: edge.gap }
			out.set(dropZoneKey(dz, live), dz)
		}
		return out
	}

	/** Diff the fresh DZ set against the baseline; emit `highlight` on change. */
	private paintZones(fresh: Map<string, DropZone>): void {
		for (const [key, dz] of this.painted) {
			if (!fresh.has(key)) {
				this.painted.delete(key)
				this.emit({ type: 'highlight', dz, state: 'off' })
			}
		}
		for (const [key, dz] of fresh) {
			if (!this.painted.has(key)) {
				this.painted.set(key, dz)
				this.emit({ type: 'highlight', dz, state: 'on' })
			}
		}
	}

	/** Flip every lit DZ `off` and reset the baseline. */
	private clearPaint(): void {
		for (const [key, dz] of this.painted) {
			this.painted.delete(key)
			this.emit({ type: 'highlight', dz, state: 'off' })
		}
	}

	private emit(event: DragEvent): void {
		for (const listener of [...this.dragListeners]) {
			try {
				listener(event)
			} catch (error) {
				// Listener errors must not break the emit loop (mirrors `emitOp`).
				scheduleMicrotask(() => {
					throw error
				})
			}
		}
	}

	// ── Dwell (Phase 3) ─────────────────────────────────────────────
	// Arms on a directly-hovered `stack-gap` / `outside` / `parking-gap`,
	// cancels on gap change / `null` hover / `end()`, and fires the
	// stack/parking commit itself as a `structure` event.

	/** The directly-hovered DZ when it is a dwellable gap, else `undefined`. */
	private dwellTargetOf(hover: Hoverable): DropZone | undefined {
		if (hover.kind === 'stack-gap')
			return { kind: 'stack-gap', border: hover.border, gap: hover.gap }
		if (hover.kind === 'outside') return { kind: 'outside', border: hover.border, gap: hover.gap }
		if (hover.kind === 'parking-gap')
			return { kind: 'parking-gap', parking: hover.parking, gap: hover.gap }
		return undefined
	}

	private cancelDwell(): void {
		if (this.dwellTimer !== undefined) {
			clearHostTimeout(this.dwellTimer)
			this.dwellTimer = undefined
		}
		this.dwellGap = undefined
	}

	private armDwell(hover: Hoverable): void {
		const target = this.dwellTargetOf(hover)
		const live = this.layout.getLayout()
		const key = target === undefined ? undefined : dropZoneKey(target, live)
		// Gap change (or a non-dwellable hover) cancels the pending fire.
		if (key !== this.dwellGap) {
			this.cancelDwell()
			// Leaving the gap resets the one-shot latch so a fresh hover
			// arms again — including returning to the just-committed gap.
			if (key === undefined) this.dwellCommitted = undefined
			else if (this.dwellCommitted !== undefined && this.dwellCommitted !== key)
				this.dwellCommitted = undefined
		}
		if (target === undefined || key === undefined) return
		// One-shot latch: no re-arm while the pointer stays put after a fire.
		if (this.dwellCommitted === key) return
		// Only a highlighted (painted) gap may fire — dark gaps never commit.
		if (!this.painted.has(key)) return
		// Already armed on this gap: keep the pending timer.
		if (this.dwellGap === key) return
		this.dwellGap = key
		const armed = { ...target }
		this.dwellTimer = scheduleHostTimeout(() => {
			this.dwellTimer = undefined
			this.dwellCommitted = key
			// Backstop: only commit while the pointer is still on the arming gap.
			if (this.dwellGap !== key || this.ended) return
			this.fireDwell(armed)
		}, configuration.stackDzHoverMs)
	}

	/** Fire the dwell commit and emit it as a `structure` event. */
	private fireDwell(target: DropZone): void {
		if (target.kind === 'stack-gap' || target.kind === 'outside') {
			if (!this.engine.commitDraggedToStackSpace(this.session, target.border, target.gap).moved)
				return
			this.emit({ type: 'structure', op: this.commitOp() })
			this.afterStructure()
			return
		}
		if (target.kind === 'parking-gap') {
			if (!this.engine.commitDraggedToParkingRow(this.session, target.parking, target.gap).moved)
				return
			this.emit({ type: 'structure', op: this.commitOp() })
			this.afterStructure()
		}
	}

	/**
	 * After a structure event: drop the paint baseline. The adapter rebuilds
	 * the affected nodes from the live layout, so those nodes carry no paint
	 * — the following `paintZones` re-emits `on` for whatever is still
	 * hovered (never a diff against nodes a re-render destroyed, and never an
	 * `off` for a node that no longer exists).
	 */
	private afterStructure(): void {
		this.painted.clear()
	}

	measure(_frame: SlideFrame | undefined): void {
		if (this.ended) return
		// Phase 1: accepted (slide geometry consumes it in Phase 4).
	}

	/** Subscribe to drag events (highlight diffs + structure + slide). */
	subscribe(listener: DragEventListener): () => void {
		this.dragListeners.add(listener)
		return () => {
			this.dragListeners.delete(listener)
		}
	}

	end(): void {
		if (this.ended) return
		this.ended = true
		this.cancelDwell()
		this.dwellCommitted = undefined
		this.clearPaint()
	}

	/**
	 * Internal exposure for the Phase 2 vanilla migration.
	 *
	 * @deprecated Phase 7 — mode/origin go session-internal; do not add new readers.
	 */
	get draggingState(): DraggingState {
		return this.session
	}
}

/**
 * Create a drag session for one gesture. Resolves the grab target against the
 * live tree by `===` scan (via the engine's `dragStart`) and throws when it is
 * not there (a drawer child) — so the adapter gets a session only for a real
 * drag.
 *
 * Called by `PaletteLayoutTree.createDrag` (the spec's creation point), which
 * supplies the engine.
 */
export function createToolbarDrag(
	layout: PaletteLayoutTree,
	target: GrabTarget,
	engine: DragEngine
): ToolbarDrag {
	return new CoreToolbarDrag(layout, target, engine)
}

/**
 * Stable structural key for a DZ: container position + gap, never object
 * identity (tracks/borders are re-created across commits; toolbars survive
 * but move — so item-gaps key on the toolbar's live index).
 */
function dropZoneKey(dz: DropZone, live: PaletteLayout): string {
	switch (dz.kind) {
		case 'item-gap': {
			const at = locateContainerOf(dz.toolbar, live)
			if (at === undefined) return `orphan:${dz.gap}`
			if (at.kind === 'parking') return `parking-row:${at.index}:${dz.gap}`
			const region = regionOf(at.border, live)
			const track = at.border.indexOf(at.track)
			const slot = at.track.findIndex((entry) => entry.toolbar === dz.toolbar)
			return `item:${region}:${track}:${slot}:${dz.gap}`
		}
		case 'track-gap': {
			const at = locateTrack(dz.track, live)
			if (at === undefined) return `orphan-track:${dz.gap}`
			return `track:${at.region}:${at.trackIndex}:${dz.gap}`
		}
		case 'stack-gap':
		case 'outside': {
			const region = regionOf(dz.border, live)
			return `stack:${dz.kind}:${region}:${dz.gap}`
		}
		case 'parking-gap':
			return `parking:${dz.gap}`
	}
}

function regionOf(border: Border, live: PaletteLayout): 'top' | 'right' | 'bottom' | 'left' | '?' {
	const regions = ['top', 'right', 'bottom', 'left'] as const
	for (const region of regions) {
		if (live.borders[region] === border) return region
	}
	return '?'
}

function locateTrack(
	track: Track,
	live: PaletteLayout
): { region: string; trackIndex: number } | undefined {
	const regions = ['top', 'right', 'bottom', 'left'] as const
	for (const region of regions) {
		const index = live.borders[region].indexOf(track)
		if (index >= 0) return { region, trackIndex: index }
	}
	return undefined
}

/** Fresh JSON-safe snapshot of the live layout (the `getSnapshot` moment). */
function liveSnapshot(live: PaletteLayout): import('./layout.js').SerializedLayout {
	// Flat slot list per region (mirrors `snapshotLayout` in `layout.ts` —
	// inlined here because `drag.ts` takes the engine by injection to avoid
	// a value import cycle with `layout.ts`).
	const regions = ['top', 'right', 'bottom', 'left'] as const
	const borders = {} as import('./layout.js').SerializedLayout['borders']
	for (const region of regions) {
		borders[region] = live.borders[region].flatMap((track) =>
			track.map((slot) => ({
				space: slot.space,
				toolbar: slot.toolbar.map((item) => ({ ...item })),
			}))
		)
	}
	return {
		version: 1,
		borders,
		parking: live.parking.map((toolbar) => toolbar.map((item) => ({ ...item }))),
	}
}
