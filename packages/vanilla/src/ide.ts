/**
 * `@palettable/vanilla` — IDE renderer (plain-DOM `Ide` + console).
 *
 * `createIDE(container, options)` turns a container element into a
 * `.palette-ide`: it adds the IDE classes, wraps the container's existing
 * children (the work-zone) in `.palette-ide-middle > .palette-ide-center`,
 * and renders the four border stacks around it from `core.layout`.
 * The console overlay (when open) mounts inside the center next to the
 * work-zone, mirroring the svelte `Ide` + `Console` structure the e2e
 * suite asserts.
 *
 * Presentation only: all reads go through core builders/presenters, all
 * writes through `core.run` / `core.values` / `core.layout` / `ConsoleStore`.
 * Drop-zone highlight is paint-only: `pointerdown` on a guard opens a
 * single-tool drag session, `pointermove` asks core `itemSpaceHighlight`
 * which gaps paint and applies it via `syncGapClasses`; no session means
 * core returns empty, so hover alone never paints. Guards also inspect
 * (`pointerdown` selects for the configurator).
 */

import {
	type AddItemSource,
	type AnyPoint,
	actualTrackSpaceAt,
	axisForRegion,
	type Border,
	buttonPresenter,
	type ConsoleStore,
	configuration,
	configuratorEditorCleanup,
	type DragEvent,
	type DraggingState,
	type DropZone,
	draggingEmptiesTrackIndex,
	editorChoicesFor,
	filterCommandEntries,
	type HighlightState,
	type Hoverable,
	isActionPoint,
	isDraggedToolbarAt,
	isValuedPoint,
	type LayoutOp,
	type PaletteCore,
	type PaletteRegion,
	paletteAddItemEntries,
	paletteCommandEntries,
	paletteDerivedVariants,
	parsePointSpec,
	type SlideFrame,
	type SurfaceContext,
	selectPresenter,
	sliderPresenter,
	type Toolbar,
	type ToolbarDrag,
	type ToolbarItem,
	type Track,
	togglePresenter,
	type Unsubscribe,
	validateSerializedLayout,
} from '@palettable/core'
// Side-effect import: wires `PaletteLayoutTree.prototype.createDrag`.
import '@palettable/core'
import { itemFromAddSelection } from './add-item.js'
import { startDragSession } from './drag-session.js'
import { renderHeadItem, surfaceForRegion } from './head.js'
import { clearGapClasses } from './highlight.js'
import { createVanillaKeys, isEditableTarget } from './keys.js'
import { NodeRegistry } from './nodes.js'
import { outsideGapForTrack } from './outside.js'
import { extractionGrabOffset, toolbarGrabOffset, toolbarSlideBounds } from './slide.js'

export type IdeOptions = {
	readonly core: PaletteCore
	readonly consoleStore: ConsoleStore
	readonly isEditable: () => boolean
	/** Editor-only item ids for the console add-box (`editors.item` keys). */
	readonly itemEditors?: readonly string[]
	readonly paletteId?: string
}

export type IdeHandle = {
	/** Re-render borders + console (after demo-driven layout/flag changes). */
	refresh: () => void
	/** Teardown: drop subscriptions + key listener, remove overlays. */
	dispose: () => void
}

/**
 * Per-tool live binding: the subscriptions that keep one rendered tool
 * element in sync with its point value(s) without touching layout. Owned
 * by the tool's `.toolbar-item-content` element (see `toolBindings`);
 * dropped on structural sync (the element is rebuilt) or `dispose()`.
 */
type ToolBinding = readonly Unsubscribe[]

/** Resolve the point id a tool item binds (spec prefix before `=`/`:`/`|`). */
function toolPointId(item: ToolbarItem): string | undefined {
	const tool = (item as { tool?: unknown }).tool
	if (typeof tool !== 'string') return undefined
	const cut = tool.search(/[=|:]/)
	return cut < 0 ? tool : tool.slice(0, cut)
}

/**
 * Read the live value for a tool item, mirroring `head.ts:boundOf`
 * dual-source precedence (first non-root used bag holding the id wins,
 * else root). Keeps in-place updates consistent with initial render when
 * context bags exist; the demo is context-free so this is root-only there.
 */
function toolLiveValue(core: PaletteCore, point: AnyPoint | undefined): unknown {
	if (point === undefined || !isValuedPoint(point)) return undefined
	let value: unknown = core.values.get(point.id)
	for (const bag of core.resolveBags(point.uses)) {
		if (bag === undefined) continue
		if (bag === (core.values as unknown as typeof bag)) continue
		const selected: unknown = bag.get(point.id as never)
		if (selected !== undefined) {
			value = selected
			break
		}
	}
	return value
}

/** Re-run the presenter view-model and patch the live DOM node in place. */
function updateToolNode(
	core: PaletteCore,
	item: ToolbarItem,
	surface: SurfaceContext,
	node: HTMLElement
): void {
	const editor = (item as { editor?: unknown }).editor
	const pointId = toolPointId(item)
	const point = pointId !== undefined ? core.getDefinition(pointId) : undefined
	const value = toolLiveValue(core, point)
	const bags = core.resolveBags(point?.uses)
	switch (editor) {
		case 'toggle': {
			const view = togglePresenter(item, { point, value, bags })
			const button = node.querySelector('button')
			if (!button) return
			button.classList.toggle('is-selected', view.pressed === true)
			button.setAttribute(
				'aria-pressed',
				view.pressed === undefined ? 'mixed' : view.pressed ? 'true' : 'false'
			)
			button.title = view.title
			return
		}
		case 'select': {
			const view = selectPresenter(item, { point, value, bags }, surface)
			const select = node.querySelector('select')
			if (!(select instanceof HTMLSelectElement)) return
			// Guard: never clobber an open dropdown mid-interaction.
			if (document.activeElement === select) return
			const nextSelect = view.value ?? ''
			if (select.value !== nextSelect) select.value = nextSelect
			for (const option of select.options) {
				const spec = view.options.find((entry) => entry.value === option.value)
				if (spec) option.disabled = !spec.can
			}
			return
		}
		case 'segmented': {
			const view = selectPresenter(item, { point, value, bags }, surface)
			const buttons = node.querySelectorAll('button')
			buttons.forEach((button) => {
				const text = button.querySelector('.palette-default-choice')?.textContent ?? ''
				const spec = view.options.find((entry) => entry.text === text)
				if (!spec) return
				button.classList.toggle('is-selected', view.value === spec.value)
				button.disabled = !spec.can || view.value === spec.value
			})
			return
		}
		case 'stars': {
			const view = sliderPresenter(item, { point, value, bags }, surface)
			const buttons = node.querySelectorAll('button[role="radio"]')
			buttons.forEach((button, index) => {
				const star = index + 1
				const filled = view.value !== undefined && star <= view.value
				button.classList.toggle('is-selected', filled)
				button.setAttribute('aria-checked', star === view.value ? 'true' : 'false')
				button.textContent = view.value !== undefined && star <= view.value ? '▶' : '▷'
			})
			return
		}
		case 'slider': {
			const view = sliderPresenter(item, { point, value, bags }, surface)
			const input = node.querySelector('input[type="range"]')
			if (!(input instanceof HTMLInputElement)) return
			// Guard: keep a dragged thumb alive — never rewrite while focused.
			if (document.activeElement === input) return
			const next = String(view.value ?? view.min)
			if (input.value !== next) input.value = next
			const badge = node.querySelector('.palette-default-slider-badge')
			if (badge) badge.textContent = next
			return
		}
		case 'stepper': {
			const view = sliderPresenter(item, { point, value, bags }, surface)
			const buttons = node.querySelectorAll('button')
			const readout = node.querySelector('.palette-default-stepper-value')
			const minus = buttons[0]
			const plus = buttons[1]
			if (minus instanceof HTMLButtonElement)
				minus.disabled = view.value === undefined || view.value - view.step < view.min
			if (plus instanceof HTMLButtonElement)
				plus.disabled = view.value === undefined || view.value + view.step > view.max
			if (readout) {
				readout.childNodes.forEach((child) => {
					if (child.nodeType === Node.TEXT_NODE) child.textContent = String(view.value)
				})
			}
			return
		}
		case 'button': {
			const spec =
				typeof (item as { tool?: unknown }).tool === 'string'
					? ((item as { tool?: string }).tool ?? '')
					: ''
			const can = point !== undefined && isActionPoint(point) ? core.evaluateCan(point.id) : true
			const view = buttonPresenter(item, { point, value: undefined, bags }, spec, can)
			const button = node.querySelector('button')
			if (!(button instanceof HTMLButtonElement)) return
			button.disabled = !view.can
			button.title = view.title
			return
		}
		default:
			return
	}
}

type BorderPath = {
	readonly container: 'border'
	readonly region: PaletteRegion
	readonly trackIndex: number
	readonly slotIndex: number
	readonly itemIndex: number
}

type ParkingPath = {
	readonly container: 'parking'
	readonly toolbarIndex: number
	readonly itemIndex: number
}

type InspectingPath = BorderPath | ParkingPath

const REGIONS: readonly PaletteRegion[] = ['top', 'right', 'bottom', 'left']

/**
 * Regions whose live layout holds a tool bound to a point using `bagName`.
 * Used to scope context identity-change re-renders (set/removeContext):
 * only borders that can display the bag rebuild; the rest keep DOM identity.
 */
function regionsUsingBag(core: PaletteCore, bagName: string): readonly PaletteRegion[] {
	const pointIds = new Set<string>()
	for (const point of core.points) {
		if ((point.uses ?? []).includes(bagName)) pointIds.add(point.id)
	}
	if (pointIds.size === 0) return []
	const live = core.layout.getLayout()
	const hits: PaletteRegion[] = []
	for (const region of REGIONS) {
		let found = false
		for (const track of live.borders[region]) {
			if (found) break
			for (const slot of track) {
				if (found) break
				for (const item of slot.toolbar) {
					const id = toolPointId(item)
					if (id !== undefined && pointIds.has(id)) {
						found = true
						break
					}
				}
			}
		}
		if (found) hits.push(region)
	}
	return hits
}

function directionFor(region: PaletteRegion): 'horizontal' | 'vertical' {
	return region === 'left' || region === 'right' ? 'vertical' : 'horizontal'
}

function el(tag: string, className: string): HTMLElement {
	const node = document.createElement(tag)
	node.className = className
	return node
}

function iconSpan(icon: string | undefined): HTMLElement | null {
	if (icon === undefined) return null
	const span = el('span', 'palette-default-icon')
	span.textContent = icon
	return span
}

/** Vanilla head capability registry for the configurator editor choices. */
const VANILLA_EDITOR_REGISTRY = {
	boolean: {
		toggle: { id: 'toggle', label: 'Toggle', families: ['boolean'] as const },
	},
	enum: {
		select: { id: 'select', label: 'Select', families: ['enum'] as const },
		segmented: { id: 'segmented', label: 'Segmented', families: ['enum'] as const },
	},
	number: {
		slider: { id: 'slider', label: 'Slider', families: ['number'] as const },
		stepper: { id: 'stepper', label: 'Stepper', families: ['number'] as const },
		stars: { id: 'stars', label: 'Stars', families: ['number'] as const },
	},
	item: {
		commandBox: { id: 'commandBox', label: 'Command box', families: ['item'] as const },
		drawer: { id: 'drawer', label: 'Drawer', families: ['item'] as const },
		status: { id: 'status', label: 'Status', families: ['item'] as const },
	},
	run: {
		button: { id: 'button', label: 'Button', families: ['action'] as const },
	},
} as never

const VANILLA_EDITOR_DEFAULTS = {
	run: 'button',
	boolean: 'toggle',
	enum: 'select',
	number: 'slider',
} as never

function defaultEditorFor(point: AnyPoint | undefined): string | undefined {
	if (point === undefined) return 'status'
	if (isActionPoint(point)) return 'button'
	if (!isValuedPoint(point)) return 'status'
	if (point.type === 'boolean') return 'toggle'
	if (point.type === 'enum') return 'select'
	return 'slider'
}

function samePath(left: InspectingPath | undefined, right: InspectingPath): boolean {
	if (left === undefined) return false
	if (left.container !== right.container) return false
	if (left.container === 'parking' && right.container === 'parking') {
		return left.toolbarIndex === right.toolbarIndex && left.itemIndex === right.itemIndex
	}
	if (left.container === 'border' && right.container === 'border') {
		return (
			left.region === right.region &&
			left.trackIndex === right.trackIndex &&
			left.slotIndex === right.slotIndex &&
			left.itemIndex === right.itemIndex
		)
	}
	return false
}

/** Case-insensitive substring filter for add-item sources (no core helper). */
function filterAddSources(
	sources: readonly AddItemSource[],
	query: string
): readonly AddItemSource[] {
	const term = query.trim().toLowerCase()
	if (term === '') return sources
	return sources.filter((source) => {
		const haystack = [
			source.id,
			source.label,
			source.meta,
			...(source.keywords ?? []),
			...(source.categories ?? []),
		]
			.join(' ')
			.toLowerCase()
		return term
			.split(/\s+/)
			.filter((part) => part.length > 0)
			.every((part) => haystack.includes(part))
	})
}

