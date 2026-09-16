/**
 * `@palettable/core` — drag session vocabulary (Phase 1 of the drag-interface plan).
 *
 * `GrabTarget` / `Hoverable` / `PointerSample` are the wire vocabulary for the
 * session interface (`PaletteLayoutTree.createDrag`): `Hoverable` in,
 * `DragEvent` out (events land in Phase 2). `DragElement` / `DragPointer` stay
 * as deprecated aliases until the Phase 7 close-out so existing call sites
 * (`vanilla/ide.ts`, `layout.test.ts`) keep compiling while the session is
 * mounted.
 */

import { PaletteError } from './errors.js'
import {
	type Border,
	type DragElement,
	type DraggingState,
	dragOver,
	dragStart,
	type PaletteLayout,
	PaletteLayoutTree,
	type Parking,
	type Toolbar,
	type ToolbarItem,
	type Track,
} from './layout.js'

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

/**
 * What the adapter hit-tested under the cursor. Tagged union, never a bare
 * array — discrimination never depends on "does this object happen to have
 * a `kind`". Phase 1 covers `toolbar` / `tool` / `item-gap` / `track-gap` /
 * `stack-gap` / `parking-gap`; `outside` lands in Phase 6.
 */
export type Hoverable =
	| { readonly kind: 'toolbar'; readonly toolbar: Toolbar; readonly activeItem?: number }
	| { readonly kind: 'tool'; readonly toolbar: Toolbar; readonly item: ToolbarItem }
	| DropZone

/** Two raw client numbers, passed on every hover. No measurement, no axis. */
export type PointerSample = { readonly clientX: number; readonly clientY: number }

/**
 * One gesture. Created by `PaletteLayoutTree.createDrag(target)`;
 * `layout` is the live tree, so no method ever takes a layout parameter.
 * Phase 1: `over` delegates to the legacy `dragOver` internally (return value
 * still computed, events land in Phase 2); `measure` is accepted and stored
 * (slide geometry lands in Phase 4); `end` clears paint + cancels dwell.
 */
export interface ToolbarDrag {
	readonly layout: PaletteLayoutTree
	/** `null` = the pointer left every container: all lit DZs flip `off`. */
	over(hover: Hoverable | null, sample: PointerSample): void
	/** Push the measured frame when slide-follow (re)arms; `undefined` disarms. */
	measure(frame: unknown): void
	end(): void
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
		case 'toolbar':
			return { kind: 'toolbar', toolbar: hover.toolbar }
		case 'item-gap': {
			const at = locateContainerOf(hover.toolbar, layout)
			if (at?.kind !== 'border') return undefined
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
		case 'stack-gap':
			return { kind: 'stack-gap', border: hover.border, gap: hover.gap }
		case 'parking-gap':
			return { kind: 'parking-gap', parking: hover.parking, gap: hover.gap }
		case 'outside':
			// Phase 6: paints + dwells exactly like `stack-gap`.
			return { kind: 'stack-gap', border: hover.border, gap: hover.gap }
	}
}

function locateContainerOf(
	toolbar: Toolbar,
	layout: PaletteLayout
): { readonly kind: 'border'; readonly track: Track; readonly border: Border } | undefined {
	const regions = ['top', 'right', 'bottom', 'left'] as const
	for (const region of regions) {
		const border = layout.borders[region]
		for (const track of border) {
			for (const slot of track) {
				if (slot.toolbar === toolbar) return { kind: 'border', track, border }
			}
		}
	}
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

/** Session implementation: owns the legacy `DraggingState`, delegates `over`. */
class CoreToolbarDrag implements ToolbarDrag {
	readonly layout: PaletteLayoutTree
	private readonly session: DraggingState
	private ended = false
	private lastDecision: import('./layout.js').DragOverDecision | undefined = undefined

	constructor(layout: PaletteLayoutTree, target: GrabTarget) {
		this.layout = layout
		if (target.kind === 'catalog') {
			throw new PaletteError(`createDrag: catalog grabs land in Phase 6`)
		}
		this.session = dragStart(layout.getLayout(), {
			kind: target.kind,
			toolbar: target.toolbar,
			...(target.kind === 'tool' ? { item: target.item } : {}),
		} as DragElement)
	}

	over(hover: Hoverable | null, _sample: PointerSample): void {
		if (this.ended) return
		if (hover === null) return
		const live = this.layout.getLayout()
		const element = toDragElement(hover, live)
		if (element === undefined) return
		// Phase 1: delegate to the legacy engine. The return value still
		// carries paint + `moved`; event emission lands in Phase 2/3, when
		// the session owns the emit and the adapter applies the stream.
		// `activeItem` travels on the `tool` hover via the item identity
		// (legacy `dragOver` derives the index itself) or on the `toolbar`
		// hover explicitly.
		const pointer =
			hover.kind === 'toolbar' && hover.activeItem !== undefined
				? { activeItem: hover.activeItem }
				: hover.kind === 'tool'
					? { activeItem: hover.toolbar.indexOf(hover.item) }
					: {}
		const decision = dragOver(this.session, live, element, pointer, true)
		this.lastDecision = decision
	}

	measure(_frame: unknown): void {
		if (this.ended) return
		// Phase 1: accepted (slide geometry consumes it in Phase 4).
	}

	end(): void {
		if (this.ended) return
		this.ended = true
		// Phase 1: paint baseline + dwell teardown land with events (Phase 2/3).
	}

	/** Internal exposure for the Phase 1 vanilla migration (removed Phase 7). */
	get draggingState(): DraggingState {
		return this.session
	}

	/**
	 * Last legacy decision (paint + `moved`), for the Phase 1 vanilla
	 * migration only: the adapter applies it exactly as it applied the
	 * `dragOver` return before, until Phase 2 flips it to events.
	 */
	get decision(): import('./layout.js').DragOverDecision | undefined {
		return this.lastDecision
	}
}

/**
 * Create a drag session for one gesture. Resolves the grab target against
 * the live tree by `===` scan (via `dragStart`) and throws when it is not
 * there (a drawer child) — so the adapter gets a session only for a real drag.
 */
export function createToolbarDrag(layout: PaletteLayoutTree, target: GrabTarget): ToolbarDrag {
	return new CoreToolbarDrag(layout, target)
}

// Attach the spec-mandated creation point: `layout.createDrag(target)`.
// Lives here (not in `layout.ts`) because the factory needs `dragStart`,
// which lives in `layout.ts` — defining it here keeps the import one-way.
PaletteLayoutTree.prototype.createDrag = function (
	this: PaletteLayoutTree,
	target: GrabTarget
): ToolbarDrag {
	return createToolbarDrag(this, target)
}
