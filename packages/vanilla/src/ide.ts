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
	buttonPresenter,
	type ConsoleStore,
	configuration,
	configuratorEditorCleanup,
	type DraggingState,
	type DragOverDecision,
	editorChoicesFor,
	filterCommandEntries,
	type Hoverable,
	isActionPoint,
	isValuedPoint,
	type LayoutOp,
	type PaletteCore,
	type PaletteRegion,
	paletteAddItemEntries,
	paletteCommandEntries,
	paletteDerivedVariants,
	parsePointSpec,
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
import { startDragSession } from './drag-session.js'
import { renderHeadItem, surfaceForRegion } from './head.js'
import { clearGapClasses, syncGapClasses } from './highlight.js'
import { createVanillaKeys, isEditableTarget } from './keys.js'
import { NodeRegistry } from './nodes.js'
import { clampSlideDelta, toolbarGrabOffset, toolbarSlideBounds } from './slide.js'

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
	/** Legacy alias — the explicit session the engine still takes as a param. */
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
	 * Live slide-follow for a whole-toolbar drag (adapter-owned DOM write).
	 * Gaps stay untouched during the drag — the toolbar follows the pointer
	 * via compositor-only `transform`; a single `resizeToolbar` commit lands
	 * on release. Mirrors the svelte `ToolbarTrack` declarative effect +
	 * `retargetToolbarSlide` / rAF loop, armed imperatively here.
	 */
	let slideCleanup: (() => void) | undefined
	let slideToolbar: Toolbar | undefined

	/** Arm slide-follow over the dragged toolbar's live element. */
	function armSlide(toolbar: Toolbar, region: PaletteRegion, event: PointerEvent): void {
		disarmSlide()
		const element = nodes.get(toolbar)
		if (!(element instanceof HTMLElement)) return
		const ownerWindow = element.ownerDocument.defaultView ?? window
		const direction = directionFor(region)
		const horizontal = direction === 'horizontal'
		const grabOffset = toolbarGrabOffset({
			toolbarElement: element,
			clientX: event.clientX,
			clientY: event.clientY,
			direction,
		})
		const bounds = toolbarSlideBounds(element, direction)
		if (bounds === undefined) return
		const rect = element.getBoundingClientRect()
		const offset0 = (horizontal ? rect.left : rect.top) - bounds.start
		slideToolbar = toolbar
		let latestX = event.clientX
		let latestY = event.clientY
		let queued = false
		const flush = () => {
			queued = false
			if (dragging?.isWholeToolbar !== true || slideToolbar !== dragging.origin.toolbar) return
			const live = nodes.get(slideToolbar)
			if (!(live instanceof HTMLElement) || !live.isConnected) return
			const pointer = horizontal ? latestX : latestY
			const delta = clampSlideDelta(bounds, offset0, pointer, grabOffset)
			live.style.transform =
				delta === 0
					? ''
					: horizontal
						? `translate3d(${delta}px, 0, 0)`
						: `translate3d(0, ${delta}px, 0)`
		}
		const onMove = (move: PointerEvent) => {
			latestX = move.clientX
			latestY = move.clientY
			if (!queued) {
				queued = true
				requestAnimationFrame(flush)
			}
		}
		ownerWindow.addEventListener('pointermove', onMove)
		slideCleanup = () => {
			ownerWindow.removeEventListener('pointermove', onMove)
			const live = slideToolbar !== undefined ? nodes.get(slideToolbar) : undefined
			if (live instanceof HTMLElement) live.style.transform = ''
			slideToolbar = undefined
		}
		flush()
	}

	/** Drop slide-follow and clear the live transform. */
	function disarmSlide(): void {
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
	 * subset at `createDrag` (grab target in, session out) — this
	 * adapter only reports the grabbed tool and applies the core's paint /
	 * commit decisions from `dragOver`. A lone tool in its toolbar starts
	 * as a whole-toolbar slide (`isWholeToolbar` set at drag-start by
	 * core), so slide-follow arms immediately. No session → core returns
	 * empty → dark, so hover alone never paints. Restructuring happens only
	 * on a highlighted DZ: hovering a dark gap never moves tools. The layout op
	 * re-renders the affected border so tools reorganize mid-drag.
	 */
	function startToolDrag(event: PointerEvent, toolbar: Toolbar, item: ToolbarItem): void {
		if (dragSession) return
		if (event.button !== 0) return
		if (isEditableTarget(event.target)) return
		if (!computeEditing()) return
		event.preventDefault()
		try {
			dragSession = core.layout.createDrag({ kind: 'tool', toolbar, item })
			dragging = sessionState(dragSession)
		} catch {
			// Drawer-child toolbars live outside borders/parking — core has
			// no origin for them, so no drag session (no crash on grab).
			dragSession = undefined
			dragging = undefined
			return
		}
		container.classList.add('dragging')
		container.dataset.dragging = 'true'
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
		} catch {
			// Drawer-child toolbars live outside borders/parking — core has
			// no origin for them, so no drag session (no crash on grab).
			dragSession = undefined
			dragging = undefined
			return
		}
		container.classList.add('dragging')
		container.dataset.dragging = 'true'
		if (dragTarget !== undefined) armSlide(dragging.origin.toolbar, region, event)
		startDragSession({
			event,
			onMove: () => {},
			onStop: () => endToolDrag(),
		})
	}

	/** End the session: drop paint classes, slide transform, forget the session. */
	function endToolDrag(): void {
		disarmSlide()
		dragSession?.end()
		dragSession = undefined
		dragging = undefined
		hoveredTrackSpace = undefined
		container.classList.remove('dragging')
		delete container.dataset.dragging
		for (const host of [topHost, leftHost, rightHost, bottomHost, consoleHost]) {
			clearGapClasses(host)
		}
	}

	/**
	 * Legacy session state behind the `ToolbarDrag` shell (Phase 1 only).
	 * The engine still takes it explicitly; Phase 7 removes this escape
	 * hatch when mode/origin go session-internal.
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
	 * Route an item-gap hover through the session and read back the legacy
	 * decision (Phase 1 bridge — paint flips to events in Phase 2).
	 * `dragTarget` is unused: the session resolves the container itself.
	 */
	function overItemGap(
		session: ToolbarDrag,
		toolbar: Toolbar,
		gap: number,
		event: PointerEvent
	): DragOverDecision | undefined {
		session.over({ kind: 'item-gap', toolbar, gap }, pointerSample(event))
		return (session as unknown as { decision?: DragOverDecision }).decision
	}

	/** Raw client numbers per hover (core picks the axis in Phase 4). */
	function pointerSample(event: PointerEvent): { clientX: number; clientY: number } {
		return { clientX: event.clientX, clientY: event.clientY }
	}

	/**
	 * Apply a core `dragOver` decision: paint the returned highlight sets
	 * as classes (item gaps on their bars, track gaps on the track, whole-
	 * toolbar neighbour edges on the neighbour bars). Single paint path —
	 * the core decided, this adapter only applies.
	 */
	function applyDragDecision(
		bar: HTMLElement,
		trackEl: HTMLElement | null,
		decision: DragOverDecision
	): void {
		let barPainted = false
		for (const paint of decision.itemHighlights) {
			const node = nodes.get(paint.toolbar)
			if (node instanceof HTMLElement) {
				syncGapClasses(
					node,
					{ highlighted: new Set(paint.gaps), hovered: undefined },
					'itemSpaceIndex'
				)
				if (node === bar) barPainted = true
			}
		}
		// No paint for this bar → clear stale classes (moving between items
		// must not leave the previous highlight behind).
		if (!barPainted) clearGapClasses(bar)
		if (trackEl instanceof HTMLElement) {
			const paint = decision.trackHighlights[0]
			// Scoped sync (not `clearGapClasses`): the bar lives INSIDE the
			// track element, so a blanket clear would wipe the item gaps
			// just painted above. Syncing the empty set only touches
			// `data-track-space-index` nodes.
			syncGapClasses(
				trackEl,
				{ highlighted: new Set(paint?.gaps ?? []), hovered: undefined },
				'trackSpaceIndex'
			)
		}
		for (const edge of decision.neighbourEdges) {
			const neighbour = nodes.get(edge.toolbar)
			if (neighbour instanceof HTMLElement) {
				syncGapClasses(
					neighbour,
					{ highlighted: new Set([edge.gap]), hovered: undefined },
					'itemSpaceIndex'
				)
			}
		}
	}

	/**
	 * Item-space highlight as a class-toggle pass over the core session.
	 * No rebuild — just `highlighted` flips on the existing gap nodes.
	 * When a side runs dry (every item-space touches a dragged
	 * tool), the core falls back to the flanking track gap or the
	 * whole-toolbar neighbour edges — all inside the one decision.
	 *
	 * Phase 1: the hover is built once via `toHoverable` (single hit-test),
	 * then routed through `session.over()`; the legacy decision is read
	 * back off the session until Phase 2 flips paint to events.
	 */
	function paintItemSpaces(
		bar: HTMLElement,
		toolbar: Toolbar,
		activeItem: number | undefined,
		hovered: number | undefined,
		_fallback?: { readonly track: Track; readonly border: import('@palettable/core').Border }
	): DragOverDecision | undefined {
		const session = dragSession
		if (!computeEditing() || !session) {
			clearGapClasses(bar)
			return undefined
		}
		if (hovered === undefined && activeItem === undefined) {
			clearGapClasses(bar)
			const trackEl = bar.closest('.toolbar-track')
			if (trackEl instanceof HTMLElement) clearGapClasses(trackEl)
			return undefined
		}
		const trackEl = bar.closest('.toolbar-track')
		const item = activeItem !== undefined ? toolbar[activeItem] : undefined
		const hover: Hoverable | null =
			hovered !== undefined
				? { kind: 'item-gap', toolbar, gap: hovered }
				: item === undefined
					? null
					: { kind: 'tool', toolbar, item }
		// Parking rows carry no `dragTarget`: the session locates the row
		// in the live parking stack itself (container resolved by `===`).
		// `activeItem` on a `tool` hover is implicit in the item identity;
		// the `toolbar`+`activeItem` form is used by the bar-background path.
		if (hover === null) return undefined
		session.over(hover, { clientX: 0, clientY: 0 })
		const decision = (session as unknown as { decision?: DragOverDecision }).decision
		if (!decision) return undefined
		applyDragDecision(bar, trackEl instanceof HTMLElement ? trackEl : null, decision)
		return decision
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
					dragTarget
				)
				return
			}
			if (hover.kind !== 'item-gap') {
				if (hover.kind !== 'tool') return
				// Hovering a tool (not a gap): highlight the nearest free
				// gaps flanking it (active-item fallback). A dry side falls
				// back to the flanking track gap (core `trackSpaceHighlight`).
				const active = toolbar.indexOf(hover.item)
				paintItemSpaces(bar, toolbar, active >= 0 ? active : undefined, undefined, dragTarget)
				return
			}
			// `session.over()` decides paint + commit in one call: a highlighted
			// gap restructures (core commits), a dark gap returns
			// `moved: false` with no paint. The layout op re-renders the
			// affected border, so the tools visibly reorganize mid-drag.
			// Parking rows have no `dragTarget` — the core locates the row
			// in the live parking stack itself.
			const decision = overItemGap(session, toolbar, hover.gap, event)
			if (decision) {
				const trackEl = bar.closest('.toolbar-track')
				applyDragDecision(bar, trackEl instanceof HTMLElement ? trackEl : null, decision)
				if (decision.moved) {
					// `dragOver` mutates the live arrays silently (no layout
					// op) — re-render the border so the move shows. The
					// re-render rebuilds the bar, so re-apply the decision
					// paint onto the FRESH nodes (the old bar is detached).
					// The session (`dragging.tools`) survives by item identity.
					// A restructure that extracts its tools promotes to a
					// whole-toolbar slide: re-arm slide-follow over the fresh
					// toolbar so it sticks under the cursor (mirrors the
					// svelte track effect).
					const region = bar
						.closest('.toolbar-border')
						?.getAttribute('data-region') as PaletteRegion | null
					if (region) syncBorder(region)
					else syncStructure()
					const freshBar = nodes.get(toolbar)
					const freshTrack =
						dragging !== undefined &&
						dragging.origin.kind === 'border' &&
						dragging.origin.track !== undefined
							? nodes.get(dragging.origin.track)
							: undefined
					if (freshBar instanceof HTMLElement) {
						applyDragDecision(
							freshBar,
							freshTrack instanceof HTMLElement ? freshTrack : null,
							decision
						)
					}
					if (dragging?.isWholeToolbar && region) armSlide(dragging.origin.toolbar, region, event)
					else disarmSlide()
				}
			}
		})
		bar.addEventListener('pointerleave', () => {
			paintItemSpaces(bar, toolbar, undefined, undefined)
			// The fallback paints on the track element, not the bar — clear
			// it too, otherwise a dry-side highlight survives leaving the
			// toolbar.
			const trackEl = bar.closest('.toolbar-track')
			if (trackEl instanceof HTMLElement) clearGapClasses(trackEl)
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
		// Stack gaps paint via the core `dragOver` decision (highlight-only:
		// the dwell commit stays adapter-owned). Hover alone stays dark.
		borderEl.addEventListener('pointerleave', () => {
			clearGapClasses(borderEl)
		})
		borderEl.addEventListener('pointermove', (event) => {
			const session = dragSession
			if (!session) return
			const target = event.target
			if (!(target instanceof HTMLElement)) return
			// Inside a toolbar → that toolbar owns the perpendicular DZs.
			if (target.closest('.toolbar')) return
			// Hovering a track background (not a gap): highlight the two
			// flanking stack gaps (session `over` on the track element).
			const trackBg = target.closest('[data-track-index]')
			if (trackBg && borderEl.contains(trackBg) && !target.closest('[data-stack-index]')) {
				const trackIndex = Number((trackBg as HTMLElement).dataset.trackIndex)
				if (Number.isInteger(trackIndex)) {
					session.over({ kind: 'stack-gap', border, gap: trackIndex }, pointerSample(event))
					const decision = (session as unknown as { decision?: DragOverDecision }).decision
					const paint = decision?.stackHighlights[0]
					if (paint !== undefined) {
						syncGapClasses(
							borderEl,
							{ highlighted: new Set(paint.gaps), hovered: undefined },
							'stackIndex'
						)
					} else {
						clearGapClasses(borderEl)
					}
					return
				}
			}
			const spaceEl = target.closest('[data-stack-index]')
			if (!spaceEl || !borderEl.contains(spaceEl)) return
			const index = Number((spaceEl as HTMLElement).dataset.stackIndex)
			const gap = Number.isInteger(index) ? index : undefined
			if (gap === undefined) return
			session.over({ kind: 'stack-gap', border, gap }, pointerSample(event))
			const decision = (session as unknown as { decision?: DragOverDecision }).decision
			const paint = decision?.stackHighlights[0]
			if (paint !== undefined) {
				syncGapClasses(
					borderEl,
					{ highlighted: new Set(paint.gaps), hovered: undefined },
					'stackIndex'
				)
			} else {
				clearGapClasses(borderEl)
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
			// Track gaps commit on hover via the core `dragOver` decision:
			// a highlighted gap restructures (extracts the tools into a
			// fresh singleton at that gap), a dark gap never moves tools.
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
					clearGapClasses(trackEl)
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
				session.over({ kind: 'track-gap', track, gap: next }, pointerSample(event))
				const decision = (session as unknown as { decision?: DragOverDecision }).decision
				if (!decision) {
					hoveredTrackSpace = next
					return
				}
				syncGapClasses(
					trackEl,
					{
						highlighted: new Set(decision.trackHighlights[0]?.gaps ?? []),
						hovered: undefined,
					},
					'trackSpaceIndex'
				)
				if (decision.moved) {
					hoveredTrackSpace = next
					syncBorder(region)
					// Re-apply the paint onto the fresh track node (the old
					// one was rebuilt by the re-render).
					const freshTrack = nodes.get(track)
					if (freshTrack instanceof HTMLElement) {
						syncGapClasses(
							freshTrack,
							{
								highlighted: new Set(decision.trackHighlights[0]?.gaps ?? []),
								hovered: undefined,
							},
							'trackSpaceIndex'
						)
					}
					// A restructure that extracts its tools promotes to a
					// whole-toolbar slide: re-arm slide-follow over the
					// fresh toolbar (mirrors the svelte track effect).
					if (dragging?.isWholeToolbar && dragging) armSlide(dragging.origin.toolbar, region, event)
					else disarmSlide()
				} else {
					hoveredTrackSpace = next
				}
			})
			trackEl.addEventListener('pointerleave', () => {
				hoveredTrackSpace = undefined
				clearGapClasses(trackEl)
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
		const stack = el('div', 'palette-parking palette-horizontal stack-vertical')
		stack.dataset.paletteId = paletteId
		stack.dataset.container = 'parking'
		// No highlight while the movement engine is stripped: the leave
		// pass only clears stale classes.
		stack.addEventListener('pointerleave', () => {
			clearGapClasses(stack)
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
	 */
	function syncEditing(): void {
		if (disposed) return
		const editing = computeEditing()
		if (editing === lastEditing) return
		lastEditing = editing
		if (!editing) {
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
	 * Layout-op interceptor: route structural mutations to the affected
	 * border(s) only, so untouched borders keep DOM identity. `replace`
	 * (whole-load) clears the registry and rebuilds everything.
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