export function createIDE(container: HTMLElement, options: IdeOptions): IdeHandle {
	const { core, consoleStore } = options
	const paletteId = options.paletteId ?? 'demo'
	const itemEditors = options.itemEditors ?? ['commandBox', 'drawer', 'status']
	const keys = createVanillaKeys(core.keys)
	const nodes = new NodeRegistry()
	/**
	 * Live per-tool bindings: content element → subscriptions. Dropped when
	 * the owning host rebuilds (per-border / console / full sync) or on
	 * dispose, so discarded elements never leak listeners.
	 */
	const toolBindings = new Map<HTMLElement, ToolBinding>()

	function dropBindingsIn(host: HTMLElement): void {
		for (const [node, unsubs] of [...toolBindings]) {
			if (host.contains(node)) {
				for (const unsub of unsubs) unsub()
				toolBindings.delete(node)
			}
		}
	}

	function dropAllBindings(): void {
		for (const unsubs of toolBindings.values()) {
			for (const unsub of unsubs) unsub()
		}
		toolBindings.clear()
	}

	/**
	 * Subscribe one rendered tool to its point value (per-id, in-place
	 * update — never a structural sync). Valued editors follow
	 * `values.subscribe(id)`; action buttons follow `subscribeCan` flips;
	 * context-bound tools (`uses`) additionally follow `subscribeContext`
	 * (bag change → re-read dual-source value). Pointless tools
	 * (`status`/`commandBox`/`drawer`) bind nothing.
	 */
	function bindTool(content: HTMLElement, item: ToolbarItem, surface: SurfaceContext): void {
		const editor = (item as { editor?: unknown }).editor
		const pointId = toolPointId(item)
		const point = pointId !== undefined ? core.getDefinition(pointId) : undefined
		const update = () => updateToolNode(core, item, surface, content)
		const unsubs: Unsubscribe[] = []
		if (point !== undefined && isValuedPoint(point)) {
			unsubs.push(core.values.subscribe(point.id, () => update()))
			if ((point.uses ?? []).length > 0) {
				unsubs.push(
					core.subscribeContext((bagName, changed) => {
						// Identity change (`changed` empty from set/removeContext)
						// re-resolves everything for this bag; key change only
						// updates when this point's id moved.
						if (!(point.uses ?? []).includes(bagName)) return
						if (changed.length === 0 || changed.includes(point.id)) update()
					})
				)
			}
		} else if (point !== undefined && isActionPoint(point) && editor === 'button') {
			unsubs.push(
				core.subscribeCan((id) => {
					if (id === point.id) update()
				})
			)
		}
		if (unsubs.length > 0) toolBindings.set(content, unsubs)
	}

	let inspecting: InspectingPath | undefined
	let consoleQuery = ''
	let disposed = false
	/** Last applied editing flag — drives the no-rebuild chrome pass. */
	let lastEditing: boolean | undefined
	/**
	 * Live drag session (Phase 1: the spec `ToolbarDrag` shell; the legacy
	 * `DraggingState` stays reachable via `sessionState()` until Phase 7
	 * makes mode/origin session-internal).
	 */
	let dragSession: ToolbarDrag | undefined
	/**
	 * Legacy alias — the explicit session the engine still takes as a param.
	 *
	 * @deprecated Phase 7 — mode/origin go session-internal; do not add new readers.
	 */
	let dragging: DraggingState | undefined
	/**
	 * Idempotency memo: last track-space gap committed (same gap = no-op).
	 * After a commit the fresh toolbar sits under the pointer — keeping the
	 * memo (not clearing it) absorbs the repeat move, so a second toolbar
	 * is never built for the same gap. Only a *different* gap commits again.
	 * Mirrors the svelte `ToolbarTrack` memo.
	 */
	let hoveredTrackSpace: number | undefined

	/**
	 * Live slide-follow for a whole-toolbar drag (Phase 4: core decides the
	 * delta, the adapter only writes it). Gaps stay untouched during the
	 * drag — the toolbar follows the pointer via compositor-only `transform`
	 * from core `slide` events; `clearSlide` drops the transform and disarms
	 * the follow loop; `resize` re-reads the two gaps' `space` into flex.
	 * Mirrors the svelte `ToolbarTrack` declarative effect + rAF loop, armed
	 * imperatively here.
	 */
	let slideCleanup: (() => void) | undefined
	let slideToolbar: Toolbar | undefined
	/** Latest `slide` delta per followed toolbar (rAF write cache). */
	let slideDelta: number | undefined
	/** Queued rAF write for the follow loop. */
	let slideQueued = false
	/**
	 * Grab offset within the followed toolbar, captured at mousedown and
	 * preserved across relocations. A fresh singleton from a restructure
	 * extraction has no mousedown grab, so it derives one from the
	 * mousedown point within the dragged button instead (mirrors svelte
	 * `retargetToolbarSlide` + `recenter`, but exact rather than middle).
	 */
	let slideGrabOffset: number | undefined
	/**
	 * Mousedown point within the dragged item (button), captured at grab
	 * time. A restructure extraction promotes the dragged button into a
	 * fresh singleton toolbar — the re-arm adds this intra-button offset
	 * to the button's fresh offset inside its new toolbar, so the pointer
	 * stays glued to the same point on the icon. Falls back to the
	 * toolbar middle when unmeasurable (mirrors svelte `recenter`).
	 */
	let slideItemGrab: { readonly x: number; readonly y: number } | undefined
	/**
	 * The pointer event a structure event is being applied for, so the
	 * adapter can re-arm slide-follow against the freshly placed toolbar
	 * (slide-follow is adapter-owned until Phase 4). Set around the `over()`
	 * call that can commit; `undefined` for dwell commits (no pointer
	 * position to re-measure against).
	 */
	let slideRearmEvent: PointerEvent | undefined

	/**
	 * Arm slide-follow over the dragged toolbar's live element: measure once
	 * (bounds + resting + grab), push the frame to the session, and attach
	 * the rAF write cache that applies whatever `slide` events say. Never
	 * measures per move — only here and on re-arm after `structure`. Per-move
	 * deltas arrive as `slide` events from the `over()` calls the hit-test
	 * handlers already make (they now carry the real pointer sample); this
	 * function only writes them to the DOM.
	 *
	 * `grab` is the cursor offset *within the followed toolbar*: the
	 * mousedown offset for a whole-toolbar grab (kept across relocations so
	 * the cursor stays glued to the same point), or — for a restructure
	 * extraction — the dragged button's fresh offset inside its new toolbar
	 * plus the mousedown point within the button (so the pointer stays on
	 * the icon, not on the toolbar middle). Passing the mousedown offset of
	 * the *old* toolbar would shift the fresh singleton by the width
	 * difference — the "far too right / far too left" jump.
	 */
	function armSlide(
		toolbar: Toolbar,
		region: PaletteRegion,
		event: PointerEvent,
		options?: { readonly recenter?: boolean }
	): void {
		disarmSlide()
		const element = nodes.get(toolbar)
		if (!(element instanceof HTMLElement)) return
		if (dragSession === undefined) return
		const ownerWindow = element.ownerDocument.defaultView ?? window
		const direction = directionFor(region)
		const horizontal = direction === 'horizontal'
		const rect = element.getBoundingClientRect()
		let grabOffset: number
		if (options?.recenter === true) {
			grabOffset = recenterGrabOffset(element, direction)
		} else if (slideGrabOffset !== undefined) {
			grabOffset = slideGrabOffset
		} else {
			grabOffset = toolbarGrabOffset({
				toolbarElement: element,
				clientX: event.clientX,
				clientY: event.clientY,
				direction,
			})
		}
		slideGrabOffset = grabOffset
		const bounds = toolbarSlideBounds(element, direction)
		if (bounds === undefined) return
		const resting = (horizontal ? rect.left : rect.top) - bounds.start
		const frame: SlideFrame = {
			axis: horizontal ? 'horizontal' : 'vertical',
			start: bounds.start,
			available: bounds.available,
			resting,
			grab: grabOffset,
		}
		slideToolbar = toolbar
		slideDelta = undefined
		slideQueued = false
		dragSession.measure(frame)
		const flush = () => {
			slideQueued = false
			const live = slideToolbar !== undefined ? nodes.get(slideToolbar) : undefined
			if (!(live instanceof HTMLElement) || !live.isConnected) return
			const delta = slideDelta
			if (delta === undefined) return
			live.style.transform =
				delta === 0
					? ''
					: horizontal
						? `translate3d(${delta}px, 0, 0)`
						: `translate3d(0, ${delta}px, 0)`
		}
		/** Queue one rAF write (coalesces a move burst into one frame). */
		slideQueueWrite = () => {
			if (!slideQueued) {
				slideQueued = true
				ownerWindow.requestAnimationFrame(flush)
			}
		}
		slideCleanup = () => {
			const live = slideToolbar !== undefined ? nodes.get(slideToolbar) : undefined
			if (live instanceof HTMLElement) live.style.transform = ''
			slideToolbar = undefined
			slideDelta = undefined
			slideQueued = false
			slideQueueWrite = undefined
		}
	}

	/** Latest queued rAF write for the follow loop (set at arm time). */
	let slideQueueWrite: (() => void) | undefined

	/**
	 * Grab offset for a restructure extraction: the dragged button's fresh
	 * offset inside its new toolbar plus the mousedown point within the
	 * button — so the pointer stays glued to the same point on the icon.
	 * Falls back to the toolbar middle when the button is unmeasurable
	 * (mirrors svelte `recenter`). Single copy lives in `slide.ts`
	 * (`extractionGrabOffset`) — this is the thin adapter call-site.
	 */
	function recenterGrabOffset(
		toolbarElement: HTMLElement,
		direction: 'horizontal' | 'vertical'
	): number {
		const item = dragging?.tools[0]
		const itemNode = item !== undefined ? nodes.get(item) : undefined
		return extractionGrabOffset({
			toolbarElement,
			buttonElement: itemNode,
			buttonGrab: slideItemGrab,
			direction,
		})
	}

	/** Drop slide-follow and clear the live transform. */
	function disarmSlide(): void {
		dragSession?.measure(undefined)
		slideCleanup?.()
		slideCleanup = undefined
	}

	/**
	 * Find the live toolbar array holding `item` (borders + parking).
	 * Identity scan — position is never trusted across renders.
	 */
	function findToolbarOf(
		live: ReturnType<PaletteCore['layout']['getLayout']>,
		item: ToolbarItem
	): Toolbar | undefined {
		for (const region of REGIONS) {
			for (const track of live.borders[region]) {
				for (const slot of track) {
					if (slot.toolbar.includes(item)) return slot.toolbar
				}
			}
		}
		for (const toolbar of live.parking) {
			if (toolbar.includes(item)) return toolbar
		}
		return undefined
	}

	/**
	 * Open a drag session for one tool. The core decides whole-toolbar vs
	 * subset at `createDrag` (grab target in, session out) — this adapter
	 * only hit-tests, measures, and applies session events. A lone tool in
	 * its toolbar starts as a whole-toolbar slide (`isWholeToolbar` set at
	 * drag-start by core), so slide-follow arms immediately. No session →
	 * no events → dark, so hover alone never paints. Restructuring happens
	 * only on a highlighted DZ: hovering a dark gap emits nothing.
	 */
	function startToolDrag(event: PointerEvent, toolbar: Toolbar, item: ToolbarItem): void {
		if (dragSession) return
		if (event.button !== 0) return
		if (isEditableTarget(event.target)) return
		if (!computeEditing()) return
		event.preventDefault()
		// Mousedown point within the dragged button: a restructure
		// extraction promotes this button into a fresh singleton toolbar,
		// and the re-arm adds this intra-button offset to the button's
		// fresh offset inside its new toolbar — so the pointer stays on
		// the icon. Captured off the button wrapper (the guard bleeds
		// 3px past it via `inset: -3px`, so the guard's own rect would
		// bias the offset by up to 3px).
		const guard = event.currentTarget
		const buttonNode = guard instanceof HTMLElement ? nodes.get(item) : undefined
		const buttonBox = buttonNode ?? guard
		if (buttonBox instanceof HTMLElement) {
			const buttonRect = buttonBox.getBoundingClientRect()
			slideItemGrab = {
				x: event.clientX - buttonRect.left,
				y: event.clientY - buttonRect.top,
			}
		} else {
			slideItemGrab = undefined
		}
		try {
			dragSession = core.layout.createDrag({ kind: 'tool', toolbar, item })
			dragging = sessionState(dragSession)
			// Paint + structure arrive as session events (subscribed once
			// per gesture — the session dies on `endToolDrag`).
			dragSession.subscribe(applySessionEvent)
		} catch {
			// Drawer-child toolbars live outside borders/parking — core has
			// no origin for them, so no drag session (no crash on grab).
			dragSession = undefined
			dragging = undefined
			return
		}
		applyDragChrome()
		// Lone-tool grab is already a whole-toolbar slide: arm follow now
		// so the bar sticks under the cursor before any commit.
		const region = (event.currentTarget as HTMLElement | null)?.closest?.('.toolbar-border')
		const regionName = region?.getAttribute?.('data-region') as PaletteRegion | null
		if (dragging.isWholeToolbar && regionName) armSlide(dragging.origin.toolbar, regionName, event)
		startDragSession({
			event,
			onMove: () => {},
			onStop: () => endToolDrag(),
		})
	}

	/**
	 * Phase 6 catalog source: pointerdown on a console add-panel variant
	 * starts a creation session (`{ kind: 'catalog', item }` — no origin
	 * until the first placement inserts). The item is built with the same
	 * factory as the discrete add flow (`itemFromAddSelection`), so drag
	 * and click insert the same object shape. The console stays open under
	 * the gesture (the overlay background is the mask); `endToolDrag`
	 * closes nothing.
	 */
	function startCatalogDrag(event: PointerEvent, item: ToolbarItem): void {
		if (dragSession) return
		if (event.button !== 0) return
		if (isEditableTarget(event.target)) return
		if (!computeEditing()) return
		event.preventDefault()
		slideItemGrab = undefined
		dragSession = core.layout.createDrag({ kind: 'catalog', item })
		dragging = sessionState(dragSession)
		dragSession.subscribe(applySessionEvent)
		applyDragChrome()
		startDragSession({
			event,
			onMove: () => {},
			onStop: () => endToolDrag(),
		})
	}

	/**
	 * Phase 6 chrome mirror: container `.dragging` + `data-dragging` (the
	 * Phase 1–5 chrome) plus per-toolbar `data-dragged` on the grabbed
	 * toolbar in its own container (mirrors svelte `Toolbar`
	 * `data-dragged` via `isDraggedToolbarAt`) plus root
	 * `palette-dragging` (mirrors svelte `paletteRoot`). Container-scoped:
	 * the same object rendered twice matches only where the drag
	 * originated. Re-applied after every `structure` event (the placed
	 * toolbar is a fresh object / new container after a commit).
	 */
	function applyDragChrome(): void {
		if (dragging === undefined) return
		container.classList.add('dragging')
		container.dataset.dragging = 'true'
		// NOTE: no `palette-dragging` class and no `data-dragged` yet (see
		// below) — both change layout-sensitive chrome. `palette-dragging`
		// has no CSS rule (dead mirror); `data-dragged` adds
		// `2 × --palette-dz-size` padding to the dragged toolbar, which
		// shifts every `getBoundingClientRect` the slide + outside
		// measurements read. Wire them only with the Phase 6 e2e pins that
		// prove the shift is compensated.
		const live = core.layout.getLayout()
		const origin = dragging.origin
		if (origin.kind === 'border') {
			const border = live.borders[regionOfBorder(origin.border, live) ?? 'top']
			const trackIndex = border.indexOf(origin.track)
			if (trackIndex < 0) return
			const track = border[trackIndex]
			if (track === undefined) return
			for (const slot of track) {
				const node = nodes.get(slot.toolbar)
				if (!(node instanceof HTMLElement)) continue
				if (
					isDraggedToolbarAt(dragging, slot.toolbar, {
						kind: 'border',
						toolbar: slot.toolbar,
						track,
						border,
					})
				) {
					void node
				} else {
					delete node.dataset.dragged
				}
			}
			return
		}
		for (const row of live.parking) {
			const node = nodes.get(row)
			if (!(node instanceof HTMLElement)) continue
			const index = live.parking.indexOf(row)
			if (
				isDraggedToolbarAt(dragging, row, {
					kind: 'parking',
					toolbar: row,
					parking: live.parking,
					index,
				})
			) {
				void node
			} else {
				delete node.dataset.dragged
			}
		}
	}

	/** Region holding `border` (identity scan — mirrors core `regionOf`). */
	function regionOfBorder(
		border: Border,
		live: ReturnType<PaletteCore['layout']['getLayout']>
	): PaletteRegion | undefined {
		for (const region of REGIONS) {
			if (live.borders[region] === border) return region
		}
		return undefined
	}

	/** Clear the Phase 6 chrome mirror (per-toolbar + root). */
	function clearDragChrome(): void {
		container.classList.remove('palette-dragging')
		// `data-dragged` is never set yet (see `applyDragChrome`): the
		// sweep stays so the mirror cannot leave stale attributes behind
		// once it is wired.
		for (const host of [topHost, leftHost, rightHost, bottomHost, consoleHost]) {
			for (const node of host.querySelectorAll('.toolbar[data-dragged]')) {
				if (node instanceof HTMLElement) delete node.dataset.dragged
			}
		}
	}

	/**
	 * Open a drag session for a whole toolbar (mousedown on the bar itself,
	 * not on a tool). All tools drag together as a slide from the start —
	 * mirrors svelte `paletteToolbarDrag`. Slide-follow arms immediately
	 * for border toolbars (parking rows have no track to slide along).
	 */
	function startToolbarDrag(
		event: PointerEvent,
		toolbar: Toolbar,
		region: PaletteRegion,
		dragTarget?: { readonly track: Track; readonly border: import('@palettable/core').Border }
	): void {
		if (dragSession) return
		if (event.button !== 0) return
		if (isEditableTarget(event.target)) return
		if (!computeEditing()) return
		// A tool (or its guard) owns the gesture — bar drag is background only.
		if ((event.target as HTMLElement | null)?.closest?.('.toolbar-item')) return
		event.preventDefault()
		try {
			dragSession = core.layout.createDrag({ kind: 'toolbar', toolbar })
			dragging = sessionState(dragSession)
			dragSession.subscribe(applySessionEvent)
		} catch {
			// Drawer-child toolbars live outside borders/parking — core has
			// no origin for them, so no drag session (no crash on grab).
			dragSession = undefined
			dragging = undefined
			return
		}
		applyDragChrome()
		if (dragTarget !== undefined) armSlide(dragging.origin.toolbar, region, event)
		startDragSession({
			event,
			onMove: () => {},
			onStop: () => endToolDrag(),
		})
	}

	/** End the session: drop paint classes, slide transform, forget the session. */
	function endToolDrag(): void {
		// `end()` first: it emits `resize` (model write) → `clearSlide` →
		// highlight clears, all applied synchronously by the subscription
		// below. `disarmSlide()` after only drops the rAF loop + transform
		// (`measure(undefined)` on the ended session is a no-op).
		dragSession?.end()
		disarmSlide()
		dragSession = undefined
		dragging = undefined
		hoveredTrackSpace = undefined
		slideGrabOffset = undefined
		slideItemGrab = undefined
		clearDragChrome()
		container.classList.remove('dragging')
		delete container.dataset.dragging
		for (const host of [topHost, leftHost, rightHost, bottomHost, consoleHost]) {
			clearGapClasses(host)
		}
	}

	/**
	 * Single event entry: apply session events in emission order with
	 * minimal DOM work. `highlight` toggles classes; `structure` re-syncs
	 * the node map (and re-arms slide-follow against the placed toolbar);
	 * `slide` caches the delta + queues the rAF write; `clearSlide` drops
	 * the transform + disarms the follow loop; `resize` re-reads the two
	 * gaps' `space` into flex.
	 */
	function applySessionEvent(event: DragEvent): void {
		switch (event.type) {
			case 'highlight':
				applyHighlightEvent(event)
				return
			case 'structure':
				applyStructureEvent(event)
				return
			case 'slide':
				applySlideEvent(event.toolbar, event.delta)
				return
			case 'clearSlide':
				applyClearSlideEvent(event.toolbar)
				return
			case 'resize':
				applyResizeEvent(event.track, event.index)
				return
		}
	}

	/**
	 * Cache the core-decided delta and queue the single rAF write. Ignores
	 * events for a toolbar this adapter is not following (a stale session
	 * event after re-arm).
	 */
	function applySlideEvent(toolbar: Toolbar, delta: number): void {
		if (slideToolbar === undefined || slideToolbar !== toolbar) return
		slideDelta = delta
		slideQueueWrite?.()
	}

	/** Drop the transform + disarm the follow loop for `toolbar`. */
	function applyClearSlideEvent(toolbar: Toolbar): void {
		if (slideToolbar !== undefined && slideToolbar !== toolbar) return
		const live = slideToolbar !== undefined ? nodes.get(slideToolbar) : undefined
		if (live instanceof HTMLElement) live.style.transform = ''
		slideToolbar = undefined
		slideDelta = undefined
		slideQueued = false
	}

	/**
	 * Re-read the two gaps flanking `track[index]` after core wrote their
	 * `space` values, so the gaps take over exactly where the transform
	 * left the toolbar (nothing visibly moves).
	 */
	function applyResizeEvent(track: Track, index: number): void {
		const trackEl = nodes.get(track)
		if (!(trackEl instanceof HTMLElement)) return
		for (const gap of [index, index + 1]) {
			const node = trackEl.querySelector(`[data-track-space-index="${gap}"]`)
			if (!(node instanceof HTMLElement)) continue
			const space = actualTrackSpaceAt(track, gap)
			node.style.flexBasis = `${space * 100}%`
			node.style.flexGrow = `${Math.max(space, configuration.trackGapMinGrow)}`
		}
	}

	/**
	 * Re-arm slide-follow after a commit: re-measure against the freshly
	 * placed toolbar and push the new frame (the DOM moved, so the old
	 * frame's `start`/`resting` are stale). A restructure that extracts its
	 * tools promotes to a whole-toolbar slide, and the fresh toolbar sits
	 * under the cursor (mirrors the svelte track effect). `armSlide`
	 * re-measures, so it is the same one call whether the toolbar is the
	 * old or a new object — except for the grab: a fresh extraction has no
	 * mousedown grab yet (`slideGrabOffset` undefined), so it recenters to
	 * its middle (the dragged icon — mirrors svelte `retargetToolbarSlide`
	 * `recenter: dragging.grabOffset === undefined`), while a relocated
	 * toolbar keeps the mousedown offset. Measuring the grab off the fresh
	 * toolbar (`pointer − freshLeft`) would freeze a gap-sized offset into
	 * every later delta — the "far too right / far too left" jump.
	 */
	function rearmSlideAfterStructure(): void {
		const target = dragging?.origin.toolbar
		const event = slideRearmEvent
		if (!dragging?.isWholeToolbar || target === undefined || event === undefined) {
			disarmSlide()
			return
		}
		const region = regionOfToolbar(target)
		if (region === undefined) {
			disarmSlide()
			return
		}
		armSlide(target, region, event, {
			recenter: slideGrabOffset === undefined,
		})
	}

	/** Live region of a toolbar (border only — parking rows never slide). */
	function regionOfToolbar(toolbar: Toolbar): PaletteRegion | undefined {
		const live = core.layout.getLayout()
		for (const region of REGIONS) {
			for (const track of live.borders[region]) {
				for (const slot of track) {
					if (slot.toolbar === toolbar) return region
				}
			}
		}
		return undefined
	}

	/**
	 * Legacy session state behind the `ToolbarDrag` shell (Phase 1 only).
	 * The engine still takes it explicitly; Phase 7 removes this escape
	 * hatch when mode/origin go session-internal.
	 *
	 * @deprecated Phase 7 — escape hatch; do not add new callers.
	 */
	function sessionState(session: ToolbarDrag): DraggingState {
		const inner = (session as unknown as { draggingState: DraggingState }).draggingState
		if (!inner) throw new Error('sessionState: session has no draggingState')
		return inner
	}

	/**
	 * Single hit-test: resolve the element under the cursor to a tagged
	 * `Hoverable` (`closest(...)` + node-map `===` lookup). Tracks need no
	 * separate hit — any toolbar/tool/gap inside a track implies its
	 * containing track. `null` when the pointer is over none of them.
	 * Used by the bar-background path (tool fallback + gap hover share it);
	 * the gap-direct path inlines the same lookup via `overItemGap`.
	 */
	function toHoverable(target: HTMLElement, bar: HTMLElement): Hoverable | null {
		// Inside a nested toolbar → that toolbar owns the item DZs.
		if (target.closest('.toolbar') !== bar) return null
		const spaceEl = target.closest('[data-item-space-index]')
		if (spaceEl && bar.contains(spaceEl)) {
			const index = Number((spaceEl as HTMLElement).dataset.itemSpaceIndex)
			if (!Number.isInteger(index)) return null
			const toolbar = toolbarOfBar(bar)
			if (!toolbar) return null
			return { kind: 'item-gap', toolbar, gap: index }
		}
		const itemEl = target.closest('[data-item-index]')
		if (itemEl && bar.contains(itemEl)) {
			const toolbar = toolbarOfBar(bar)
			const active = Number((itemEl as HTMLElement).dataset.itemIndex)
			if (!toolbar || !Number.isInteger(active)) return null
			const item = toolbar[active]
			if (!item) return null
			return { kind: 'tool', toolbar, item }
		}
		return null
	}

	/** Reverse lookup: live `Toolbar` array behind a rendered `.toolbar` bar. */
	function toolbarOfBar(bar: HTMLElement): Toolbar | undefined {
		const live = core.layout.getLayout()
		for (const region of REGIONS) {
			for (const track of live.borders[region]) {
				for (const slot of track) {
					if (nodes.get(slot.toolbar) === bar) return slot.toolbar
				}
			}
		}
		for (const toolbar of live.parking) {
			if (nodes.get(toolbar) === bar) return toolbar
		}
		return undefined
	}

	/**
	 * Route an item-gap hover through the session. Paint arrives as
	 * `highlight` events and a commit as a `structure` event (both applied by
	 * the session subscription), so there is nothing to read back: the session
	 * is the only writer during a drag.
	 * The session resolves the container itself (border toolbar vs parking row).
	 */
	function overItemGap(
		session: ToolbarDrag,
		toolbar: Toolbar,
		gap: number,
		event: PointerEvent
	): void {
		slideRearmEvent = event
		session.over({ kind: 'item-gap', toolbar, gap }, pointerSample(event))
		slideRearmEvent = undefined
	}

	/** Raw client numbers per hover (core picks the axis in Phase 4). */
	function pointerSample(event: PointerEvent): { clientX: number; clientY: number } {
		return { clientX: event.clientX, clientY: event.clientY }
	}

	/**
	 * Phase 6 `outside` hit-test: the pointer is over the border element
	 * but on no gap/track/toolbar (its padding / stack-gap halo) — measure
	 * the track spans and project onto the border's own stack-gap index
	 * space via `outsideGapForTrack` (pure, unit-pinned in
	 * `outside.test.ts`). Returns the gap to report as `{ kind: 'outside'
	 * }`, or `undefined` when the pointer is outside the border box or
	 * there is nothing to align with.
	 */
	function outsideGapAt(
		borderEl: HTMLElement,
		border: Border,
		event: PointerEvent
	): number | undefined {
		if (border.length === 0) return undefined
		const rect = borderEl.getBoundingClientRect()
		if (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		) {
			return undefined
		}
		const region = borderEl.getAttribute('data-region') as PaletteRegion | null
		const horizontal = region === 'top' || region === 'bottom'
		const spans: { readonly start: number; readonly end: number }[] = []
		for (const node of borderEl.querySelectorAll(':scope > .toolbar-track')) {
			if (!(node instanceof HTMLElement)) continue
			const box = node.getBoundingClientRect()
			spans.push(
				horizontal ? { start: box.top, end: box.bottom } : { start: box.left, end: box.right }
			)
		}
		if (spans.length === 0) return 0
		return outsideGapForTrack(spans, horizontal ? event.clientY : event.clientX)
	}

	/**
	 * Apply one session `highlight` event: toggle classes on the live gap
	 * node (`on` → `highlighted`, `double` → `highlighted hovered`,
	 * `off` → neither). The DZ carries its live container, so the node is
	 * resolved through the node map (`===`) — never by position.
	 */
	function applyHighlightEvent(event: DragEvent): void {
		if (event.type !== 'highlight') return
		applyHighlight(event.dz, event.state)
	}

	/** Toggle classes for one DZ: direct per-gap paint (Phase 2 events are
	 * diffs — the session already diffed, so the adapter touches exactly
	 * the gap in the event, never a full container set). */
	function applyHighlight(dz: DropZone, state: HighlightState): void {
		const on = state === 'on' || state === 'double'
		const hovered = state === 'double'
		const toggle = (node: Element | null) => {
			if (!(node instanceof HTMLElement)) return
			node.classList.toggle('highlighted', on)
			node.classList.toggle('hovered', hovered)
		}
		switch (dz.kind) {
			case 'item-gap': {
				const node = nodes.get(dz.toolbar)
				if (!(node instanceof HTMLElement)) return
				toggle(node.querySelector(`[data-item-space-index="${dz.gap}"]`))
				return
			}
			case 'track-gap': {
				const node = nodes.get(dz.track)
				if (!(node instanceof HTMLElement)) return
				toggle(node.querySelector(`[data-track-space-index="${dz.gap}"]`))
				return
			}
			case 'stack-gap':
			case 'outside': {
				const borderEl = borderElementOf(dz.border)
				if (!(borderEl instanceof HTMLElement)) return
				toggle(borderEl.querySelector(`:scope > [data-stack-index="${dz.gap}"]`))
				return
			}
			case 'parking-gap': {
				const stack = consoleHost.querySelector('.palette-parking')
				if (!(stack instanceof HTMLElement)) return
				toggle(stack.querySelector(`:scope > [data-parking-gap-index="${dz.gap}"]`))
				return
			}
		}
	}

	/** Reverse lookup: live `.toolbar-border` element behind a `Border` array. */
	function borderElementOf(border: import('@palettable/core').Border): HTMLElement | undefined {
		for (const host of [topHost, leftHost, rightHost, bottomHost]) {
			const borderEl = host.querySelector('.toolbar-border')
			if (!(borderEl instanceof HTMLElement)) continue
			const region = borderEl.getAttribute('data-region') as PaletteRegion | null
			if (region && core.layout.getLayout().borders[region] === border) return borderEl
		}
		return undefined
	}

	/**
	 * Apply a session `structure` event: re-sync through the existing
	 * `applyOp` node-map path (create/move/remove via `===` map; prune
	 * victims drop nodes). A `replace` op (dwell commits until Phase 3b
	 * routes them through the tree) rebuilds everything.
	 */
	function applyStructureEvent(event: DragEvent): void {
		if (event.type !== 'structure') return
		applyOp(event.op)
		// The placed toolbar is a fresh object (or a new container) after a
		// commit — the chrome mirror keys on identity, so re-apply it.
		applyDragChrome()
		rearmSlideAfterStructure()
	}

	/**
	 * Item-space hover through the core session. Paint arrives as `highlight`
	 * events and a commit as a `structure` event, both applied by the session
	 * subscription — nothing is read back.
	 *
	 * `item-gap` commits (merge / ownership transfer); `toolbar` +
	 * `activeItem` is the paint-only active-item fallback anchored on the
	 * item under the pointer. The session resolves the container itself.
	 */
	function paintItemSpaces(
		_bar: HTMLElement,
		toolbar: Toolbar,
		activeItem: number | undefined,
		hovered: number | undefined,
		event: PointerEvent
	): void {
		const session = dragSession
		if (!computeEditing() || !session) {
			session?.over(null, pointerSample(event))
			return
		}
		// No anchor at all → nothing to paint, and the previous paint must go
		// (a hover that resolves to nothing is not "keep the last highlight").
		if (hovered === undefined && activeItem === undefined) {
			session.over(null, pointerSample(event))
			return
		}
		const hover: Hoverable =
			hovered !== undefined
				? { kind: 'item-gap', toolbar, gap: hovered }
				: { kind: 'toolbar', toolbar, activeItem }
		// Real pointer sample: the session derives the slide delta from it
		// whenever a frame is armed — a zero sample would emit a spurious
		// `slide` while sliding.
		session.over(hover, pointerSample(event))
	}

	container.classList.add('palette-ide')
	if (!container.hasAttribute('tabindex')) container.tabIndex = 0
	container.dataset.paletteId = paletteId

	// Wrap existing children (the work-zone) in middle > center.
	const previousChildren = [...container.childNodes]
	const topHost = document.createElement('div')
	const middle = el('div', 'palette-ide-middle')
	const leftHost = document.createElement('div')
	const center = el('div', 'palette-ide-center')
	const rightHost = document.createElement('div')
	const bottomHost = document.createElement('div')
	// Hosts are layout-transparent: `display: contents` makes the rendered
	// `.toolbar-border` elements direct flex participants of `.palette-ide`
	// (top/bottom) and `.palette-ide-middle` (left/right), mirroring the
	// svelte `Ide` (which renders `ToolbarBorder` with no wrappers). Without
	// this the bare hosts are `display: block`, so a vertical border's height
	// collapses to its content and track gaps (`space`) never distribute —
	// a single `space: 1` toolbar sticks to the top instead of the bottom.
	for (const host of [topHost, leftHost, rightHost, bottomHost]) {
		host.style.display = 'contents'
	}
	for (const child of previousChildren) center.append(child)
	middle.append(leftHost, center, rightHost)
	container.append(topHost, middle, bottomHost)
	// The console overlay mounts inside the center next to the work-zone.
	// `consoleHost` stays last so the overlay never steals the work-zone's
	// position; the work-zone keeps its own `data-testid` for the dimming
	// assertion (`work-zone.is-dimmed` while the console is open).
	const consoleHost = document.createElement('div')
	center.append(consoleHost)

	/**
	 * Phase 6 mask affordance (mirrors svelte `Ide` `maskHover`): while
	 * editing + dragging, a pointer over the dimmed work zone / overlay
	 * background (the center, but not over a border and not inside the
	 * console panel / drawer popup / dialog) paints the inner end gap of
	 * each border (`border.length` — bottom-most of top, top-most of
	 * bottom, right-most of left, left-most of right). Paint-only and
	 * consequence-free: the adapter toggles the classes directly (never
	 * through the session — a mask position maps to nothing, so the
	 * session would see `null` and clear), applying the core-exported
	 * emptied veto itself so the *rule* stays in core. The dwell never
	 * arms here (mirrors svelte `masked` guard).
	 */
	function paintMask(active: boolean): void {
		const live = core.layout.getLayout()
		for (const region of REGIONS) {
			const border = live.borders[region]
			const borderEl = borderElementOf(border)
			if (!(borderEl instanceof HTMLElement)) continue
			const gap = border.length
			const node = borderEl.querySelector(`:scope > [data-stack-index="${gap}"]`)
			if (!(node instanceof HTMLElement)) continue
			// Core-owned veto rule (same predicate the session uses):
			// a drag that would empty its origin track never paints the
			// two stacks touching that track — including via the mask.
			const emptied =
				dragging !== undefined ? draggingEmptiesTrackIndex(dragging, border) : undefined
			const vetoed = emptied !== undefined && (gap === emptied || gap === emptied + 1)
			node.classList.toggle('highlighted', active && !vetoed)
			node.classList.toggle('hovered', false)
		}
	}

	/**
	 * Phase 6 panel affordance (mirrors svelte `Console`
	 * `parkingMaskHover`): while editing + dragging, a pointer over the
	 * console panel background but outside parking rows/gaps (and outside
	 * popups/dialogs) reports the normal `parking-gap` end-gap hover, so
	 * dwell and commit stay core's. Returns `true` when the panel owns the
	 * pointer (the caller skips its own handling).
	 */
	function overPanelBackground(event: PointerEvent): boolean {
		const session = dragSession
		if (!computeEditing() || !session || dragging === undefined) return false
		const target = event.target
		if (!(target instanceof HTMLElement)) return false
		const panel = target.closest('.palette-default-command-panel')
		if (!(panel instanceof HTMLElement)) return false
		// Over parking itself → parking owns the highlight, not the mask.
		if (target.closest('.palette-parking')) return false
		// On a popup/dialog → neither parking nor mask.
		if (target.closest('.palettable-drawer__popup, dialog')) return false
		const live = core.layout.getLayout()
		const gap = live.parking.length
		session.over({ kind: 'parking-gap', parking: live.parking, gap }, pointerSample(event))
		return true
	}

	// Mask + panel listeners (container-level, like svelte `Ide`
	// `onIdePointerMove`): the center owns the mask (work zone / overlay
	// background), the console panel owns the parking end gap. Both gate
	// on editing + live session — hover alone stays dark. The mask is
	// paint-only: it never calls `session.over(null)` (that would clear
	// the session's own paint, e.g. the track-gap fallback the edge-stay
	// spec pins) — it only toggles its own end-gap classes, which the
	// session's next diff leaves alone (different keys).
	center.addEventListener('pointermove', (event) => {
		const session = dragSession
		if (!computeEditing() || !session || dragging === undefined) {
			paintMask(false)
			return
		}
		const target = event.target
		if (!(target instanceof HTMLElement)) {
			paintMask(false)
			return
		}
		// Over a border → the border owns the highlight, not the mask.
		if (target.closest('.toolbar-border')) {
			paintMask(false)
			return
		}
		// The console panel owns its own background (parking end gap via
		// the session) — the mask covers the overlay background + work
		// zone only. The overlay itself carries `role="dialog"`, so only
		// the panel counts as modal, not the overlay background.
		if (target.closest('.palette-default-command-panel, .palettable-drawer__popup, dialog')) {
			paintMask(false)
			return
		}
		paintMask(true)
	})
	center.addEventListener('pointerleave', () => {
		paintMask(false)
	})

	function hasCommandBoxTool(): boolean {
		const layout = core.layout.getLayout()
		for (const region of REGIONS) {
			for (const track of layout.borders[region]) {
				for (const slot of track) {
					if (slot.toolbar.some((item) => (item as { editor?: unknown }).editor === 'commandBox')) {
						return true
					}
				}
			}
		}
		return false
	}

	function computeEditing(): boolean {
		const canEdit = options.isEditable()
		if (!canEdit) return false
		if (hasCommandBoxTool()) return consoleStore.snapshot.open
		return consoleStore.snapshot.open && consoleStore.snapshot.mode === 'edit'
	}

	function actionCan(): Record<string, boolean | undefined> {
		const out: Record<string, boolean | undefined> = {}
		for (const point of core.points) {
			if (!isActionPoint(point)) continue
			try {
				out[point.id] = core.evaluateCan(point.id)
			} catch {
				out[point.id] = true
			}
		}
		return out
	}

	function renderToolbarElement(
		toolbar: Toolbar,
		axis: 'horizontal' | 'vertical',
		region: PaletteRegion,
		editing: boolean,
		containerKind: 'border' | 'parking',
		basePath:
			| {
					readonly container: 'border'
					readonly region: PaletteRegion
					readonly trackIndex: number
					readonly slotIndex: number
			  }
			| { readonly container: 'parking'; readonly toolbarIndex: number },
		dragTarget?: {
			readonly track: Track
			readonly border: import('@palettable/core').Border
		}
	): HTMLElement {
		const bar = el('div', 'toolbar')
		bar.dataset.paletteId = paletteId
		if (editing) bar.dataset.editing = 'true'
		bar.dataset.container = containerKind
		nodes.setToolbar(toolbar, bar)
		// Whole-toolbar grab: mousedown on the bar background (not on a
		// tool/guard) drags all tools together as a slide from the start —
		// mirrors svelte `paletteToolbarDrag`. The guard's own `pointerdown`
		// fires first and sets `dragging`, so a tool grab never double-starts
		// here (`startToolbarDrag` bails when a session is live).
		bar.addEventListener('pointerdown', (event) => {
			if (!(event.target instanceof HTMLElement)) return
			// Inside a nested toolbar → that toolbar owns the gesture.
			if (event.target.closest('.toolbar') !== bar) return
			startToolbarDrag(event, toolbar, region, dragTarget)
		})
		// Bound unconditionally: bars render before the console opens
		// (editing=false), and `syncEditing` flips chrome without a rebuild —
		// so an `if (editing)` gate here would leave pre-edit bars with no
		// paint handlers. The handler itself gates on `dragging` (+ editing
		// inside `paintItemSpaces`), so hover alone stays dark.
		bar.addEventListener('pointermove', (event) => {
			const session = dragSession
			if (!session) return
			const target = event.target
			if (!(target instanceof HTMLElement)) return
			// Single hit-test: one `toHoverable` call classifies tool vs gap.
			const hover = toHoverable(target, bar)
			if (hover === null) {
				// Hovering neither a tool nor a gap (bar background): fall back
				// to the active-item path via the item under the pointer.
				const itemEl = target.closest('[data-item-index]')
				const active =
					itemEl && bar.contains(itemEl)
						? Number((itemEl as HTMLElement).dataset.itemIndex)
						: undefined
				paintItemSpaces(
					bar,
					toolbar,
					Number.isInteger(active) ? active : undefined,
					undefined,
					event
				)
				return
			}
			if (hover.kind !== 'item-gap') {
				if (hover.kind !== 'tool') return
				// Hovering a tool (not a gap): highlight the nearest free
				// gaps flanking it (active-item fallback). A dry side falls
				// back to the flanking track gap (core `trackSpaceHighlight`).
				const active = toolbar.indexOf(hover.item)
				paintItemSpaces(bar, toolbar, active >= 0 ? active : undefined, undefined, event)
				return
			}
			// `session.over()` decides paint + commit in one call: a highlighted
			// gap restructures (the session raises `structure`), a dark gap
			// emits nothing. Paint and structure both arrive via the session
			// subscription — the adapter never reconciles a return value.
			// Parking rows have no `dragTarget` — the core locates the row in
			// the live parking stack itself.
			overItemGap(session, toolbar, hover.gap, event)
		})
		bar.addEventListener('pointerleave', () => {
			// Leaving one bar for another container is NOT a null hover:
			// the next `over()` diffs stale gaps off itself. Emitting
			// null here would wipe outer paint (e.g. stack flanks) when
			// the pointer is still inside the border.
		})
		const appendSpace = (index: number) => {
			const space = el('div', 'toolbar-item-space toolbar-drop-zone')
			space.dataset.paletteId = paletteId
			space.dataset.itemSpaceIndex = String(index)
			bar.append(space)
		}
		appendSpace(0)
		toolbar.forEach((item, itemIndex) => {
			const path: InspectingPath =
				basePath.container === 'border'
					? {
							container: 'border',
							region: basePath.region,
							trackIndex: basePath.trackIndex,
							slotIndex: basePath.slotIndex,
							itemIndex,
						}
					: { container: 'parking', toolbarIndex: basePath.toolbarIndex, itemIndex }
			const wrapper = el('div', 'toolbar-item')
			wrapper.dataset.itemIndex = String(itemIndex)
			nodes.setItem(item, wrapper)
			const tool = (item as { tool?: unknown }).tool
			if (typeof tool === 'string') wrapper.dataset.tool = tool
			const editor = (item as { editor?: unknown }).editor
			if (typeof editor === 'string') wrapper.dataset.editor = editor
			if (samePath(inspecting, path)) wrapper.dataset.inspected = 'true'
			const content = el('div', 'toolbar-item-content')
			if (editing) {
				;(content as HTMLElement & { inert?: boolean }).inert = true
				content.setAttribute('inert', '')
			}
			const surface = surfaceForRegion(region)
			const rendered = renderHeadItem({
				core,
				item,
				surface,
				region,
				onOpenConsole: (mode) => consoleStore.open(mode),
				onInspect: () => setInspecting(path),
				renderToolbar: (childTrack: Track, childAxis, childRegion) =>
					renderDrawerTrack(childTrack, childAxis, childRegion, editing),
			})
			if (rendered) content.append(rendered)
			bindTool(content, item, surface)
			wrapper.append(content)
			if (editing) {
				const guard = el('div', 'toolbar-item-guard')
				guard.dataset.paletteId = paletteId
				guard.setAttribute('aria-hidden', 'true')
				guard.addEventListener('pointerdown', (event) => {
					setInspecting(path)
					startToolDrag(event, toolbar, item)
				})
				wrapper.append(guard)
			}
			bar.append(wrapper)
			appendSpace(itemIndex + 1)
		})
		void axis
		return bar
	}

	/** Render a drawer child track (one track, several toolbars in line). */
	function renderDrawerTrack(
		track: Track,
		axis: 'horizontal' | 'vertical',
		region: PaletteRegion,
		editing: boolean
	): HTMLElement {
		const wrap = el('div', 'toolbar-track')
		const gap = (index: number) => {
			const gapEl = el('div', 'toolbar-track-space toolbar-drop-zone')
			gapEl.dataset.paletteId = paletteId
			gapEl.dataset.trackSpaceIndex = String(index)
			const space = actualTrackSpaceAt(track, index)
			gapEl.style.flexBasis = `${space * 100}%`
			gapEl.style.flexGrow = `${Math.max(space, configuration.trackGapMinGrow)}`
			wrap.append(gapEl)
		}
		gap(0)
		track.forEach((slot, slotIndex) => {
			const slotEl = el('div', 'toolbar-track-slot')
			slotEl.dataset.toolbarSlotIndex = String(slotIndex)
			slotEl.append(
				renderToolbarElement(slot.toolbar, axis, region, editing, 'border', {
					container: 'border',
					region,
					trackIndex: 0,
					slotIndex,
				})
			)
			wrap.append(slotEl)
			gap(slotIndex + 1)
		})
		return wrap
	}

	function renderBorder(host: HTMLElement, region: PaletteRegion, editing: boolean): void {
		dropBindingsIn(host)
		host.textContent = ''
		const direction = directionFor(region)
		const inverse = region === 'right' || region === 'bottom'
		const borderEl = el(
			'div',
			`toolbar-border palette-${direction} ${direction === 'horizontal' ? 'stack-vertical' : 'stack-horizontal'}`
		)
		borderEl.dataset.paletteId = paletteId
		borderEl.dataset.region = region
		const live = core.layout.getLayout()
		const border = live.borders[region]
		// Stack gaps paint via session `highlight` events (the dwell commit
		// fires from the session itself in Phase 3). Hover alone stays dark.
		borderEl.addEventListener('pointerleave', (event) => {
			dragSession?.over(null, pointerSample(event))
		})
		borderEl.addEventListener('pointermove', (event) => {
			const session = dragSession
			if (!session) return
			const target = event.target
			if (!(target instanceof HTMLElement)) return
			// Inside a toolbar → that toolbar owns the perpendicular DZs.
			if (target.closest('.toolbar')) return
			// Hovering a track gap (not a toolbar): the session commits on
			// a highlighted gap and paints the flanking stacks via the
			// containing track — no separate track-background hover exists.
			const trackSpaceEl = target.closest('[data-track-space-index]')
			if (trackSpaceEl && borderEl.contains(trackSpaceEl)) {
				const trackEl = target.closest('[data-track-index]')
				const rawIndex = Number((trackEl as HTMLElement | null)?.dataset.trackIndex)
				const trackIndex = Number.isInteger(rawIndex) ? rawIndex : undefined
				const rawGap = Number((trackSpaceEl as HTMLElement).dataset.trackSpaceIndex)
				const gap = Number.isInteger(rawGap) ? rawGap : undefined
				const track = trackIndex !== undefined ? border[trackIndex] : undefined
				if (track !== undefined && gap !== undefined) {
					slideRearmEvent = event
					session.over({ kind: 'track-gap', track, gap }, pointerSample(event))
					slideRearmEvent = undefined
					return
				}
			}
			const spaceEl = target.closest('[data-stack-index]')
			if (spaceEl && borderEl.contains(spaceEl)) {
				const index = Number((spaceEl as HTMLElement).dataset.stackIndex)
				const gap = Number.isInteger(index) ? index : undefined
				if (gap === undefined) return
				// Direct stack-gap hover: paints now, dwell fires the commit.
				session.over({ kind: 'stack-gap', border, gap }, pointerSample(event))
				return
			}
			if (spaceEl === null && !borderEl.contains(target)) return
			// Phase 6 `outside`: over the border element but on no
			// gap/track/toolbar (its padding / stack-gap halo) — project
			// onto the border's own stack gaps (alongside track *i* →
			// nearer of gaps *i* / *i+1*). Paints + dwells exactly like
			// `stack-gap` (same index space, different hit region).
			const outside = outsideGapAt(borderEl, border, event)
			if (outside !== undefined) {
				session.over({ kind: 'outside', border, gap: outside }, pointerSample(event))
				return
			}
			void event
		})
		const ordered = inverse ? [...border].reverse() : border
		const stackSpace = (index: number) => {
			const space = el('div', 'toolbar-stack-space toolbar-drop-zone')
			space.dataset.paletteId = paletteId
			space.dataset.stackIndex = String(index)
			borderEl.append(space)
		}
		if (!inverse) stackSpace(0)
		ordered.forEach((track, position) => {
			const trackIndex = inverse ? border.length - 1 - position : position
			if (inverse) stackSpace(trackIndex + 1)
			const trackEl = el('div', 'toolbar-track')
			trackEl.dataset.trackIndex = String(trackIndex)
			trackEl.dataset.paletteId = paletteId
			nodes.setTrack(track, trackEl)
			// Track gaps commit on hover via the session: a highlighted gap
			// restructures (extracts the tools into a fresh singleton at
			// that gap), a dark gap emits nothing. Paint arrives via events;
			// a commit still needs the manual re-render until Phase 3b.
			// Mirrors svelte `ToolbarTrack`: inside a toolbar the toolbar
			// owns the DZs (memo kept).
			trackEl.addEventListener('pointermove', (event) => {
				const session = dragSession
				if (!session) return
				const target = event.target
				if (!(target instanceof HTMLElement)) return
				// Inside a toolbar → that toolbar owns the perpendicular DZs.
				// Keep the memo: after a commit the fresh toolbar sits under
				// the pointer, and clearing would re-arm on the next move.
				if (target.closest('.toolbar')) return
				const spaceEl = target.closest('[data-track-space-index]')
				if (!spaceEl || !trackEl.contains(spaceEl)) {
					hoveredTrackSpace = undefined
					// Still inside the border (stack gap / track bg): the
					// border handler's `over()` owns the diff. Null only
					// when the pointer left the border entirely.
					if (!borderEl.contains(target)) session.over(null, pointerSample(event))
					return
				}
				const index = Number((spaceEl as HTMLElement).dataset.trackSpaceIndex)
				const next = Number.isInteger(index) ? index : undefined
				const prev = hoveredTrackSpace
				if (next === undefined) {
					hoveredTrackSpace = next
					return
				}
				// Idempotency memo: same gap = no-op (the fresh toolbar sits
				// under the pointer after a commit — re-committing would
				// build a second toolbar for the same gap).
				if (next === prev) return
				hoveredTrackSpace = next
				slideRearmEvent = event
				session.over({ kind: 'track-gap', track, gap: next }, pointerSample(event))
				slideRearmEvent = undefined
			})
			trackEl.addEventListener('pointerleave', () => {
				hoveredTrackSpace = undefined
				// The border handler fires its own `over()` for moves that
				// stay inside the border; null only when truly outside.
			})
			const trackSpace = (index: number) => {
				const gap = el('div', 'toolbar-track-space toolbar-drop-zone')
				gap.dataset.paletteId = paletteId
				gap.dataset.trackSpaceIndex = String(index)
				const space = actualTrackSpaceAt(track, index)
				gap.style.flexBasis = `${space * 100}%`
				gap.style.flexGrow = `${Math.max(space, configuration.trackGapMinGrow)}`
				trackEl.append(gap)
			}
			trackSpace(0)
			track.forEach((slot, slotIndex) => {
				const slotEl = el('div', 'toolbar-track-slot')
				slotEl.dataset.toolbarSlotIndex = String(slotIndex)
				slotEl.append(
					renderToolbarElement(
						slot.toolbar,
						direction,
						region,
						editing,
						'border',
						{
							container: 'border',
							region,
							trackIndex,
							slotIndex,
						},
						{ track, border }
					)
				)
				trackEl.append(slotEl)
				trackSpace(slotIndex + 1)
			})
			borderEl.append(trackEl)
			if (!inverse) stackSpace(trackIndex + 1)
		})
		if (inverse) stackSpace(0)
		host.append(borderEl)
		clearGapClasses(borderEl)
	}

	function renderParking(host: HTMLElement, editing: boolean): void {
		host.textContent = ''
		const live = core.layout.getLayout()
		const parking = live.parking
		const stack = el('div', 'palette-parking palette-horizontal stack-vertical')
		stack.dataset.paletteId = paletteId
		stack.dataset.container = 'parking'
		// Leaving the stack is a null hover (all lit DZs flip `off`); the
		// session owns the paint, so the adapter never clears classes
		// itself here.
		stack.addEventListener('pointerleave', (event) => {
			dragSession?.over(null, pointerSample(event))
		})
		stack.addEventListener('pointermove', (event) => {
			const session = dragSession
			if (!session) return
			const target = event.target
			if (!(target instanceof HTMLElement)) return
			// Inside a row toolbar → that toolbar owns the item DZs.
			if (target.closest('.toolbar')) return
			const gapEl = target.closest('[data-parking-gap-index]')
			if (!gapEl || !stack.contains(gapEl)) {
				// Over a row (not a gap): no direct hover — the session
				// keeps whatever the row's own handlers painted.
				return
			}
			const index = Number((gapEl as HTMLElement).dataset.parkingGapIndex)
			if (!Number.isInteger(index)) return
			// Direct parking-gap hover: paints now, dwell fires the commit.
			session.over({ kind: 'parking-gap', parking, gap: index }, pointerSample(event))
		})
		const visible = live.parking
			.map((toolbar, index) => ({ toolbar, index }))
			.filter(({ toolbar }) =>
				toolbar.some((item) => (item as { editor?: unknown }).editor !== 'commandBox')
			)
		const gap = (index: number) => {
			const gapEl = el('div', 'toolbar-stack-space toolbar-drop-zone')
			gapEl.dataset.paletteId = paletteId
			gapEl.dataset.parkingGapIndex = String(index)
			stack.append(gapEl)
		}
		gap(0)
		for (const { toolbar, index } of visible) {
			const row = el('div', 'palette-parking-row')
			row.dataset.parkingRowIndex = String(index)
			nodes.setRow(toolbar, row)
			if (editing) {
				const remove = document.createElement('button')
				remove.type = 'button'
				remove.className = 'palette-parking-remove'
				remove.setAttribute('aria-label', 'Delete toolbar')
				remove.title = 'Delete toolbar'
				remove.addEventListener('click', (event) => {
					event.stopPropagation()
					core.layout.moveToolbar({ container: 'parking', toolbarIndex: index }, undefined)
				})
				const icon = el('span', 'palette-parking-remove-icon')
				icon.setAttribute('aria-hidden', 'true')
				icon.textContent = '🗑'
				remove.append(icon)
				row.append(remove)
			}
			row.append(
				renderToolbarElement(toolbar, 'horizontal', 'top', editing, 'parking', {
					container: 'parking',
					toolbarIndex: index,
				})
			)
			stack.append(row)
			gap(index + 1)
		}
		host.append(stack)
		clearGapClasses(stack)
	}

	function closeConsole(): void {
		consoleStore.close()
		setInspecting(undefined)
		consoleQuery = ''
	}

	/**
	 * Editing chrome as a dedicated pass over existing nodes (no rebuild):
	 * flips `editing`/`palette-editing` classes + `data-editing` on the
	 * root, toggles `inert` on every `.toolbar-item-content`, and
	 * adds/removes `.toolbar-item-guard` nodes + parking `×` buttons.
	 * Called from `syncEditing()` when `computeEditing()` flips; structural
	 * renders (`renderBorder`/`renderParking`) still stamp the same chrome
	 * at creation time so first paint matches.
	 */
	function applyEditing(editing: boolean): void {
		container.classList.toggle('editing', editing)
		container.classList.toggle('palette-editing', editing)
		if (editing) container.dataset.editing = 'true'
		else delete container.dataset.editing
		for (const content of container.querySelectorAll('.toolbar-item-content')) {
			if (!(content instanceof HTMLElement)) continue
			if (editing) {
				;(content as HTMLElement & { inert?: boolean }).inert = true
				content.setAttribute('inert', '')
			} else {
				;(content as HTMLElement & { inert?: boolean }).inert = false
				content.removeAttribute('inert')
			}
		}
		for (const wrapper of container.querySelectorAll('.toolbar-item')) {
			if (!(wrapper instanceof HTMLElement)) continue
			const guard = wrapper.querySelector(':scope > .toolbar-item-guard')
			if (editing && !guard) {
				const node = el('div', 'toolbar-item-guard')
				node.dataset.paletteId = paletteId
				node.setAttribute('aria-hidden', 'true')
				const path = inspectingPathOf(wrapper)
				node.addEventListener('pointerdown', (event) => {
					if (path) {
						setInspecting(path)
						const live = core.layout.getLayout()
						const item =
							path.container === 'parking'
								? live.parking[path.toolbarIndex]?.[path.itemIndex]
								: live.borders[path.region][path.trackIndex]?.[path.slotIndex]?.toolbar[
										path.itemIndex
									]
						if (item) {
							const toolbar = findToolbarOf(live, item)
							if (toolbar) startToolDrag(event, toolbar, item)
						}
					}
				})
				wrapper.append(node)
			} else if (!editing && guard) {
				guard.remove()
			}
		}
		for (const row of container.querySelectorAll('.palette-parking-row')) {
			if (!(row instanceof HTMLElement)) continue
			const remove = row.querySelector(':scope > .palette-parking-remove')
			if (editing && !remove) {
				const button = document.createElement('button')
				button.type = 'button'
				button.className = 'palette-parking-remove'
				button.setAttribute('aria-label', 'Delete toolbar')
				button.title = 'Delete toolbar'
				button.addEventListener('click', (event) => {
					event.stopPropagation()
					const index = Number(row.dataset.parkingRowIndex ?? '-1')
					if (index >= 0) {
						core.layout.moveToolbar({ container: 'parking', toolbarIndex: index }, undefined)
					}
				})
				const icon = el('span', 'palette-parking-remove-icon')
				icon.setAttribute('aria-hidden', 'true')
				icon.textContent = '🗑'
				button.append(icon)
				row.prepend(button)
			} else if (!editing && remove) {
				remove.remove()
			}
		}
	}

	/**
	 * Inspecting as a two-node flip (no rebuild): clear `data-inspected`
	 * on the old wrapper, set it on the new one, then refresh the console
	 * details panel (which reads `inspecting` at render time).
	 */
	function setInspecting(next: InspectingPath | undefined): void {
		if (next !== undefined && inspecting !== undefined && samePath(inspecting, next)) return
		const oldNode = inspecting !== undefined ? inspectingNodeOf(inspecting) : undefined
		if (oldNode) delete oldNode.dataset.inspected
		inspecting = next
		if (next !== undefined) {
			const node = inspectingNodeOf(next)
			if (node) node.dataset.inspected = 'true'
		}
		renderConsoleDetails()
	}

	/** Resolve the live `.toolbar-item` wrapper for an inspecting path. */
	function inspectingNodeOf(path: InspectingPath): HTMLElement | undefined {
		const live = core.layout.getLayout()
		const item =
			path.container === 'parking'
				? live.parking[path.toolbarIndex]?.[path.itemIndex]
				: live.borders[path.region][path.trackIndex]?.[path.slotIndex]?.toolbar[path.itemIndex]
		if (!item) return undefined
		const node = nodes.get(item)
		return node instanceof HTMLElement ? node : undefined
	}

	/** Rebuild an inspecting path from a rendered wrapper's datasets. */
	function inspectingPathOf(wrapper: HTMLElement): InspectingPath | undefined {
		const bar = wrapper.closest('.toolbar')
		if (!(bar instanceof HTMLElement)) return undefined
		const itemIndex = Number(wrapper.dataset.itemIndex ?? '-1')
		if (bar.dataset.container === 'parking') {
			const row = wrapper.closest('.palette-parking-row')
			const toolbarIndex = Number(
				row instanceof HTMLElement ? (row.dataset.parkingRowIndex ?? '-1') : '-1'
			)
			if (toolbarIndex < 0 || itemIndex < 0) return undefined
			return { container: 'parking', toolbarIndex, itemIndex }
		}
		const trackEl = wrapper.closest('.toolbar-track')
		const borderEl = wrapper.closest('.toolbar-border')
		const region =
			borderEl instanceof HTMLElement
				? (borderEl.dataset.region as PaletteRegion | undefined)
				: undefined
		const trackIndex = Number(
			trackEl instanceof HTMLElement ? (trackEl.dataset.trackIndex ?? '-1') : '-1'
		)
		const slotEl = wrapper.closest('.toolbar-track-slot')
		const slotIndex = Number(
			slotEl instanceof HTMLElement ? (slotEl.dataset.toolbarSlotIndex ?? '-1') : '-1'
		)
		if (region === undefined || trackIndex < 0 || slotIndex < 0 || itemIndex < 0) {
			return undefined
		}
		return { container: 'border', region, trackIndex, slotIndex, itemIndex }
	}

	/**
	 * Reconcile the editing flag without rebuilding: when `computeEditing()`
	 * flips, run the chrome pass + console; otherwise leave the DOM alone.
	 * Structural renders call this after rebuilding so `lastEditing` tracks.
	 *
	 * An editing flip false mid-gesture ends the session (spec: the adapter
	 * only creates a session while editing) — the session emits its
	 * `highlight off` clears synchronously before it is dropped.
	 */
	function syncEditing(): void {
		if (disposed) return
		const editing = computeEditing()
		if (editing === lastEditing) return
		lastEditing = editing
		if (!editing) {
			if (dragSession !== undefined) endToolDrag()
			if (inspecting !== undefined) {
				const oldNode = inspectingNodeOf(inspecting)
				if (oldNode) delete oldNode.dataset.inspected
				inspecting = undefined
			}
			for (const host of [topHost, leftHost, rightHost, bottomHost, consoleHost]) {
				clearGapClasses(host)
			}
		}
		applyEditing(editing)
		renderConsole()
	}

	function renderConsole(): void {
		dropBindingsIn(consoleHost)
		consoleHost.textContent = ''
		const workZone = center.querySelector('[data-testid="work-zone"]')
		const snapshot = consoleStore.snapshot
		if (!snapshot.open) {
			workZone?.classList.remove('is-dimmed')
			return
		}
		workZone?.classList.add('is-dimmed')
		const canEdit = options.isEditable()
		const editOnly = hasCommandBoxTool()
		const isEditing = canEdit && (editOnly || snapshot.mode === 'edit')

		const overlay = el('div', 'palette-default-command-overlay')
		overlay.dataset.testid = 'console-overlay'
		overlay.setAttribute('role', 'dialog')
		overlay.setAttribute('aria-label', 'Palette console')
		overlay.tabIndex = -1
		overlay.addEventListener('mousedown', (event) => {
			if (event.target === event.currentTarget) closeConsole()
		})
		const panel = el('div', 'palette-default-command-panel')
		panel.setAttribute('role', 'presentation')
		// Phase 6 panel affordance: pointer over the panel background
		// (outside parking rows/gaps/popups) keeps the parking end gap lit
		// via the normal `parking-gap` hover — dwell + commit stay core's.
		panel.addEventListener('pointermove', (event) => {
			overPanelBackground(event)
		})
		panel.addEventListener('pointerleave', (event) => {
			dragSession?.over(null, pointerSample(event))
		})
		overlay.append(panel)
		const close = document.createElement('button')
		close.type = 'button'
		close.className = 'palette-default-command-close'
		close.setAttribute('aria-label', 'Close console')
		close.textContent = '×'
		close.addEventListener('click', closeConsole)
		panel.append(close)

		const top = el('div', 'palette-default-command-top')
		panel.append(top)
		const parkingHost = document.createElement('div')
		top.append(parkingHost)
		renderParking(parkingHost, isEditing)
		const parkingEl = parkingHost.firstElementChild
		if (parkingEl instanceof HTMLElement) {
			parkingEl.classList.add('palette-default-command-parking')
			top.replaceChildren(parkingEl)
		}

		const bottom = el('div', 'palette-default-command-bottom')
		panel.append(bottom)
		const main = el('div', 'palette-default-command-main')
		bottom.append(main)
		const box = el('div', 'palette-default-command-box is-expanded')
		main.append(box)

		const shell = el('div', 'palette-default-command-shell')
		shell.title = 'Console command box'
		box.append(shell)
		const shellIcon = iconSpan('⌘')
		if (shellIcon) shell.append(shellIcon)
		const tokens = el('div', 'palette-default-command-tokens')
		shell.append(tokens)
		const input = document.createElement('input')
		input.className = 'palette-default-command-input'
		input.dataset.testid = 'console-input'
		input.placeholder = isEditing ? 'Add to toolbar…' : 'Command…'
		input.value = consoleQuery
		tokens.append(input)
		if (canEdit && !editOnly) {
			const toggle = document.createElement('button')
			toggle.type = 'button'
			toggle.className = 'palette-default-command-mode'
			toggle.dataset.testid = 'console-mode-toggle'
			toggle.setAttribute('aria-pressed', isEditing ? 'true' : 'false')
			toggle.setAttribute('aria-label', isEditing ? 'Done editing' : 'Edit toolbars')
			toggle.title = isEditing ? 'Done editing' : 'Edit toolbars'
			toggle.textContent = isEditing ? '✓' : '✎'
			toggle.addEventListener('click', () => {
				consoleQuery = ''
				consoleStore.open(isEditing ? 'run' : 'edit')
			})
			tokens.append(toggle)
		}
		const popover = el('div', 'palette-default-command-popover')
		box.append(popover)
		const results = el('div', 'palette-default-command-results')
		results.dataset.testid = 'console-results'
		popover.append(results)

		const refreshResults = () => {
			consoleQuery = input.value
			results.textContent = ''
			if (isEditing) {
				const sources = paletteAddItemEntries(
					core.points,
					{ itemEditors },
					{ excludeTools: ['console'] }
				)
				const filtered = filterAddSources(sources, consoleQuery)
				if (filtered.length === 0) {
					const empty = el('div', 'palette-default-command-empty')
					empty.textContent = 'No matching commands'
					results.append(empty)
					return
				}
				for (const source of filtered.slice(0, 8)) {
					const row = document.createElement('button')
					row.type = 'button'
					row.className = 'palette-default-command-result'
					row.addEventListener('mousedown', (event) => event.preventDefault())
					row.addEventListener('click', () => {
						consoleStore.patch({ selectedEntryId: source.id, selectedVariantId: undefined })
					})
					const copy = el('span', 'palette-default-command-result-copy')
					const label = el('span', 'palette-default-command-result-label')
					if (typeof source.icon === 'string') {
						const entryIcon = iconSpan(source.icon)
						if (entryIcon) label.append(entryIcon)
					}
					label.append(document.createTextNode(source.label))
					const meta = el('span', 'palette-default-command-result-meta')
					meta.textContent = source.meta
					copy.append(label, meta)
					row.append(copy)
					results.append(row)
				}
				return
			}
			const all = paletteCommandEntries(
				core.points,
				{ keys: core.keys, values: core.values.asObject(), actionCan: actionCan() },
				{ excludeTools: ['console'] }
			)
			const entries = filterCommandEntries(all, { free: consoleQuery })
			if (entries.length === 0) {
				const empty = el('div', 'palette-default-command-empty')
				empty.textContent = 'No matching commands'
				results.append(empty)
				return
			}
			for (const entry of entries.slice(0, 8)) {
				const row = document.createElement('button')
				row.type = 'button'
				row.className = 'palette-default-command-result'
				row.disabled = entry.can === false
				row.addEventListener('mousedown', (event) => event.preventDefault())
				row.addEventListener('click', () => {
					core.run(entry.run)
					closeConsole()
				})
				const copy = el('span', 'palette-default-command-result-copy')
				const label = el('span', 'palette-default-command-result-label')
				if (typeof entry.icon === 'string') {
					const entryIcon = iconSpan(entry.icon)
					if (entryIcon) label.append(entryIcon)
				}
				label.append(document.createTextNode(entry.label))
				const meta = el('span', 'palette-default-command-result-meta')
				meta.textContent = entry.meta
				copy.append(label, meta)
				row.append(copy)
				results.append(row)
			}
		}
		input.addEventListener('input', refreshResults)
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault()
				if (isEditing) {
					const sources = paletteAddItemEntries(
						core.points,
						{ itemEditors },
						{ excludeTools: ['console'] }
					)
					const first = filterAddSources(sources, input.value)[0]
					if (first) consoleStore.patch({ selectedEntryId: first.id, selectedVariantId: undefined })
				} else {
					const all = paletteCommandEntries(
						core.points,
						{ keys: core.keys, values: core.values.asObject(), actionCan: actionCan() },
						{ excludeTools: ['console'] }
					)
					const first = filterCommandEntries(all, { free: input.value })[0]
					if (first) {
						core.run(first.run)
						closeConsole()
					}
				}
			}
			if (event.key === 'Escape') closeConsole()
		})
		refreshResults()
		queueMicrotask(() => input.focus())

		renderConsoleDetailsInto(bottom)
		consoleHost.append(overlay)
	}

	/**
	 * Console details panel only (edit mode): Inspect configurator for the
	 * `inspecting` item, else the add-panel for the selected entry, else
	 * the empty hint. Re-renders just the details panel — never the
	 * borders — so `setInspecting` and add-flow selection stay cheap.
	 * No-op when the console is closed or not editing.
	 */
	function renderConsoleDetails(): void {
		const overlay = consoleHost.querySelector('.palette-default-command-overlay')
		const bottom = overlay?.querySelector('.palette-default-command-bottom')
		if (!(overlay instanceof HTMLElement) || !(bottom instanceof HTMLElement)) return
		const old = bottom.querySelector('.palette-default-details-panel')
		old?.remove()
		renderConsoleDetailsInto(bottom)
	}

	function renderConsoleDetailsInto(bottom: HTMLElement): void {
		const snapshot = consoleStore.snapshot
		const canEdit = options.isEditable()
		const editOnly = hasCommandBoxTool()
		const isEditing = canEdit && (editOnly || snapshot.mode === 'edit')
		if (!isEditing) return
		const details = el('div', 'palette-default-panel palette-default-details-panel')
		details.dataset.testid = 'console-details-panel'
		bottom.append(details)
		const inspectingItem = inspecting !== undefined ? itemAtPath(inspecting) : undefined
		if (inspectingItem) {
			const title = el('div', 'palette-default-panel-title')
			title.textContent = 'Inspect'
			details.append(title)
			details.append(renderConfigurator(inspectingItem.item, inspecting!))
		} else {
			const selected = snapshot.selectedEntryId
				? paletteAddItemEntries(core.points, { itemEditors }, { excludeTools: ['console'] }).find(
						(entry) => entry.id === snapshot.selectedEntryId
					)
				: undefined
			if (selected) {
				const title = el('div', 'palette-default-panel-title')
				title.textContent = 'Add to toolbar'
				details.append(title)
				details.append(renderAddPanel(selected))
			} else {
				const title = el('div', 'palette-default-panel-title')
				title.textContent = 'Details'
				details.append(title)
				const empty = el('div', 'palette-default-config-empty')
				empty.textContent =
					'Click a toolbar item to inspect its presentation, or select a tool or editor on the left to add it to a toolbar.'
				details.append(empty)
			}
		}
	}

	function itemAtPath(
		path: InspectingPath
	): { item: import('@palettable/core').ToolbarItem; point: AnyPoint | undefined } | undefined {
		const live = core.layout.getLayout()
		if (path.container === 'parking') {
			const toolbar = live.parking[path.toolbarIndex]
			const item = toolbar?.[path.itemIndex]
			if (!item) return undefined
			return { item, point: pointFor(item) }
		}
		const item =
			live.borders[path.region][path.trackIndex]?.[path.slotIndex]?.toolbar[path.itemIndex]
		if (!item) return undefined
		return { item, point: pointFor(item) }
	}

	function pointFor(item: import('@palettable/core').ToolbarItem): AnyPoint | undefined {
		const tool = (item as { tool?: unknown }).tool
		if (typeof tool !== 'string') return undefined
		const cut = tool.search(/[=|:]/)
		const id = cut < 0 ? tool : tool.slice(0, cut)
		return core.getDefinition(id)
	}

	/**
	 * Tool-owned config edit: mutate the live item in place (tool + editor
	 * created together — no core call), then re-render the borders so the
	 * tool rebuilds with its new presentation. Editor-type swaps rebuild
	 * the whole tool element with initial values (see renderToolbarElement).
	 */
	function patchLive(
		path: InspectingPath,
		patch: (item: import('@palettable/core').ToolbarItem) => void
	): void {
		const found = itemAtPath(path)
		if (!found) return
		patch(found.item)
		syncStructure()
	}

	function renderConfigurator(
		item: import('@palettable/core').ToolbarItem,
		path: InspectingPath
	): HTMLElement {
		const table = el('div', 'palette-default-config-table')
		const point = pointFor(item)
		const config = ((item as { config?: Record<string, unknown> }).config ?? {}) as Record<
			string,
			unknown
		>
		const surface = surfaceForRegion(
			path.container === 'border' ? path.region : ('top' as PaletteRegion)
		)
		const currentEditor =
			(item as { editor?: string }).editor ?? defaultEditorFor(point) ?? 'button'
		const choices = editorChoicesFor(
			point,
			{ axis: surface.axis === 'both' ? 'horizontal' : surface.axis, region: surface.region },
			VANILLA_EDITOR_REGISTRY,
			VANILLA_EDITOR_DEFAULTS,
			(item as { editor?: string }).editor
		)
		const row = (key: string, input: HTMLElement) => {
			const line = el('div', 'palette-default-config-row')
			const keyEl = el('div', 'palette-default-config-key')
			const strong = document.createElement('strong')
			strong.textContent = key
			keyEl.append(strong)
			const valueEl = el('div', 'palette-default-config-value')
			valueEl.append(input)
			line.append(keyEl, valueEl)
			table.append(line)
		}
		const textInput = (value: string, onChange: (next: string) => void) => {
			const field = document.createElement('input')
			field.value = value
			field.addEventListener('input', () => onChange(field.value))
			return field
		}
		const labelValue =
			typeof config.label === 'string'
				? config.label
				: typeof (item as { tool?: unknown }).tool === 'string'
					? ((item as { tool?: unknown }).tool as string)
					: (currentEditor ?? 'Item')
		row(
			'Label',
			textInput(labelValue, (next) =>
				patchLive(path, (target) => {
					const record = target as { config?: Record<string, unknown> }
					record.config = { ...(record.config ?? {}), label: next }
				})
			)
		)
		row(
			'Icon',
			textInput(typeof config.icon === 'string' ? config.icon : '', (next) =>
				patchLive(path, (target) => {
					const record = target as { config?: Record<string, unknown> }
					record.config = { ...(record.config ?? {}), icon: next }
				})
			)
		)
		row(
			'Hint',
			textInput(typeof config.hint === 'string' ? config.hint : '', (next) =>
				patchLive(path, (target) => {
					const record = target as { config?: Record<string, unknown> }
					record.config = { ...(record.config ?? {}), hint: next }
				})
			)
		)
		const editorSelect = document.createElement('select')
		const seen = new Set<string>()
		for (const choice of choices) {
			if (seen.has(choice.id)) continue
			seen.add(choice.id)
			const option = document.createElement('option')
			option.value = choice.id
			option.textContent = choice.label
			editorSelect.append(option)
		}
		if (!seen.has(currentEditor)) {
			const option = document.createElement('option')
			option.value = currentEditor
			option.textContent = currentEditor
			editorSelect.append(option)
		}
		editorSelect.value = currentEditor
		editorSelect.addEventListener('change', () => {
			const next = editorSelect.value
			patchLive(path, (target) => {
				const record = target as {
					editor?: string
					config?: Record<string, unknown>
				}
				record.editor = next
				const cleanup = configuratorEditorCleanup(next)
				if (record.config) {
					for (const key of cleanup) delete record.config[key]
				}
			})
		})
		row('Editor', editorSelect)
		const toneSelect = document.createElement('select')
		for (const tone of ['neutral', 'accent']) {
			const option = document.createElement('option')
			option.value = tone
			option.textContent = tone === 'neutral' ? 'Neutral' : 'Accent'
			toneSelect.append(option)
		}
		toneSelect.value = config.tone === 'accent' ? 'accent' : 'neutral'
		toneSelect.addEventListener('change', () => {
			patchLive(path, (target) => {
				const record = target as { config?: Record<string, unknown> }
				record.config = {
					...(record.config ?? {}),
					tone: toneSelect.value === 'accent' ? 'accent' : 'neutral',
				}
			})
		})
		row('Tone', toneSelect)
		const deleteLine = el('div', 'palette-default-config-row')
		const deleteKey = el('div', 'palette-default-config-key')
		const deleteStrong = document.createElement('strong')
		deleteStrong.textContent = 'Delete'
		deleteKey.append(deleteStrong)
		const deleteValue = el('div', 'palette-default-config-value')
		const deleteButton = document.createElement('button')
		deleteButton.type = 'button'
		deleteButton.className = 'palette-default-config-delete'
		deleteButton.dataset.testid = 'configurator-delete'
		deleteButton.textContent = 'Delete editor'
		deleteButton.addEventListener('click', () => {
			const from =
				path.container === 'parking'
					? {
							container: 'parking' as const,
							toolbarIndex: path.toolbarIndex,
							itemIndex: path.itemIndex,
						}
					: {
							container: 'border' as const,
							region: path.region,
							trackIndex: path.trackIndex,
							toolbarIndex: path.slotIndex,
							itemIndex: path.itemIndex,
						}
			core.layout.moveItem(from, undefined)
			inspecting = undefined
		})
		deleteValue.append(deleteButton)
		deleteLine.append(deleteKey, deleteValue)
		table.append(deleteLine)
		return table
	}

	function renderAddPanel(source: AddItemSource): HTMLElement {
		const stack = el('div', 'palette-default-config-stack')
		stack.dataset.testid = 'console-add-panel'
		const header = el('div', 'palette-default-config-header')
		const strong = document.createElement('strong')
		strong.textContent = source.label
		const meta = el('span', '')
		meta.textContent = source.meta
		header.append(strong, meta)
		stack.append(header)
		const variants = paletteDerivedVariants(source, core.points)
		const selectedVariant = consoleStore.snapshot.selectedVariantId
		for (const variant of variants) {
			const wrap = el(
				'div',
				`palette-default-add-variant${variant.kind === 'set' ? ' is-set' : ''}`
			)
			const trigger = document.createElement('button')
			trigger.type = 'button'
			trigger.className = `palette-default-config-header palette-default-add-variant-trigger${selectedVariant === variant.id ? ' is-selected' : ''}`
			trigger.setAttribute('aria-pressed', selectedVariant === variant.id ? 'true' : 'false')
			const triggerStrong = document.createElement('strong')
			if (typeof variant.icon === 'string') {
				const variantIcon = iconSpan(variant.icon)
				if (variantIcon) triggerStrong.append(variantIcon)
			}
			triggerStrong.append(document.createTextNode(variant.label))
			const triggerMeta = el('span', '')
			triggerMeta.textContent = variant.meta
			trigger.append(triggerStrong, triggerMeta)
			trigger.addEventListener('click', () => {
				consoleStore.patch({ selectedVariantId: variant.id })
			})
			// Phase 6 catalog source: pointerdown on a variant starts a
			// creation drag (same item factory as the discrete flow, so
			// drag and click insert the same shape). No session → no drag
			// (unbuildable selection); the click above still selects.
			trigger.addEventListener('pointerdown', (event) => {
				const item = itemFromAddSelection(
					{
						source,
						variant,
						booleanValue: consoleStore.snapshot.booleanValue,
						setValue: consoleStore.snapshot.setValue,
					},
					core.points
				)
				if (item === undefined) return
				startCatalogDrag(event, item)
			})
			wrap.append(trigger)
			if (variant.kind === 'set' && selectedVariant === variant.id) {
				const inline = el('div', 'palette-default-add-inline-value')
				const inlineStrong = document.createElement('strong')
				inlineStrong.textContent = 'Value'
				inline.append(inlineStrong)
				if (variant.valueType === 'boolean') {
					const select = document.createElement('select')
					for (const value of ['true', 'false']) {
						const option = document.createElement('option')
						option.value = value
						option.textContent = value
						select.append(option)
					}
					select.value = consoleStore.snapshot.booleanValue
					select.addEventListener('change', () => {
						consoleStore.patch({ booleanValue: select.value })
					})
					inline.append(select)
				} else if (variant.valueType === 'number') {
					const field = document.createElement('input')
					field.value = consoleStore.snapshot.setValue
					field.placeholder = '14'
					field.addEventListener('input', () => {
						consoleStore.patch({ setValue: field.value })
					})
					inline.append(field)
				} else if (variant.valueType === 'enum') {
					const select = document.createElement('select')
					const placeholder = document.createElement('option')
					placeholder.value = ''
					placeholder.textContent = 'Choose value…'
					select.append(placeholder)
					for (const value of variant.values ?? []) {
						const option = document.createElement('option')
						option.value = value.value
						option.textContent = value.label ?? value.value
						select.append(option)
					}
					select.value = consoleStore.snapshot.setValue
					select.addEventListener('change', () => {
						consoleStore.patch({ setValue: select.value })
					})
					inline.append(select)
				}
				wrap.append(inline)
			}
			stack.append(wrap)
		}
		return stack
	}

	/**
	 * Structural sync: re-render borders + console from the live layout.
	 * Called only for structural changes (layout ops, whole loads) —
	 * never for value changes (Phase E subscribes per-tool instead) and
	 * never for editing toggles (`syncEditing` runs the chrome pass).
	 */
	function syncStructure(): void {
		if (disposed) return
		const editing = computeEditing()
		lastEditing = editing
		container.classList.toggle('editing', editing)
		container.classList.toggle('palette-editing', editing)
		if (editing) container.dataset.editing = 'true'
		else delete container.dataset.editing
		if (!editing && inspecting !== undefined) inspecting = undefined
		renderBorder(topHost, 'top', editing)
		renderBorder(leftHost, 'left', editing)
		renderBorder(rightHost, 'right', editing)
		renderBorder(bottomHost, 'bottom', editing)
		renderConsole()
	}

	/** Re-render a single border host from the live layout. */
	function syncBorder(region: PaletteRegion): void {
		if (disposed) return
		const editing = computeEditing()
		const host =
			region === 'top'
				? topHost
				: region === 'left'
					? leftHost
					: region === 'right'
						? rightHost
						: bottomHost
		renderBorder(host, region, editing)
	}

	/**
	 * Re-render one track inside its border element, in place. The track's
	 * live object is resolved by `===` against the current layout (never by
	 * the op's stale index — a prune earlier in the same op may have shifted
	 * indices). Unchanged sibling tracks, stack gaps, and the border's own
	 * listeners keep DOM identity; only the named track's children are
	 * rebuilt. Paint on the rebuilt track is fresh (no classes) — the
	 * session re-emits `highlight` for whatever is still hovered right
	 * after the `structure` event, in the same `over()` pass.
	 */
	function syncTrack(
		borderEl: HTMLElement,
		region: PaletteRegion,
		trackIndex: number,
		editing: boolean
	): void {
		const live = core.layout.getLayout()
		const border = live.borders[region]
		const track = border[trackIndex]
		if (track === undefined) return
		const direction = directionFor(region)
		const trackEl = borderEl.querySelector(
			`:scope > .toolbar-track[data-track-index="${trackIndex}"]`
		)
		if (!(trackEl instanceof HTMLElement)) {
			// Track node missing (new track the full render would create):
			// fall back to the per-border path for this region only.
			syncBorder(region)
			return
		}
		dropBindingsIn(trackEl)
		trackEl.textContent = ''
		nodes.setTrack(track, trackEl)
		const trackSpace = (index: number) => {
			const gap = el('div', 'toolbar-track-space toolbar-drop-zone')
			gap.dataset.paletteId = paletteId
			gap.dataset.trackSpaceIndex = String(index)
			const space = actualTrackSpaceAt(track, index)
			gap.style.flexBasis = `${space * 100}%`
			gap.style.flexGrow = `${Math.max(space, configuration.trackGapMinGrow)}`
			trackEl.append(gap)
		}
		trackSpace(0)
		track.forEach((slot, slotIndex) => {
			const slotEl = el('div', 'toolbar-track-slot')
			slotEl.dataset.toolbarSlotIndex = String(slotIndex)
			slotEl.append(
				renderToolbarElement(
					slot.toolbar,
					direction,
					region,
					editing,
					'border',
					{ container: 'border', region, trackIndex, slotIndex },
					{ track, border }
				)
			)
			trackEl.append(slotEl)
			trackSpace(slotIndex + 1)
		})
		clearGapClasses(trackEl)
	}

	/**
	 * Surgical `move-toolbar` apply for the drag path. Collects the
	 * affected `(region, trackIndex)` pairs from `from`/`to`/`pruned` and
	 * re-renders exactly those tracks; a region whose track list itself
	 * changed (track created or removed — the new index is absent from the
	 * DOM, or a DOM track has no live counterpart) falls back to
	 * `syncBorder` for that region only. Parking still takes the console
	 * pass. Re-arms slide-follow afterwards, like the coarse path.
	 */
	function applyMoveToolbarDuringDrag(op: Extract<LayoutOp, { kind: 'move-toolbar' }>): void {
		const touchesParking =
			op.from?.container === 'parking' ||
			op.to?.container === 'parking' ||
			op.pruned.some((victim) => victim.from.container === 'parking')
		if (touchesParking) {
			syncStructure()
			return
		}
		const editing = computeEditing()
		const tracks = new Map<PaletteRegion, Set<number>>()
		const addTrack = (region: PaletteRegion, trackIndex: number) => {
			let set = tracks.get(region)
			if (set === undefined) {
				set = new Set<number>()
				tracks.set(region, set)
			}
			set.add(trackIndex)
		}
		if (op.from?.container === 'border') addTrack(op.from.region, op.from.trackIndex)
		if (op.to?.container === 'border') addTrack(op.to.region, op.to.trackIndex)
		for (const victim of op.pruned) {
			if (victim.from.container === 'border') addTrack(victim.from.region, victim.from.trackIndex)
		}
		for (const [region, indices] of tracks) {
			const host =
				region === 'top'
					? topHost
					: region === 'left'
						? leftHost
						: region === 'right'
							? rightHost
							: bottomHost
			const borderEl = host.querySelector('.toolbar-border')
			if (!(borderEl instanceof HTMLElement)) {
				syncBorder(region)
				continue
			}
			const live = core.layout.getLayout()
			const border = live.borders[region]
			const domTracks = new Set<number>()
			for (const node of borderEl.querySelectorAll(':scope > .toolbar-track')) {
				if (!(node instanceof HTMLElement)) continue
				const raw = Number(node.dataset.trackIndex)
				if (Number.isInteger(raw)) domTracks.add(raw)
			}
			const liveIndices = new Set(border.map((_, index) => index))
			// Track-list shape changed (create/prune): indices shifted, so a
			// per-track patch would place toolbars wrong — one border sync.
			let shapeChanged = domTracks.size !== liveIndices.size
			if (!shapeChanged) {
				for (const index of liveIndices) {
					if (!domTracks.has(index)) {
						shapeChanged = true
						break
					}
				}
			}
			if (shapeChanged) {
				syncBorder(region)
				continue
			}
			for (const trackIndex of indices) syncTrack(borderEl, region, trackIndex, editing)
		}
		if (dragSession) rearmSlideAfterStructure()
	}

	/**
	 * Layout-op interceptor: route structural mutations to the affected
	 * border(s) only, so untouched borders keep DOM identity. `replace`
	 * (whole-load) clears the registry and rebuilds everything.
	 *
	 * During a drag (`dragSession` live) a `move-toolbar` op is applied
	 * surgically: the op's `toolbar`/`from`/`to`/`pruned` describe exactly
	 * what changed, so only the affected track(s) re-render — the rest of
	 * the border (and every other border) keeps DOM identity, paint, and
	 * slide transforms. Outside a drag the same op takes the coarse
	 * per-border path (console add/delete flows).
	 */
	function applyOp(op: LayoutOp): void {
		if (disposed) return
		switch (op.kind) {
			case 'replace':
				nodes.clear()
				syncStructure()
				return
			case 'move-item': {
				const regions = new Set<PaletteRegion>()
				if (op.from.container === 'border') regions.add(op.from.region)
				if (op.to.container === 'border') regions.add(op.to.region)
				for (const region of regions) syncBorder(region)
				return
			}
			case 'remove-item': {
				if (op.at.container === 'border') syncBorder(op.at.region)
				else syncStructure()
				return
			}
			case 'insert-item': {
				if (op.at.container === 'border') syncBorder(op.at.region)
				else syncStructure()
				return
			}
			case 'move-toolbar': {
				// During a drag, apply surgically at track granularity: only
				// the tracks named by `from`/`to`/`pruned` re-render. A
				// same-region move re-renders one region's two tracks; a
				// cross-region move re-renders one track per region; parking
				// still needs the console pass (parking renders inside it).
				if (dragSession !== undefined) {
					applyMoveToolbarDuringDrag(op)
					return
				}
				const regions = new Set<PaletteRegion>()
				if (op.from?.container === 'border') regions.add(op.from.region)
				if (op.to?.container === 'border') regions.add(op.to.region)
				// Prune cascade victims (the emptied track) live in a region
				// too — they must re-render even when `from`/`to` did not.
				for (const victim of op.pruned) {
					if (victim.from.container === 'border') regions.add(victim.from.region)
				}
				// Parking renders inside the console overlay, so any parking-side
				// involvement needs the console pass (which re-renders borders too).
				const touchesParking =
					op.from?.container === 'parking' ||
					op.to?.container === 'parking' ||
					op.pruned.some((victim) => victim.from.container === 'parking')
				if (touchesParking) {
					syncStructure()
					return
				}
				for (const region of regions) syncBorder(region)
				// Re-measure slide geometry after structure change so the
				// follow loop stays accurate against the fresh DOM.
				if (dragSession) rearmSlideAfterStructure()
				return
			}
		}
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return
		if (isEditableTarget(event.target)) return
		if (event.key === 'Escape') {
			if (consoleStore.snapshot.open) {
				event.preventDefault()
				closeConsole()
			}
			return
		}
		if (computeEditing()) return
		const spec = keys.resolve(event)
		if (!spec) return
		event.preventDefault()
		event.stopPropagation()
		try {
			const parsed = parsePointSpec(spec)
			const def = core.getDefinition(parsed.pointId)
			if (
				parsed.kind === 'point' &&
				def !== undefined &&
				isValuedPoint(def) &&
				def.type === 'boolean'
			) {
				const current = core.values.get(def.id) as boolean | undefined
				core.values.set(def.id as never, !current as never)
				return
			}
			core.run(spec)
		} catch {
			// Unresolvable bindings never break typing.
		}
	}

	container.addEventListener('keydown', onKeyDown)
	// Structural changes arrive as layout ops (per-border sync). Value
	// changes are handled per-tool in Phase E — never a global refresh.
	// Context identity changes (set/removeContext emit `[]`) re-render the
	// affected borders: per-tool bindings only cover key changes.
	// Console notifications reconcile editing chrome + console only: when
	// the editing flag is unchanged, only the details panel re-renders
	// (selection/add-flow), never the borders.
	const opsUnsub = core.subscribeLayoutOps((op) => applyOp(op))
	const contextUnsub = core.subscribeContext((bagName, changed) => {
		if (disposed) return
		// Key change: only the tools whose id moved change, and `bindTool`
		// already re-runs `updateToolNode` for those in place — reloading the
		// border here would needlessly rebuild every node in it.
		if (changed.length > 0) return
		// Identity change (`setContext` / `removeContext` emit `[]`): the bag
		// object itself was replaced, so every tool reading it must re-resolve.
		const regions = regionsUsingBag(core, bagName)
		for (const region of regions) syncBorder(region)
	})
	const consoleUnsub = consoleStore.subscribe((state) => {
		if (disposed) return
		const before = lastEditing
		const editing = computeEditing()
		if (before === undefined || editing !== before) {
			syncEditing()
			return
		}
		// Same editing flag: selection/add-flow change → details panel only.
		// `open` flips still need the full console (overlay mount/unmount).
		const wasOpen = consoleHost.querySelector('.palette-default-command-overlay') !== null
		if (state.open !== wasOpen) {
			consoleQuery = ''
			renderConsole()
			return
		}
		renderConsoleDetails()
	})

	syncStructure()

	return {
		refresh: syncStructure,
		dispose() {
			disposed = true
			opsUnsub()
			contextUnsub()
			consoleUnsub()
			dropAllBindings()
			container.removeEventListener('keydown', onKeyDown)
			consoleHost.textContent = ''
			for (const overlay of document.querySelectorAll('.palettable-drawer__overlay')) {
				overlay.remove()
			}
			core.dispose()
		},
	}
}

export { axisForRegion, validateSerializedLayout }
