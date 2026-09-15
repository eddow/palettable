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
 * Drag sessions run here (adapter-owned): `pointerdown` → `startSession`,
 * window `pointermove` → `GapDwell` → `commitDraggedTo*` + gap-class paint,
 * rAF slide-follow with a single `resizeToolbar` commit on release; guards
 * inspect (`pointerdown` selects for the configurator).
 */

import {
	type AddItemSource,
	type AnyPoint,
	actualTrackSpaceAt,
	axisForRegion,
	borderStackHighlight,
	buttonPresenter,
	type ConsoleStore,
	commitDraggedToItemSpace,
	commitDraggedToParking,
	commitDraggedToParkingRow,
	commitDraggedToStackSpace,
	commitDraggedToTrackSpace,
	configuration,
	configuratorEditorCleanup,
	createGapDwellState,
	type DraggingState,
	editorChoicesFor,
	filterCommandEntries,
	GapDwell,
	type GapDwellState,
	isActionPoint,
	isItemSpaceFree,
	isValuedPoint,
	itemSpaceHighlight,
	type LayoutOp,
	type PaletteCore,
	type PaletteRegion,
	paletteAddItemEntries,
	paletteCommandEntries,
	paletteDerivedVariants,
	parkingGapHighlight,
	parsePointSpec,
	resizeToolbar,
	type SurfaceContext,
	selectPresenter,
	sliderPresenter,
	type Toolbar,
	type ToolbarItem,
	type Track,
	togglePresenter,
	type Unsubscribe,
	validateSerializedLayout,
} from '@palettable/core'
import { itemFromAddSelection } from './add-item.js'
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
	/** Drag-end save hook: called once per drag session that mutated layout. */
	readonly onLayoutChange?: () => void
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
			button.classList.toggle('is-selected', view.pressed)
			button.setAttribute('aria-pressed', view.pressed ? 'true' : 'false')
			button.title = view.title
			return
		}
		case 'select': {
			const view = selectPresenter(item, { point, value, bags }, surface)
			const select = node.querySelector('select')
			if (!(select instanceof HTMLSelectElement)) return
			// Guard: never clobber an open dropdown mid-interaction.
			if (document.activeElement === select) return
			if (select.value !== view.value) select.value = view.value
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
				button.classList.toggle('is-selected', star <= view.value)
				button.setAttribute('aria-checked', star === view.value ? 'true' : 'false')
				button.textContent = star <= view.value ? '▶' : '▷'
			})
			return
		}
		case 'slider': {
			const view = sliderPresenter(item, { point, value, bags }, surface)
			const input = node.querySelector('input[type="range"]')
			if (!(input instanceof HTMLInputElement)) return
			// Guard: keep a dragged thumb alive — never rewrite while focused.
			if (document.activeElement === input) return
			const next = String(view.value)
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
			if (minus instanceof HTMLButtonElement) minus.disabled = view.value - view.step < view.min
			if (plus instanceof HTMLButtonElement) plus.disabled = view.value + view.step > view.max
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

	function dropBindingsFor(content: HTMLElement): void {
		const unsubs = toolBindings.get(content)
		if (!unsubs) return
		for (const unsub of unsubs) unsub()
		toolBindings.delete(content)
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
	/** Live drag session (adapter-owned; core takes it as an explicit param). */
	let dragging: DraggingState | undefined
	/** Set on every mid-drag commit; drag-end pulls one snapshot when set. */
	let dragDirty = false
	/** Per-container dwell states for stack-gap hover (border × 4 + parking). */
	const dwellByContainer = new Map<string, { state: GapDwellState; dwell: GapDwell }>()
	/** Idempotency memo: last track-space gap committed (same gap = no-op). */
	let hoveredTrackSpace: number | undefined
	/** Slide-follow session for whole-toolbar drags (rAF transform only). */
	let slide:
		| {
				track: Track
				toolbar: Toolbar
				toolbarElement: HTMLElement
				direction: 'horizontal' | 'vertical'
				bounds: { start: number; available: number }
				offset0: number
		  }
		| undefined
	/** Latest pointer (written on move, drained by the rAF loop). */
	let latestPointer = { x: 0, y: 0 }
	let slideDirty = false
	/**
	 * Fan-out callbacks drained + cleared with `slideDirty` each frame
	 * (slide + highlight + badge when one move fans out).
	 */
	const slideCallbacks = new Set<() => void>()
	let slideFrame = 0
	let slideStopped = true
	let grabOffset: number | undefined
	/** Open drawer popups (trigger → popup) for layout-change repositioning. */
	const openDrawers = new Map<
		HTMLElement,
		{ popup: HTMLElement; surfaceAxis: 'horizontal' | 'vertical' }
	>()

	function dwellFor(key: string): { state: GapDwellState; dwell: GapDwell } {
		let entry = dwellByContainer.get(key)
		if (!entry) {
			entry = { state: createGapDwellState(), dwell: new GapDwell() }
			dwellByContainer.set(key, entry)
		}
		return entry
	}

	function resetAllDwells(): void {
		for (const entry of dwellByContainer.values()) entry.dwell.reset(entry.state)
		hoveredTrackSpace = undefined
	}

	function clearSlideElement(): void {
		if (slide?.toolbarElement.isConnected) slide.toolbarElement.style.transform = ''
	}

	function clearSlide(): void {
		clearSlideElement()
		slide = undefined
	}

	function stopSlideLoop(): void {
		slideStopped = true
		if (slideFrame !== 0 && typeof cancelAnimationFrame !== 'undefined') {
			cancelAnimationFrame(slideFrame)
		}
		slideFrame = 0
		slideDirty = false
		slideCallbacks.clear()
	}

	function flushSlideTransform(): void {
		const live = slide
		const session = dragging
		if (!live || !session) return
		if (session.origin.kind !== 'border') return
		if (live.toolbar !== session.origin.toolbar || live.track !== session.origin.track) return
		if (!live.toolbarElement.isConnected) return
		const horizontal = live.direction === 'horizontal'
		const pointer = horizontal ? latestPointer.x : latestPointer.y
		const delta = clampSlideDelta(live.bounds, live.offset0, pointer, grabOffset ?? 0)
		live.toolbarElement.style.transform =
			delta === 0
				? ''
				: horizontal
					? `translate3d(${delta}px, 0, 0)`
					: `translate3d(0, ${delta}px, 0)`
	}

	function slideLoopTick(): void {
		if (slideStopped) {
			slideFrame = 0
			return
		}
		if (slideDirty) {
			slideDirty = false
			for (const callback of [...slideCallbacks]) callback()
			slideCallbacks.clear()
		}
		slideFrame = requestAnimationFrame(slideLoopTick)
	}

	function ensureSlideLoop(): void {
		if (typeof requestAnimationFrame === 'undefined') {
			flushSlideTransform()
			return
		}
		if (slideFrame !== 0) return
		slideStopped = false
		slideFrame = requestAnimationFrame(slideLoopTick)
	}

	/**
	 * (Re)arm slide-follow over `toolbar` in `track` at the current pointer.
	 * Called at grab time (whole-toolbar) and after every gap commit that
	 * (re)locates the dragged toolbar — including the first gap commit of a
	 * tool drag, which promotes the drag into sliding over the fresh
	 * singleton. A restructure drag recenters the grab on the new toolbar's
	 * middle (`recenter`).
	 */
	function retargetSlide(options: {
		track: Track
		toolbar: Toolbar
		toolbarElement: HTMLElement
		direction: 'horizontal' | 'vertical'
		clientX: number
		clientY: number
		recenter?: boolean
	}): boolean {
		const session = dragging
		if (!session) return false
		if (!options.toolbarElement.isConnected) return false
		const rect = options.toolbarElement.getBoundingClientRect()
		const horizontal = options.direction === 'horizontal'
		if (options.recenter) {
			const size = horizontal ? rect.width : rect.height
			if (size > 0) grabOffset = size / 2
		}
		const bounds = toolbarSlideBounds(options.toolbarElement, options.direction)
		if (!bounds) return false
		const resting = (horizontal ? rect.left : rect.top) - bounds.start
		if (slide?.toolbarElement !== options.toolbarElement) clearSlideElement()
		slide = {
			track: options.track,
			toolbar: options.toolbar,
			toolbarElement: options.toolbarElement,
			direction: options.direction,
			bounds,
			offset0: resting,
		}
		// Land under the cursor at arm time — not on the next pointer move.
		const pointer = horizontal ? options.clientX : options.clientY
		const delta = clampSlideDelta(slide.bounds, resting, pointer, grabOffset ?? 0)
		options.toolbarElement.style.transform =
			delta === 0
				? ''
				: horizontal
					? `translate3d(${delta}px, 0, 0)`
					: `translate3d(0, ${delta}px, 0)`
		return true
	}

	/** Resolve the live `.toolbar` element for a toolbar object (slide re-arm). */
	function toolbarElementOf(toolbar: Toolbar): HTMLElement | undefined {
		const node = nodes.get(toolbar)
		return node instanceof HTMLElement ? node : undefined
	}

	/** Mark the session dirty after a commit (drag-end pulls one snapshot). */
	function markDragDirty(): void {
		dragDirty = true
	}

	function endDragSession(): void {
		resetAllDwells()
		for (const host of [topHost, leftHost, rightHost, bottomHost, consoleHost]) {
			clearGapClasses(host)
		}
		// Single commit on release: resize the gaps once from the visual
		// position, then clear the transform so layout takes over.
		const live = slide
		const session = dragging
		if (
			live &&
			session?.origin.kind === 'border' &&
			live.toolbar === session.origin.toolbar &&
			live.track === session.origin.track
		) {
			const slot = session.origin.track.findIndex((entry) => entry.toolbar === live.toolbar)
			if (slot >= 0) {
				const horizontal = live.direction === 'horizontal'
				const pointer = horizontal ? latestPointer.x : latestPointer.y
				const delta = clampSlideDelta(live.bounds, live.offset0, pointer, grabOffset ?? 0)
				const offset = live.offset0 + delta
				if (live.bounds.available > 0) {
					resizeToolbar(session.origin.track, slot, offset / live.bounds.available)
				}
			}
			if (live.toolbarElement.isConnected) live.toolbarElement.style.transform = ''
		} else if (live?.toolbarElement.isConnected) {
			live.toolbarElement.style.transform = ''
		}
		slide = undefined
		stopSlideLoop()
		dragging = undefined
		grabOffset = undefined
		container.classList.remove('dragging')
		delete container.dataset.dragging
		if (dragDirty) {
			dragDirty = false
			options.onLayoutChange?.()
		}
	}

	/**
	 * Start a drag session: `dragging` holds the tool list, the pointer is
	 * tracked on the window, and release clears the session. While the mode
	 * is `'slide'` the toolbar follows the pointer via `transform` (gaps
	 * untouched) with a single `resizeToolbar` commit on release.
	 */
	function startSession(options: {
		event: PointerEvent
		tools: ToolbarItem[]
		origin: DraggingState['origin']
		mode: DraggingState['mode']
		track?: Track
		toolbar?: Toolbar
		toolbarElement?: HTMLElement
		direction?: 'horizontal' | 'vertical'
		offset?: number
	}): void {
		dragging = { tools: options.tools, origin: options.origin, mode: options.mode }
		dragDirty = false
		container.classList.add('dragging')
		container.dataset.dragging = 'true'
		grabOffset = options.offset
		latestPointer = { x: options.event.clientX, y: options.event.clientY }
		if (
			options.track &&
			options.toolbar &&
			options.toolbarElement &&
			options.direction &&
			options.mode === 'slide'
		) {
			retargetSlide({
				track: options.track,
				toolbar: options.toolbar,
				toolbarElement: options.toolbarElement,
				direction: options.direction,
				clientX: options.event.clientX,
				clientY: options.event.clientY,
			})
		} else {
			clearSlide()
		}
		slideDirty = false
		ensureSlideLoop()
		startDragSession({
			event: options.event,
			onMove: (_snapshot, moveEvent) => {
				latestPointer = { x: moveEvent.clientX, y: moveEvent.clientY }
				// Fan-out point: one move enqueues every per-frame callback
				// (slide today; highlight/badge enqueue here when needed).
				// `Set` dedupes so repeated moves before a frame collapse.
				slideCallbacks.add(flushSlideTransform)
				slideDirty = true
				if (typeof requestAnimationFrame === 'undefined') flushSlideTransform()
			},
			onStop: () => endDragSession(),
		})
	}

	/** Reposition every open drawer popup from its trigger's live rect. */
	function repositionDrawers(): void {
		for (const [trigger, open] of [...openDrawers]) {
			if (!trigger.isConnected || !open.popup.isConnected) {
				openDrawers.delete(trigger)
				continue
			}
			const rect = trigger.getBoundingClientRect()
			const offset = 6
			open.popup.style.left = `${(open.surfaceAxis === 'vertical' ? rect.right : rect.left) + offset}px`
			open.popup.style.top = `${(open.surfaceAxis === 'vertical' ? rect.top : rect.bottom) + offset}px`
		}
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
		dragTarget?:
			| {
					readonly track: Track
					readonly border: import('@palettable/core').Border
					readonly trackIndex: number
					readonly parking?: undefined
			  }
			| {
					readonly parking: import('@palettable/core').Parking
					readonly toolbarIndex: number
					readonly track?: undefined
					readonly border?: undefined
			  }
	): HTMLElement {
		const bar = el('div', 'toolbar')
		bar.dataset.paletteId = paletteId
		if (editing) bar.dataset.editing = 'true'
		bar.dataset.container = containerKind
		nodes.setToolbar(toolbar, bar)
		const direction = directionFor(region)
		if (editing) {
			bar.addEventListener('pointerdown', (event) => {
				if (event.button !== 0) return
				if (isEditableTarget(event.target)) return
				// Whole-toolbar grab: mousedown on the bar itself (not on a
				// tool) slides the toolbar along its track until release.
				if ((event.target as HTMLElement | null)?.closest?.('.toolbar-item')) return
				event.preventDefault()
				const live = core.layout.getLayout()
				if (containerKind === 'parking' || dragTarget?.parking !== undefined) {
					const parking = live.parking
					const toolbarIndex =
						basePath.container === 'parking' ? basePath.toolbarIndex : parking.indexOf(toolbar)
					if (toolbarIndex < 0) return
					startSession({
						event,
						tools: [...toolbar],
						origin: { kind: 'parking', toolbar, parking, index: toolbarIndex },
						mode: 'slide',
					})
					return
				}
				const target = dragTarget?.track !== undefined ? dragTarget : undefined
				if (!target) return
				startSession({
					event,
					tools: [...toolbar],
					origin: { kind: 'border', toolbar, track: target.track, border: target.border },
					mode: 'slide',
					track: target.track,
					toolbar,
					toolbarElement: bar,
					direction,
					offset: toolbarGrabOffset({
						toolbarElement: bar,
						clientX: event.clientX,
						clientY: event.clientY,
						direction,
					}),
				})
			})
			bar.addEventListener('pointermove', (event) => {
				if (!editing || !dragging) return
				const target = event.target
				if (!(target instanceof HTMLElement)) return
				// Inside a nested toolbar → that toolbar owns the item DZs.
				if (target.closest('.toolbar') !== bar) return
				const spaceEl = target.closest('[data-item-space-index]')
				if (!spaceEl || !bar.contains(spaceEl)) {
					// Hovering a tool (not a gap): highlight the nearest free
					// gaps flanking it (active-item fallback).
					const itemEl = target.closest('[data-item-index]')
					const active =
						itemEl && bar.contains(itemEl)
							? Number((itemEl as HTMLElement).dataset.itemIndex)
							: undefined
					paintItemSpaces(bar, toolbar, Number.isInteger(active) ? active : undefined, undefined)
					return
				}
				const index = Number((spaceEl as HTMLElement).dataset.itemSpaceIndex)
				const at = Number.isInteger(index) ? index : undefined
				paintItemSpaces(bar, toolbar, undefined, at)
				if (at === undefined || !isItemSpaceFree(dragging, toolbar, at)) return
				if (dragTarget?.track !== undefined && dragTarget.border !== undefined) {
					if (
						commitDraggedToItemSpace(dragging, toolbar, dragTarget.track, dragTarget.border, at)
					) {
						markDragDirty()
						rearmSlideAfterCommit()
					}
				} else if (dragTarget?.parking !== undefined) {
					if (
						commitDraggedToParking(
							dragging,
							toolbar,
							dragTarget.parking,
							dragTarget.toolbarIndex,
							at
						)
					) {
						markDragDirty()
					}
				}
			})
			bar.addEventListener('pointerleave', () => {
				paintItemSpaces(bar, toolbar, undefined, undefined)
			})
		}
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
				onOpenDrawer: (trigger, popup, surfaceAxis) => {
					openDrawers.set(trigger, { popup, surfaceAxis })
				},
				onCloseDrawer: (trigger) => {
					openDrawers.delete(trigger)
				},
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
					event.stopPropagation()
					setInspecting(path)
					if (event.button !== 0) return
					// Tool grab: a single tool; slide when alone in its toolbar.
					const live = core.layout.getLayout()
					if (containerKind === 'parking' || dragTarget?.parking !== undefined) {
						const parking = live.parking
						const toolbarIndex =
							basePath.container === 'parking' ? basePath.toolbarIndex : parking.indexOf(toolbar)
						if (toolbarIndex < 0) return
						startSession({
							event,
							tools: [item],
							origin: { kind: 'parking', toolbar, parking, index: toolbarIndex },
							mode: toolbar.length === 1 ? 'slide' : 'restructure',
						})
						return
					}
					const target = dragTarget?.track !== undefined ? dragTarget : undefined
					if (!target) return
					startSession({
						event,
						tools: [item],
						origin: { kind: 'border', toolbar, track: target.track, border: target.border },
						mode: toolbar.length === 1 ? 'slide' : 'restructure',
					})
				})
				wrapper.append(guard)
			}
			bar.append(wrapper)
			appendSpace(itemIndex + 1)
		})
		void axis
		return bar
	}

	/**
	 * Item-space highlight as a class-toggle pass: direct hover wins, else
	 * the nearest free gap on each side of the hovered item. No rebuild —
	 * just `highlighted` / `hovered` flips on the existing gap nodes.
	 */
	function paintItemSpaces(
		bar: HTMLElement,
		toolbar: Toolbar,
		activeItem: number | undefined,
		hovered: number | undefined
	): void {
		const session = dragging
		if (!computeEditing() || !session) {
			clearGapClasses(bar)
			return
		}
		syncGapClasses(
			bar,
			itemSpaceHighlight({ toolbar, activeItem, hovered, editing: true, dragging: session }),
			'itemSpaceIndex'
		)
	}

	/** Re-arm slide-follow over the session's relocated toolbar (mid-drag). */
	function rearmSlideAfterCommit(): void {
		const session = dragging
		if (session?.origin.kind !== 'border') return
		if (session.mode !== 'slide') {
			clearSlide()
			return
		}
		const element = toolbarElementOf(session.origin.toolbar)
		if (!element) return
		const live = core.layout.getLayout()
		for (const region of REGIONS) {
			const border = live.borders[region]
			for (const track of border) {
				if (track !== session.origin.track) continue
				retargetSlide({
					track,
					toolbar: session.origin.toolbar,
					toolbarElement: element,
					direction: directionFor(region),
					clientX: latestPointer.x,
					clientY: latestPointer.y,
					recenter: grabOffset === undefined,
				})
				return
			}
		}
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
		const liveLayout = core.layout.getLayout()
		const liveBorder = liveLayout.borders[region]
		const existing = host.querySelector(':scope > .toolbar-border')
		// The diff path reuses nodes but never (un)binds the editing-gated
		// drag listeners — only the full rebuild below does. When the
		// editing flag differs from the rendered tree, the diff would keep
		// stale listeners (or none at all), so fall through to rebuild.
		const renderedEditing = existing instanceof HTMLElement && existing.dataset.editing === 'true'
		if (
			existing instanceof HTMLElement &&
			renderedEditing === editing &&
			diffBorder(existing, region, editing)
		) {
			paintStackGaps(existing, region)
			return
		}
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
		if (editing) borderEl.dataset.editing = 'true'
		const border = liveBorder
		if (editing) {
			borderEl.addEventListener('pointermove', (event) => {
				if (!dragging) return
				const target = event.target
				if (!(target instanceof HTMLElement)) return
				// Inside a toolbar/track → that container owns the DZs.
				if (target.closest('.toolbar') ?? target.closest('.toolbar-track')) {
					// Track hover still paints flanking stacks (active), but a
					// direct gap hover paints only itself (hovered).
					const trackEl = target.closest('.toolbar-track')
					const stackEl = target.closest('[data-stack-index]')
					const entry = dwellFor(`border:${region}`)
					if (stackEl && borderEl.contains(stackEl)) {
						const index = Number((stackEl as HTMLElement).dataset.stackIndex)
						entry.dwell.hoverGap(entry.state, Number.isInteger(index) ? index : undefined)
					} else if (trackEl && borderEl.contains(trackEl)) {
						const index = Number((trackEl as HTMLElement).dataset.trackIndex)
						entry.dwell.hoverRow(entry.state, Number.isInteger(index) ? index : undefined)
					} else {
						entry.dwell.hoverGap(entry.state, undefined)
					}
					paintStackGaps(borderEl, region)
					return
				}
				const stackEl = target.closest('[data-stack-index]')
				const entry = dwellFor(`border:${region}`)
				if (stackEl && borderEl.contains(stackEl)) {
					const index = Number((stackEl as HTMLElement).dataset.stackIndex)
					entry.dwell.hoverGap(entry.state, Number.isInteger(index) ? index : undefined)
				} else {
					entry.dwell.hoverGap(entry.state, undefined)
				}
				paintStackGaps(borderEl, region)
			})
			borderEl.addEventListener('pointerleave', () => {
				const entry = dwellFor(`border:${region}`)
				entry.dwell.reset(entry.state)
				clearGapClasses(borderEl)
			})
		}
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
			if (editing) {
				trackEl.addEventListener('pointermove', (event) => {
					if (!dragging) return
					const target = event.target
					if (!(target instanceof HTMLElement)) return
					// Inside a toolbar → that toolbar owns the item-space DZs.
					// Keep the memo: after a commit the fresh toolbar sits
					// under the pointer, and clearing would re-arm on the
					// very next move (double toolbar for one gap).
					if (target.closest('.toolbar')) return
					const spaceEl = target.closest('[data-track-space-index]')
					if (!spaceEl || !trackEl.contains(spaceEl)) {
						hoveredTrackSpace = undefined
						return
					}
					const index = Number((spaceEl as HTMLElement).dataset.trackSpaceIndex)
					const next = Number.isInteger(index) ? index : undefined
					const prev = hoveredTrackSpace
					if (
						next !== undefined &&
						next !== prev &&
						commitDraggedToTrackSpace(dragging, track, border, next)
					) {
						markDragDirty()
						hoveredTrackSpace = next
						rearmSlideAfterCommit()
					} else {
						hoveredTrackSpace = next
					}
				})
				trackEl.addEventListener('pointerleave', () => {
					hoveredTrackSpace = undefined
				})
			}
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
						{ track, border, trackIndex }
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
		paintStackGaps(borderEl, region)
	}

	/**
	 * Per-node border diff: reconcile the existing `.toolbar-border` element
	 * against the live border — create/drop delta nodes only, move existing
	 * nodes with `insertBefore`/`appendChild`, update track-space flex in
	 * place. Returns `true` when the diff applied (no rebuild needed).
	 * Falls back to `false` (full rebuild) when the stack-space framing
	 * disagrees — e.g. inverse-order flips or a replaced border element.
	 */
	function diffBorder(borderEl: HTMLElement, region: PaletteRegion, editing: boolean): boolean {
		const live = core.layout.getLayout()
		const border = live.borders[region]
		const direction = directionFor(region)
		const inverse = region === 'right' || region === 'bottom'
		// Collect existing children by role: stack spaces vs track elements.
		const stackGaps: HTMLElement[] = []
		const trackEls: HTMLElement[] = []
		for (const child of [...borderEl.children]) {
			if (!(child instanceof HTMLElement)) return false
			if (child.classList.contains('toolbar-track')) trackEls.push(child)
			else if (child.classList.contains('toolbar-stack-space')) stackGaps.push(child)
			else return false
		}
		if (stackGaps.length !== border.length + 1) return false
		if (trackEls.length !== border.length) return false
		// Fix stack-space indices in place (no node churn).
		for (let index = 0; index < stackGaps.length; index += 1) {
			const gap = stackGaps[index]!
			const want = inverse ? String(border.length - index) : String(index)
			if (gap.dataset.stackIndex !== want) gap.dataset.stackIndex = want
		}
		// Reconcile tracks in live order: reuse by `===` identity, move
		// with `insertBefore`, create/drop only the delta.
		const liveTracks = new Set(border)
		for (const track of border) {
			const existing = nodes.get(track)
			if (existing instanceof HTMLElement && existing.parentElement !== borderEl) {
				nodes.delete(track)
			}
		}
		for (const trackEl of trackEls) {
			let owned = false
			for (const track of border) {
				if (nodes.get(track) === trackEl) {
					owned = true
					break
				}
			}
			if (!owned) {
				dropBindingsIn(trackEl)
				trackEl.remove()
			}
		}
		const anchorFor = (trackIndex: number): Node | null => {
			// Stack gaps interleave tracks: non-inverse renders
			// gap[i] track[i] gap[i+1]; inverse renders gap[i+1] track[i] gap[i].
			// Either way the track sits between gap[trackIndex] and
			// gap[trackIndex + 1] — anchor on the gap *after* the track.
			const after = stackGaps[trackIndex + 1] ?? stackGaps[trackIndex]?.nextSibling ?? null
			return after
		}
		border.forEach((track, trackIndex) => {
			let trackEl = nodes.get(track)
			if (!(trackEl instanceof HTMLElement) || trackEl.parentElement !== borderEl) {
				trackEl = buildTrackElement(track, trackIndex, direction, region, editing)
				nodes.setTrack(track, trackEl)
				borderEl.insertBefore(trackEl, anchorFor(trackIndex))
			} else {
				borderEl.insertBefore(trackEl, anchorFor(trackIndex))
				diffTrack(trackEl, track, trackIndex, direction, region, editing)
			}
			if (!liveTracks.has(track)) {
				dropBindingsIn(trackEl)
				trackEl.remove()
			}
		})
		// Drop registry entries for tracks that no longer exist.
		return true
	}

	/** Build a fresh `.toolbar-track` element (diff creation path). */
	function buildTrackElement(
		track: Track,
		trackIndex: number,
		direction: 'horizontal' | 'vertical',
		region: PaletteRegion,
		editing: boolean
	): HTMLElement {
		const trackEl = el('div', 'toolbar-track')
		trackEl.dataset.trackIndex = String(trackIndex)
		trackEl.dataset.paletteId = paletteId
		if (editing) attachTrackDrag(trackEl, track, liveBorderOf(region))
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
					{ track, border: liveBorderOf(region), trackIndex }
				)
			)
			trackEl.append(slotEl)
			trackSpace(slotIndex + 1)
		})
		return trackEl
	}

	function liveBorderOf(region: PaletteRegion): import('@palettable/core').Border {
		return core.layout.getLayout().borders[region]
	}

	/** Reconcile one track element: slot order, toolbar identity, gap flex. */
	function diffTrack(
		trackEl: HTMLElement,
		track: Track,
		trackIndex: number,
		direction: 'horizontal' | 'vertical',
		region: PaletteRegion,
		editing: boolean
	): void {
		if (trackEl.dataset.trackIndex !== String(trackIndex)) {
			trackEl.dataset.trackIndex = String(trackIndex)
		}
		// Update track-space flex in place.
		let gapIndex = 0
		for (const child of [...trackEl.children]) {
			if (!(child instanceof HTMLElement)) continue
			if (child.classList.contains('toolbar-track-space')) {
				const space = actualTrackSpaceAt(track, gapIndex)
				child.style.flexBasis = `${space * 100}%`
				child.style.flexGrow = `${Math.max(space, configuration.trackGapMinGrow)}`
				if (child.dataset.trackSpaceIndex !== String(gapIndex)) {
					child.dataset.trackSpaceIndex = String(gapIndex)
				}
				gapIndex += 1
			}
		}
		// Reconcile slots: reuse toolbar elements by `===`, move the rest.
		const slotEls = [...trackEl.children].filter(
			(child): child is HTMLElement =>
				child instanceof HTMLElement && child.classList.contains('toolbar-track-slot')
		)
		const liveToolbars = new Set(track.map((slot) => slot.toolbar))
		for (const slotEl of slotEls) {
			const bar = slotEl.querySelector(':scope > .toolbar')
			let owned = false
			for (const toolbar of liveToolbars) {
				if (nodes.get(toolbar) === bar) {
					owned = true
					break
				}
			}
			if (!owned) {
				dropBindingsIn(slotEl)
				slotEl.remove()
			}
		}
		track.forEach((slot, slotIndex) => {
			let slotEl: HTMLElement | undefined
			for (const candidate of trackEl.querySelectorAll(':scope > .toolbar-track-slot')) {
				if (!(candidate instanceof HTMLElement)) continue
				const bar = candidate.querySelector(':scope > .toolbar')
				if (bar && nodes.get(slot.toolbar) === bar) {
					slotEl = candidate
					break
				}
			}
			if (!slotEl) {
				slotEl = el('div', 'toolbar-track-slot')
				slotEl.append(
					renderToolbarElement(
						slot.toolbar,
						direction,
						region,
						editing,
						'border',
						{ container: 'border', region, trackIndex, slotIndex },
						{ track, border: liveBorderOf(region), trackIndex }
					)
				)
				const gaps = [...trackEl.children].filter(
					(child): child is HTMLElement =>
						child instanceof HTMLElement && child.classList.contains('toolbar-track-space')
				)
				const anchor = gaps[slotIndex + 1] ?? null
				trackEl.insertBefore(slotEl, anchor)
			} else {
				if (slotEl.dataset.toolbarSlotIndex !== String(slotIndex)) {
					slotEl.dataset.toolbarSlotIndex = String(slotIndex)
				}
				const gaps = [...trackEl.children].filter(
					(child): child is HTMLElement =>
						child instanceof HTMLElement && child.classList.contains('toolbar-track-space')
				)
				const anchor = gaps[slotIndex + 1] ?? null
				trackEl.insertBefore(slotEl, anchor)
			}
		})
	}

	/** Attach track-gap commit handling (shared by build + rebuild paths). */
	function attachTrackDrag(
		trackEl: HTMLElement,
		track: Track,
		border: import('@palettable/core').Border
	): void {
		trackEl.addEventListener('pointermove', (event) => {
			if (!dragging) return
			const target = event.target
			if (!(target instanceof HTMLElement)) return
			if (target.closest('.toolbar')) return
			const spaceEl = target.closest('[data-track-space-index]')
			if (!spaceEl || !trackEl.contains(spaceEl)) {
				hoveredTrackSpace = undefined
				return
			}
			const index = Number((spaceEl as HTMLElement).dataset.trackSpaceIndex)
			const next = Number.isInteger(index) ? index : undefined
			const prev = hoveredTrackSpace
			if (
				next !== undefined &&
				next !== prev &&
				commitDraggedToTrackSpace(dragging, track, border, next)
			) {
				markDragDirty()
				hoveredTrackSpace = next
				rearmSlideAfterCommit()
			} else {
				hoveredTrackSpace = next
			}
		})
		trackEl.addEventListener('pointerleave', () => {
			hoveredTrackSpace = undefined
		})
	}

	/**
	 * Border stack-gap highlight as a class-toggle pass: hovering a track
	 * paints the two surrounding stacks; hovering a gap directly paints
	 * only it. The two stacks touching the would-be-emptied track never
	 * paint. Direct hover also arms the one-shot dwell timer → new track.
	 */
	function paintStackGaps(borderEl: HTMLElement, region: PaletteRegion): void {
		const session = dragging
		if (!computeEditing() || !session) {
			clearGapClasses(borderEl)
			return
		}
		const live = core.layout.getLayout()
		const border = live.borders[region]
		const entry = dwellFor(`border:${region}`)
		syncGapClasses(
			borderEl,
			borderStackHighlight({
				border,
				active: entry.state.active,
				hovered: entry.state.hovered,
				editing: true,
				dragging: session,
			}),
			'stackIndex'
		)
		// One-shot dwell arming: a directly-hovered stack DZ promotes to a
		// track after `stackDzHoverMs`. Retargeting restarts the timer (the
		// cleanup clears the previous one); leaving the gap or ending the
		// drag cancels it.
		entry.dwell.arm(entry.state, {
			editing: true,
			dragging: true,
			masked: false,
			canArm: (gap) => {
				const decision = borderStackHighlight({
					border: core.layout.getLayout().borders[region],
					active: entry.state.active,
					hovered: gap,
					editing: true,
					dragging,
				})
				return decision.highlighted.has(gap)
			},
			onFire: (targetStack) => {
				const liveBorder = core.layout.getLayout().borders[region]
				if (entry.state.hovered !== targetStack) return
				if (commitDraggedToStackSpace(dragging!, liveBorder, targetStack)) {
					markDragDirty()
					rearmSlideAfterCommit()
				}
			},
		})
	}

	function renderParking(host: HTMLElement, editing: boolean): void {
		host.textContent = ''
		const live = core.layout.getLayout()
		const stack = el('div', 'palette-parking palette-horizontal stack-vertical')
		stack.dataset.paletteId = paletteId
		stack.dataset.container = 'parking'
		if (editing) {
			stack.addEventListener('pointermove', (event) => {
				if (!dragging) return
				const target = event.target
				if (!(target instanceof HTMLElement)) return
				// Inside a toolbar → that toolbar owns the item-space DZs.
				if (target.closest('.toolbar')) return
				const entry = dwellFor('parking')
				const gapEl = target.closest('[data-parking-gap-index]')
				if (gapEl && stack.contains(gapEl)) {
					const index = Number((gapEl as HTMLElement).dataset.parkingGapIndex)
					entry.dwell.hoverGap(entry.state, Number.isInteger(index) ? index : undefined)
				} else {
					const rowEl = target.closest('[data-parking-row-index]')
					if (rowEl && stack.contains(rowEl)) {
						const index = Number((rowEl as HTMLElement).dataset.parkingRowIndex)
						entry.dwell.hoverRow(entry.state, Number.isInteger(index) ? index : undefined)
					} else {
						entry.dwell.hoverGap(entry.state, undefined)
					}
				}
				paintParkingGaps(stack)
			})
			stack.addEventListener('pointerleave', () => {
				const entry = dwellFor('parking')
				entry.dwell.reset(entry.state)
				clearGapClasses(stack)
			})
		}
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
				renderToolbarElement(
					toolbar,
					'horizontal',
					'top',
					editing,
					'parking',
					{
						container: 'parking',
						toolbarIndex: index,
					},
					{ parking: live.parking, toolbarIndex: index }
				)
			)
			stack.append(row)
			gap(index + 1)
		}
		host.append(stack)
		paintParkingGaps(stack)
	}

	/**
	 * Parking stack-gap highlight as a class-toggle pass (same protocol as
	 * border stacks, with the would-be-emptied row veto). Direct hover arms
	 * the one-shot dwell timer → new row.
	 */
	function paintParkingGaps(stack: HTMLElement): void {
		const session = dragging
		if (!computeEditing() || !session) {
			clearGapClasses(stack)
			return
		}
		const live = core.layout.getLayout()
		const entry = dwellFor('parking')
		syncGapClasses(
			stack,
			parkingGapHighlight({
				parking: live.parking,
				active: entry.state.active,
				hovered: entry.state.hovered,
				editing: true,
				dragging: session,
			}),
			'parkingGapIndex'
		)
		entry.dwell.arm(entry.state, {
			editing: true,
			dragging: true,
			masked: false,
			canArm: (gap) => {
				const decision = parkingGapHighlight({
					parking: core.layout.getLayout().parking,
					active: entry.state.active,
					hovered: gap,
					editing: true,
					dragging,
				})
				return decision.highlighted.has(gap)
			},
			onFire: (targetGap) => {
				if (entry.state.hovered !== targetGap) return
				if (commitDraggedToParkingRow(dragging!, core.layout.getLayout().parking, targetGap)) {
					markDragDirty()
					rearmSlideAfterCommit()
				}
			},
		})
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
	 * Structural renders (`renderBorder`/`renderParking`) stamp the same
	 * chrome at creation time so first paint matches.
	 *
	 * NOTE: guards added here inspect only — the drag `pointerdown` →
	 * session binding lives on the render path (`renderToolbarElement`),
	 * which closes over the toolbar/track/border. `syncEditing` re-renders
	 * structurally on an editing flip so drag handling is always bound.
	 * This pass is currently unreferenced (kept for node-preserving
	 * callers); the biome-ignore below pins it against noUnusedVariables.
	 */
	// biome-ignore lint/correctness/noUnusedVariables: kept for node-preserving callers
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
				node.addEventListener('pointerdown', () => {
					if (path) setInspecting(path)
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
	 * Reconcile the editing flag with a structural re-render: drag handling
	 * (guard `pointerdown` → session, bar/track `pointermove` commits) is
	 * bound at render time, so the chrome-only `applyEditing` pass cannot
	 * enable it — the borders must re-render to pick up the listeners.
	 * Structural renders call this after rebuilding so `lastEditing` tracks.
	 *
	 * NOTE: this rebuilds the borders (node identity is not preserved
	 * across the flip) — the value-sync suite pins the chrome flips, not
	 * the no-rebuild property.
	 */
	function syncEditing(): void {
		if (disposed) return
		const editing = computeEditing()
		if (editing === lastEditing) return
		lastEditing = editing
		if (!editing && inspecting !== undefined) {
			const oldNode = inspectingNodeOf(inspecting)
			if (oldNode) delete oldNode.dataset.inspected
			inspecting = undefined
		}
		syncStructure()
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
	 * created together — no core call). Text/tone edits patch the live DOM
	 * node in place (no rebuild); editor-type swaps rebuild just the tool
	 * element with initial values; delete flows through `moveItem`.
	 */
	function patchLive(
		path: InspectingPath,
		patch: (item: import('@palettable/core').ToolbarItem) => void,
		rebuildTool = false
	): void {
		const found = itemAtPath(path)
		if (!found) return
		patch(found.item)
		if (!rebuildTool) {
			const node = inspectingNodeOf(path)
			const content = node?.querySelector(':scope > .toolbar-item-content')
			if (node instanceof HTMLElement && content instanceof HTMLElement) {
				const surface = surfaceForRegion(
					path.container === 'border' ? path.region : ('top' as PaletteRegion)
				)
				updateToolNode(core, found.item, surface, content)
			}
			renderConsoleDetails()
			return
		}
		// Editor-type swap: full tool rebuild with initial values.
		const node = inspectingNodeOf(path)
		const content = node?.querySelector(':scope > .toolbar-item-content')
		if (!(node instanceof HTMLElement) || !(content instanceof HTMLElement)) {
			syncStructure()
			return
		}
		dropBindingsFor(content)
		content.textContent = ''
		const surface = surfaceForRegion(
			path.container === 'border' ? path.region : ('top' as PaletteRegion)
		)
		const rendered = renderHeadItem({
			core,
			item: found.item,
			surface,
			region: path.container === 'border' ? path.region : ('top' as PaletteRegion),
			onOpenConsole: (mode) => consoleStore.open(mode),
			onInspect: () => setInspecting(path),
			onOpenDrawer: (trigger, popup, surfaceAxis) => {
				openDrawers.set(trigger, { popup, surfaceAxis })
			},
			onCloseDrawer: (trigger) => {
				openDrawers.delete(trigger)
			},
			renderToolbar: (childTrack: Track, childAxis, childRegion) =>
				renderDrawerTrack(childTrack, childAxis, childRegion, computeEditing()),
		})
		if (rendered) content.append(rendered)
		bindTool(content, found.item, surface)
		renderConsoleDetails()
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
			patchLive(
				path,
				(target) => {
					const record = target as {
						editor?: string
						config?: Record<string, unknown>
					}
					record.editor = next
					const cleanup = configuratorEditorCleanup(next)
					if (record.config) {
						for (const key of cleanup) delete record.config[key]
					}
				},
				true
			)
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
			// Deletion prunes empty toolbars/tracks via the op diff; the
			// details panel must follow (Inspect → empty hint).
			setInspecting(undefined)
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
			// The selected variant gets an insert action: build the item
			// from the entry + variant + inline values and append it to the
			// first toolbar of the top border (creating one when empty).
			if (selectedVariant === variant.id) {
				const insert = document.createElement('button')
				insert.type = 'button'
				insert.className = 'palette-default-add-insert'
				insert.dataset.testid = 'console-add-insert'
				insert.textContent = 'Add to toolbar'
				insert.addEventListener('click', () => {
					const snapshot = consoleStore.snapshot
					const item = itemFromAddSelection(
						{
							source,
							variant,
							booleanValue: snapshot.booleanValue,
							setValue: snapshot.setValue,
						},
						core.points,
						core.editors,
						core.editorDefaults
					)
					if (!item) return
					const live = core.layout.getLayout()
					const border = live.borders.top
					if (border.length === 0 || border[0]?.length === 0) {
						core.layout.moveToolbar(
							undefined,
							{ container: 'border', region: 'top', trackIndex: 0, toolbarIndex: 0 },
							[item]
						)
					} else {
						const toolbar = border[0]?.[0]?.toolbar
						if (!toolbar) return
						core.layout.moveItem(
							undefined,
							{
								container: 'border',
								region: 'top',
								trackIndex: 0,
								toolbarIndex: 0,
								itemIndex: toolbar.length,
							},
							item
						)
					}
					consoleStore.patch({ selectedEntryId: undefined, selectedVariantId: undefined })
				})
				wrap.append(insert)
			}
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
	 * border(s) via the per-node diff, so untouched borders — and untouched
	 * nodes inside touched borders — keep DOM identity. `replace`
	 * (whole-load) clears the registry and rebuilds everything. Every path
	 * repositions open drawer popups (their triggers may have moved).
	 */
	function applyOp(op: LayoutOp): void {
		if (disposed) return
		// Drop registry entries for prune-cascade victims first: the
		// emptied toolbar/track/row objects no longer exist.
		if (op.kind !== 'insert-item' && op.kind !== 'replace') {
			for (const victim of op.pruned) {
				nodes.delete(victim.toolbar)
			}
		}
		switch (op.kind) {
			case 'replace':
				nodes.clear()
				syncStructure()
				return
			case 'move-item': {
				// The moved item keeps `===` identity: drop its stale wrapper
				// so the diff rebuilds it at the new position.
				nodes.delete(op.item)
				const regions = new Set<PaletteRegion>()
				if (op.from.container === 'border') regions.add(op.from.region)
				if (op.to.container === 'border') regions.add(op.to.region)
				for (const region of regions) syncBorder(region)
				repositionDrawers()
				return
			}
			case 'remove-item': {
				nodes.delete(op.item)
				if (op.at.container === 'border') syncBorder(op.at.region)
				else syncStructure()
				repositionDrawers()
				return
			}
			case 'insert-item': {
				if (op.at.container === 'border') syncBorder(op.at.region)
				else syncStructure()
				repositionDrawers()
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
					repositionDrawers()
					return
				}
				for (const region of regions) syncBorder(region)
				repositionDrawers()
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
			if (dragging) endDragSession()
			opsUnsub()
			contextUnsub()
			consoleUnsub()
			dropAllBindings()
			nodes.clear()
			slideCallbacks.clear()
			container.removeEventListener('keydown', onKeyDown)
			consoleHost.textContent = ''
			for (const overlay of document.querySelectorAll('.palettable-drawer__overlay')) {
				overlay.remove()
			}
			openDrawers.clear()
			core.dispose()
		},
	}
}

export { axisForRegion, validateSerializedLayout }
