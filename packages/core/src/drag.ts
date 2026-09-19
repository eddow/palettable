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
	LayoutPruneVictim,
	PaletteLayout,
	PaletteLayoutTree,
	Parking,
	Toolbar,
	ToolbarItem,
	ToolbarLocation,
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
	 * Phase 4 slide release: write the two flanking `space` values around
	 * the dragged toolbar in its live track (`resizeToolbar`) and report
	 * the `{ track, index, split }` the `resize` event carries. Returns
	 * `undefined` when there is nothing to commit (not a whole-toolbar
	 * border drag, or the toolbar left its track).
	 */
	commitSlide(
		session: DraggingState,
		split: number
	): { readonly track: Track; readonly index: number; readonly split: number } | undefined
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
 * Clamp the pointer to the slide's free span and return the shift to apply
 * (relative to the toolbar's resting position). `frame.start` is the
 * *leading gap's* edge; `frame.resting` is the toolbar's resting offset
 * inside that span, so the result is a `transform`-ready shift from resting.
 *
 * Single copy of the slide arithmetic (Phase 4): both the per-move `slide`
 * delta and the release `resize` split derive from it, so the visual
 * position and the committed `space` can never disagree.
 */
export function clampSlideDelta(frame: SlideFrame, pointer: number): number {
	const raw = pointer - frame.grab - frame.start
	const clamped = Math.min(Math.max(raw, 0), frame.available)
	return clamped - frame.resting
}

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

/**
 * Where a toolbar lives in the live layout (identity scan).
 * Local copy of `layout.toolbarLocationOf` — avoids a value-import cycle
 * (`layout.ts` imports `createToolbarDrag` from this module).
 */
function toolbarLocationOf(toolbar: Toolbar, layout: PaletteLayout): ToolbarLocation | undefined {
	const regions = ['top', 'right', 'bottom', 'left'] as const
	for (const region of regions) {
		const border = layout.borders[region]
		for (let trackIndex = 0; trackIndex < border.length; trackIndex += 1) {
			const track = border[trackIndex]!
			for (let toolbarIndex = 0; toolbarIndex < track.length; toolbarIndex += 1) {
				if (track[toolbarIndex]?.toolbar === toolbar)
					return { container: 'border', region, trackIndex, toolbarIndex }
			}
		}
	}
	const toolbarIndex = layout.parking.indexOf(toolbar)
	if (toolbarIndex >= 0) return { container: 'parking', toolbarIndex }
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
	 * only on change — a new gap emits `on` (or `double` for the
	 * directly-hovered stack/parking gap), a state flip (`on` ↔ `double`)
	 * re-emits with the new state so the adapter toggles `hovered`, and
	 * `end` / `null` hover flips every lit DZ `off`.
	 *
	 * A `structure` event clears the baseline **without** emitting `off`:
	 * the adapter rebuilds the affected nodes from the live layout, so the
	 * fresh DOM carries no paint — the next `paintZones` re-emits for
	 * whatever is still hovered.
	 */
	private readonly painted = new Map<string, { dz: DropZone; state: 'on' | 'double' }>()
	/** Dwell timer for directly-hovered stack/parking gaps (Phase 3). */
	private dwellTimer: unknown | undefined = undefined
	/** The directly-hovered gap the dwell is armed on (gap change cancels). */
	private dwellGap: string | undefined = undefined
	/** One-shot latch: the gap that already fired (re-arm needs a leave). */
	private dwellCommitted: string | undefined = undefined
	// ── Slide (Phase 4) ─────────────────────────────────────────────
	// `measure()` pushes the adapter-measured frame (one per arm, never per
	// move); `over()` derives the `slide` delta from it + the sample and
	// caches the `resize` split, so `end()` is geometry-free.
	/** Adapter-measured frame (`undefined` = disarmed). */
	private slideFrame: SlideFrame | undefined = undefined
	/** Toolbar currently followed (`origin.toolbar` while sliding). */
	private slideToolbar: Toolbar | undefined = undefined
	/** Cached release split (`(resting + delta) / available`). */
	private pendingSplit: number | undefined = undefined
	/** Last pointer sample seen (reused by the dwell re-paint, which has no fresh hover). */
	private lastSample: PointerSample = { clientX: 0, clientY: 0 }

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

	over(hover: Hoverable | null, sample: PointerSample): void {
		if (this.ended) return
		this.lastSample = sample
		// A hover that resolves to nothing (pointer left every container, or a
		// hover the legacy engine cannot express) clears the paint baseline —
		// otherwise the adapter re-applies stale paint.
		if (hover === null) {
			this.cancelDwell()
			this.dwellCommitted = undefined
			this.clearPaint()
			this.updateSlide(sample)
			return
		}
		const live = this.layout.getLayout()
		const element = toDragElement(hover, live)
		if (element === undefined) {
			this.cancelDwell()
			this.clearPaint()
			this.updateSlide(sample)
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
		// Capture origin location before the engine mutates the live arrays.
		const originBefore = toolbarLocationOf(this.session.origin.toolbar, live)
		const originToolbar = this.session.origin.toolbar
		const originTrack =
			this.session.origin.kind === 'border' ? this.session.origin.track : undefined
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
			this.emit({ type: 'structure', op: this.commitOp(originBefore, originToolbar, originTrack) })
			this.afterStructure()
		}
		this.paintZones(zones, hover)
		this.armDwell(hover)
		this.updateSlide(sample)
	}

	/**
	 * The `LayoutOp` describing the commit the engine just applied to the live
	 * arrays. Derives a precise `move-toolbar` op from the origin location
	 * captured before the engine mutated and the session origin after — no
	 * `replace` snapshot, so the adapter can surgically insert/remove/move
	 * nodes without a full rebuild.
	 *
	 * @param originBefore Location of the session origin toolbar before mutation.
	 * @param originToolbar The session origin toolbar before mutation.
	 * @param originTrack The track containing `originToolbar` before mutation (border only).
	 */
	private commitOp(
		originBefore: ToolbarLocation | undefined,
		originToolbar: Toolbar,
		originTrack?: Track
	): LayoutOp {
		const live = this.layout.getLayout()
		const newToolbar = this.session.origin.toolbar
		const to = toolbarLocationOf(newToolbar, live)
		const pruned: LayoutPruneVictim[] = []

		// Slide: same toolbar identity moved to a new location.
		// Restructure: new toolbar (or existing target), items changed.
		const isSlide = newToolbar === originToolbar

		if (originBefore !== undefined) {
			if (originBefore.container === 'border') {
				// Detect pruned origin toolbar (restructure extraction emptied it).
				if (!isSlide && toolbarLocationOf(originToolbar, live) === undefined) {
					pruned.push({ kind: 'toolbar', toolbar: originToolbar, from: originBefore })
				}
				// Detect pruned origin track (emptied and removed from border).
				if (originTrack !== undefined) {
					const border = live.borders[originBefore.region]
					if (!border.includes(originTrack)) {
						pruned.push({ kind: 'track', toolbar: originToolbar, from: originBefore })
					}
				}
			} else {
				// Parking: detect pruned origin row (removed from parking array).
				if (!isSlide && !live.parking.includes(originToolbar)) {
					pruned.push({ kind: 'row', toolbar: originToolbar, from: originBefore })
				}
			}
		}

		// `from` is the pre-mutation origin location (where the dragged tools
		// came from). For a slide that's the toolbar's own old spot; for a
		// restructure it tells the adapter which region lost items, so both
		// source and target regions re-sync from one event. Absent only when
		// there was no origin (catalog creation, Phase 6).
		const from = originBefore

		return {
			kind: 'move-toolbar',
			toolbar: newToolbar,
			from,
			to,
			pruned,
		}
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

	/** Diff the fresh DZ set against the baseline; emit `highlight` on change.
	 *
	 * The directly-hovered stack/parking gap (the dwell target) paints
	 * `double` (CSS `.highlighted.hovered`, doubled size) while the dwell
	 * timer counts; every other lit gap paints `on`. A state flip on an
	 * already-lit gap (`on` ↔ `double`) re-emits with the new state so the
	 * adapter toggles `hovered` without dropping `highlighted`.
	 */
	private paintZones(fresh: Map<string, DropZone>, hover: Hoverable): void {
		const doubleTarget = this.dwellTargetOf(hover)
		const live = this.layout.getLayout()
		const doubleKey = doubleTarget === undefined ? undefined : dropZoneKey(doubleTarget, live)
		const stateOf = (key: string): 'on' | 'double' =>
			doubleKey !== undefined && key === doubleKey ? 'double' : 'on'
		for (const [key, record] of [...this.painted]) {
			const next = fresh.get(key)
			if (next === undefined) {
				this.painted.delete(key)
				this.emit({ type: 'highlight', dz: record.dz, state: 'off' })
				continue
			}
			const state = stateOf(key)
			if (record.state !== state) {
				this.painted.set(key, { dz: next, state })
				this.emit({ type: 'highlight', dz: next, state })
			}
		}
		for (const [key, dz] of fresh) {
			if (!this.painted.has(key)) {
				const state = stateOf(key)
				this.painted.set(key, { dz, state })
				this.emit({ type: 'highlight', dz, state })
			}
		}
	}

	/** Flip every lit DZ `off` and reset the baseline. */
	private clearPaint(): void {
		for (const [key, record] of [...this.painted]) {
			this.painted.delete(key)
			this.emit({ type: 'highlight', dz: record.dz, state: 'off' })
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
		const live = this.layout.getLayout()
		const originBefore = toolbarLocationOf(this.session.origin.toolbar, live)
		const originToolbar = this.session.origin.toolbar
		const originTrack =
			this.session.origin.kind === 'border' ? this.session.origin.track : undefined
		if (target.kind === 'stack-gap' || target.kind === 'outside') {
			if (!this.engine.commitDraggedToStackSpace(this.session, target.border, target.gap).moved)
				return
			this.emit({ type: 'structure', op: this.commitOp(originBefore, originToolbar, originTrack) })
			this.afterStructure()
			this.repaintAfterDwell(target)
			return
		}
		if (target.kind === 'parking-gap') {
			if (!this.engine.commitDraggedToParkingRow(this.session, target.parking, target.gap).moved)
				return
			this.emit({ type: 'structure', op: this.commitOp(originBefore, originToolbar, originTrack) })
			this.afterStructure()
			this.repaintAfterDwell(target)
		}
	}

	/**
	 * Re-paint after a dwell commit (timer callback, not an `over()` pass):
	 * re-derive the zones for the still-hovered gap against the live layout
	 * and diff them on, so the UI is never one event behind. Mirrors the
	 * `afterStructure()` → `paintZones` step of the `over()` path. The
	 * still-hovered gap keeps its `double` state (the dwell target is the
	 * hover itself).
	 */
	private repaintAfterDwell(target: DropZone): void {
		if (this.ended) return
		const live = this.layout.getLayout()
		const element = toDragElement(target, live)
		if (element === undefined) return
		const decision = this.engine.dragOver(this.session, live, element, {}, true)
		const zones = this.decisionDropZones(decision)
		this.addTrackFlanks(target, zones)
		this.paintZones(zones, target)
		this.updateSlide(this.lastSample)
	}

	/**
	 * After a structure event: drop the paint baseline. The adapter rebuilds
	 * the affected nodes from the live layout, so those nodes carry no paint
	 * — the following `paintZones` re-emits `on` for whatever is still
	 * hovered (never a diff against nodes a re-render destroyed, and never an
	 * `off` for a node that no longer exists).
	 *
	 * A commit also re-resolves the slide target: the dragged toolbar may be
	 * a fresh object (restructure extraction) or pruned (merge) — the next
	 * `updateSlide` follows `origin.toolbar` live, and a pruned toolbar
	 * emits `clearSlide` there.
	 */
	private afterStructure(): void {
		this.painted.clear()
	}

	// ── Slide (Phase 4) ─────────────────────────────────────────────
	// The frame is pushed by `measure()` (one per arm, never per move); the
	// pointer component comes from the `over()` sample (axis off the frame).
	// `updateSlide` runs at the end of every `over()` (after paint + dwell)
	// so emission order stays structure → highlight → slide.

	/**
	 * Derive the follow state from the live origin + frame + sample and
	 * emit `slide` / `clearSlide`. Only a whole-toolbar border drag with a
	 * frame slides; anything else disarms (emitting `clearSlide` when a
	 * follow was live).
	 */
	private updateSlide(sample: PointerSample): void {
		const frame = this.slideFrame
		const toolbar =
			this.session.isWholeToolbar && this.session.origin.kind === 'border'
				? this.session.origin.toolbar
				: undefined
		if (frame === undefined || toolbar === undefined) {
			this.clearSlide()
			return
		}
		// The followed toolbar changed (restructure extraction / relocation):
		// the old follow is over — the adapter re-measures against the fresh
		// node and pushes a new frame, which re-arms from there.
		if (this.slideToolbar !== undefined && this.slideToolbar !== toolbar) {
			this.clearSlide()
		}
		this.slideToolbar = toolbar
		const pointer = frame.axis === 'horizontal' ? sample.clientX : sample.clientY
		const delta = clampSlideDelta(frame, pointer)
		if (delta === 0) {
			// Resting position: no transform to write and nothing to commit.
			// `pendingSplit` stays `undefined` so `end()` emits only the
			// highlight clears ("a gesture with no slide"). A live follow
			// stays armed (no event — the adapter holds no transform), so a
			// later move emits `slide` from the same frame.
			this.pendingSplit = undefined
			return
		}
		this.pendingSplit = frame.available > 0 ? (frame.resting + delta) / frame.available : 0
		this.emit({ type: 'slide', toolbar, delta })
	}

	/** Drop the follow: emit `clearSlide` when a follow was live. */
	private clearSlide(): void {
		const toolbar = this.slideToolbar
		this.slideToolbar = undefined
		this.pendingSplit = undefined
		if (toolbar !== undefined) this.emit({ type: 'clearSlide', toolbar })
	}

	measure(frame: SlideFrame | undefined): void {
		if (this.ended) return
		// `undefined` disarms (emitting `clearSlide` when a follow was live);
		// a frame (re)arms — the next `over()` derives the delta from it.
		// `available: 0` is a legitimate measurement ("cannot slide right
		// now"): it stays armed and `updateSlide` clamps every delta to the
		// resting position.
		if (frame === undefined) {
			this.slideFrame = undefined
			this.clearSlide()
			return
		}
		this.slideFrame = { ...frame }
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
		// Geometry-free finalise: the split was cached per move, so release
		// writes the model first (`resize`), then drops the follow
		// (`clearSlide`), then clears the paint — in apply order.
		if (this.pendingSplit !== undefined) {
			const live = this.layout.getLayout()
			const originBefore = toolbarLocationOf(this.session.origin.toolbar, live)
			const originToolbar = this.session.origin.toolbar
			const originTrack =
				this.session.origin.kind === 'border' ? this.session.origin.track : undefined
			const committed = this.engine.commitSlide(this.session, this.pendingSplit)
			this.slideToolbar = undefined
			this.pendingSplit = undefined
			this.slideFrame = undefined
			if (committed !== undefined) {
				this.emit({
					type: 'structure',
					op: this.commitOp(originBefore, originToolbar, originTrack),
				})
				this.afterStructure()
				this.emit({
					type: 'resize',
					track: committed.track,
					index: committed.index,
					split: committed.split,
				})
				this.emit({ type: 'clearSlide', toolbar: this.session.origin.toolbar })
			} else {
				this.clearSlide()
			}
		} else {
			this.slideFrame = undefined
			this.clearSlide()
		}
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
