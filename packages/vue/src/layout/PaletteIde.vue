<script setup lang="ts">
/**
 * `@palettable/vue` — IDE shell (`.palette-ide`).
 *
 * Vue-idiom mirror of the vanilla `createIDE` structural contract: a
 * `.palette-ide` root (`.editing` + `data-editing` in edit mode,
 * `data-palette-id`) holding top / middle (left + center + right) /
 * bottom hosts, each rendering a `BorderStack` from the live layout.
 * The center holds the `work-zone` slot (consumer content) plus the
 * console overlay slot.
 *
 * Reactivity: a `layoutRevision` counter bumped by layout-op + value +
 * context + console subscriptions re-reads `core.layout.getLayout()`
 * (live object — never cached across renders). Per-tool value sync is
 * reactive by construction (presenters recompute on revision bump);
 * no per-tool subscription map is needed. Drag sessions commit through
 * `core.layout` moves; highlight arrives as session `DragEvent`s applied
 * as class toggles via refs.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, useTemplateRef } from 'vue'
import {
	actualTrackSpaceAt,
	type AddableEntry,
	type Border,
	configuration,
	type ConsoleStore,
	type DragEvent,
	type DraggingState,
	draggingEmptiesTrackIndex,
	draggingWholeParkingRow,
	type DropZone,
	type HighlightState,
	type Hoverable,
	type PaletteCore,
	type PaletteRegion,
	type Toolbar,
	type ToolbarDrag,
	type ToolbarItem,
	type Track,
} from '@palettable/core'
import BorderStack from './BorderStack.vue'
import ConsoleOverlay from './ConsoleOverlay.vue'
import { layoutRevisionKey } from './revision-key.js'
import { toolbarKeyOf, trackKeyOf } from './identity-key.js'
import { barRegistryKey, createBarRegistry } from './bar-registry.js'
import { ideDragApiKey } from './ide-drag-api.js'
import { startDragSession } from '../drag-session.js'
import { clearGapClasses } from '../highlight.js'
import { createVueKeys, isEditableTarget } from '../keys.js'
import { outsideGapForTrack } from '../outside.js'
import { extractionGrabOffset, toolbarGrabOffset, toolbarSlideBounds } from '../slide.js'
import { surfaceForRegion, type HeadContext } from '../head.js'
import {
	syncIdeCatalogStrings,
	useIdeDisplay,
	useIdeStrings,
	useIdeTheme,
	type IdeOptions,
} from '../ide.js'

const props = defineProps<IdeOptions>()

const strings = useIdeStrings(props)
const display = useIdeDisplay(props)
const { setting: themeSetting, enabled: themeEnabled } = useIdeTheme(props)
const paletteId = computed(() => props.paletteId ?? 'demo')

/** Structural revision: bumped by every store/layout/console event. */
const layoutRevision = ref(0)
const bump = () => {
	layoutRevision.value += 1
}

const live = computed(() => {
	void layoutRevision.value
	return props.core.layout.getLayout()
})

const commandBoxPresent = computed(() => {
	const layout = live.value
	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	for (const region of regions) {
		for (const track of layout.borders[region]) {
			for (const slot of track) {
				if (
					slot.toolbar.some((item) => (item as { control?: unknown }).control === 'commandBox')
				) {
					return true
				}
			}
		}
	}
	return false
})

const editing = computed(() => {
	void layoutRevision.value
	const canEdit = props.isEditable()
	if (!canEdit) return false
	const snapshot = props.consoleStore.snapshot
	if (commandBoxPresent.value) return snapshot.open
	return snapshot.open && snapshot.mode === 'edit'
})

const inspected = ref<ToolbarItem | undefined>(undefined)

/** Live drawer items with an open popup (identity = ToolbarItem). */
const openDrawerItems = new Set<ToolbarItem>()

const ideRootRef = useTemplateRef<HTMLElement>('ideRoot')

const barRegistry = createBarRegistry()
provide(barRegistryKey, barRegistry)
provide(layoutRevisionKey, layoutRevision)

/**
 * Applied-highlight mirror: the last lit state per drop-zone, keyed
 * structurally (identity-stable toolbar/track ids + gap index — the
 * session creates fresh DZ objects per decision, so object identity
 * cannot dedupe).
 *
 * The session diffs paint against its own baseline and emits `on` only
 * on change — so a highlight that arrives while the post-commit DOM is
 * not yet rendered (same `over()` pass as the `structure` event) is
 * dropped by `applyHighlight` (no node to toggle) and never re-emitted.
 * The mirror re-applies the lit entries after the declarative re-render
 * flushes (see `applyStructureEvent`), converging DOM paint with the
 * session baseline. `off` events delete the entry. Cleared on drag end
 * and editing-off alongside the class clear.
 */
const appliedHighlights = new Map<string, { dz: DropZone; state: HighlightState }>()

provide(ideDragApiKey, {
	barPointerdown: (event, toolbar, region) => onBarPointerdown(event, toolbar, region),
	barPointermove: (event, toolbar) => onBarPointermove(event, toolbar),
	barPointerover: (event, toolbar) => onBarPointerover(event, toolbar),
	guardPointerdown: (event) => onGuardPointerdown(event),
	inspect: (item) => onInspect(item),
	parkingPointermove: (event) => onParkingPointermove(event),
	parkingPointerleave: (event) => onParkingPointerleave(event),
	panelPointermove: (event) => onPanelPointermove(event),
	panelPointerleave: (event) => onPanelPointerleave(event),
	dragActive: () => isDragLive(),
	trackDrawerOpen: (item) => {
		openDrawerItems.add(item)
	},
	trackDrawerClose: (item) => {
		openDrawerItems.delete(item)
	},
	closeUnrelatedDrawers: (target, spare) => closeUnrelatedDrawers(target, spare),
})

// ── Drag engine (Vue-idiom mirror of the vanilla session wiring) ────────────
// One live `ToolbarDrag` at a time (`dragSession`), created by
// `core.layout.createDrag` on guard/bar-background pointerdown while
// editing. All `pointermove` handlers resolve a `Hoverable` and route it
// through `session.over(hover, sample)`; paint arrives as `highlight`
// events applied as class toggles via live DOM queries; commits arrive
// as `structure` events (re-render via `bump()` + slide re-arm).
let dragSession: ToolbarDrag | undefined
let draggingState: DraggingState | undefined
let slideGrabOffset: number | undefined
let slideItemGrab: { readonly x: number; readonly y: number } | undefined
let slideRearmEvent: PointerEvent | undefined
let slideToolbar: Toolbar | undefined
let slideDelta: number | undefined
let slideQueued = false
let slideQueueWrite: (() => void) | undefined
let slideCleanup: (() => void) | undefined
const maskLitRegions = new Set<PaletteRegion>()
let panelMaskLit = false
/** Last track-gap hover committed (idempotency memo — mirrors
 * vanilla's `hoveredTrackSpace`: a bare gap index. After a commit the
 * fresh toolbar sits under the pointer — re-sending the same gap would
 * commit a duplicate toolbar for it. Keyed on the gap index alone, NOT
 * the `Track` object: vanilla uses a plain number and the commit
 * splices fresh arrays. Cleared when the pointer leaves the track-gap
 * surface or the track element; KEPT when the pointer is over a toolbar
 * (the fresh toolbar covers the gap after a commit — clearing there
 * would re-arm on the next move). */
let hoveredTrackSpace: number | undefined

/** Track object of the last committed track-gap hover (memo identity half: the gap index alone re-arms across stale-prop renders — the live track identity distinguishes a consumed gap from a fresh one). */
let hoveredTrackRef: Track | undefined

/** Live drag flag (plain function — `computed` never re-evaluates for module `let`). */
function isDragLive(): boolean {
	return dragSession !== undefined
}

const dragActive = computed(() => isDragLive())

function pointerSample(event: PointerEvent): { clientX: number; clientY: number } {
	return { clientX: event.clientX, clientY: event.clientY }
}

function sessionState(session: ToolbarDrag): DraggingState {
	const inner = (session as unknown as { draggingState: DraggingState }).draggingState
	if (!inner) throw new Error('sessionState: session has no draggingState')
	return inner
}

function directionFor(region: PaletteRegion): 'horizontal' | 'vertical' {
	return region === 'left' || region === 'right' ? 'vertical' : 'horizontal'
}

function regionOfToolbar(toolbar: Toolbar): PaletteRegion | undefined {
	const liveLayout = props.core.layout.getLayout()
	for (const region of ['top', 'right', 'bottom', 'left'] as const) {
		for (const track of liveLayout.borders[region]) {
			for (const slot of track) {
				if (slot.toolbar === toolbar) return region
			}
		}
	}
	return undefined
}

function toolbarOfBar(bar: HTMLElement): Toolbar | undefined {
	return barRegistry.toolbarOf(bar)
}

/**
 * Live toolbar behind a bar element, resolved from DOM order (never the
 * registry alone). After a structural commit the bar is a fresh element
 * the registry hasn't re-registered yet (`nextTick`); the registry then
 * misses and the hover falls through to the track-gap path. The rendered
 * order mirrors the live layout order (border → track → slot), so walk
 * the element chain and index the live arrays directly.
 */
function toolbarAtElement(bar: HTMLElement): Toolbar | undefined {
	const root = ideRootRef.value
	if (!(root instanceof HTMLElement) || !root.contains(bar)) return undefined
	const slotEl = bar.closest('.toolbar-track-slot')
	const trackEl = bar.closest('.toolbar-track')
	const borderEl = bar.closest('.toolbar-border')
	if (!(borderEl instanceof HTMLElement)) return undefined
	const region = borderEl.getAttribute('data-region') as PaletteRegion | null
	if (region !== 'top' && region !== 'right' && region !== 'bottom' && region !== 'left') {
		return undefined
	}
	const liveLayout = props.core.layout.getLayout()
	const border = liveLayout.borders[region]
	if (!(trackEl instanceof HTMLElement)) return undefined
	const trackIndex = Number(trackEl.getAttribute('data-track-index'))
	if (!Number.isInteger(trackIndex)) return undefined
	const track = border[trackIndex]
	if (track === undefined) return undefined
	if (!(slotEl instanceof HTMLElement)) {
		// Parking rows have no track/slot chain — the caller handles them.
		return undefined
	}
	const slotIndex = Number(slotEl.getAttribute('data-toolbar-slot-index'))
	if (!Number.isInteger(slotIndex)) return undefined
	return track[slotIndex]?.toolbar
}

function gapNodeFor(dz: DropZone): HTMLElement | undefined {
	const root = ideRootRef.value
	if (!(root instanceof HTMLElement)) return undefined
	switch (dz.kind) {
		case 'item-gap': {
			const bar = barRegistry.elementOfToolbar(dz.toolbar) ?? barForToolbar(dz.toolbar)
			if (!(bar instanceof HTMLElement) || !root.contains(bar)) return undefined
			const node = bar.querySelector(`[data-item-space-index="${dz.gap}"]`)
			return node instanceof HTMLElement ? node : undefined
		}
		case 'track-gap': {
			const trackEl = barRegistry.elementOfTrack(dz.track) ?? trackElementFor(dz.track)
			if (!(trackEl instanceof HTMLElement) || !root.contains(trackEl)) return undefined
			const node = trackEl.querySelector(`[data-track-space-index="${dz.gap}"]`)
			return node instanceof HTMLElement ? node : undefined
		}
		case 'stack-gap':
		case 'outside': {
			const liveLayout = props.core.layout.getLayout()
			for (const region of ['top', 'right', 'bottom', 'left'] as const) {
				if (liveLayout.borders[region] !== dz.border) continue
				const borderEl = root.querySelector(`.toolbar-border[data-region="${region}"]`)
				if (!(borderEl instanceof HTMLElement)) return undefined
				// Right/bottom borders render tracks in reverse (visual order),
				// so positional `:scope > [data-stack-index]` lookup would
				// land on the wrong node — match by the stamped index instead.
				const node = borderEl.querySelector(`:scope > [data-stack-index="${dz.gap}"]`)
				return node instanceof HTMLElement ? node : undefined
			}
			return undefined
		}
		case 'parking-gap': {
			const stack = root.querySelector('.palette-parking')
			if (!(stack instanceof HTMLElement)) return undefined
			const node = stack.querySelector(`:scope > [data-parking-gap-index="${dz.gap}"]`)
			return node instanceof HTMLElement ? node : undefined
		}
	}
}

/**
 * Live bar element for a toolbar, resolved from DOM order (never the
 * registry alone). The registry misses fresh toolbars until the
 * declarative re-render re-registers them; the rendered order mirrors
 * the live layout order, so scan the connected bars and match by live
 * identity via `toolbarAtElement`.
 *
 * Invalidated bars (stale toolbar object reused across a commit) resolve
 * `undefined` here: the DOM-order scan in `toolbarAtElement` indexes the
 * LIVE layout arrays, so a bar whose toolbar has no live slot (pruned
 * origin, replaced singleton) matches nothing — and `gapNodeFor` then
 * skips the paint instead of lighting a dead node.
 */
function barForToolbar(toolbar: Toolbar): HTMLElement | undefined {
	const root = ideRootRef.value
	if (!(root instanceof HTMLElement)) return undefined
	for (const bar of root.querySelectorAll('.toolbar')) {
		if (!(bar instanceof HTMLElement) || !root.contains(bar)) continue
		if (toolbarAtElement(bar) === toolbar) return bar
	}
	return undefined
}

/** Live track element for a track (same fresh-element reason as bars). */
function trackElementFor(track: Track): HTMLElement | undefined {
	const root = ideRootRef.value
	if (!(root instanceof HTMLElement)) return undefined
	const liveLayout = props.core.layout.getLayout()
	for (const region of ['top', 'right', 'bottom', 'left'] as const) {
		const border = liveLayout.borders[region]
		const trackIndex = border.indexOf(track)
		if (trackIndex < 0) continue
		const borderEl = root.querySelector(`.toolbar-border[data-region="${region}"]`)
		if (!(borderEl instanceof HTMLElement)) continue
		const node = borderEl.querySelector(`.toolbar-track[data-track-index="${trackIndex}"]`)
		if (node instanceof HTMLElement && root.contains(node)) return node
	}
	return undefined
}

/**
 * Structural key for a drop-zone: stable across the session's per-decision
 * DZ object recreations (identity-key ids survive commits; pruned objects
 * release via WeakMap so a stale entry can never collide with a fresh gap).
 */
function highlightKeyOf(dz: DropZone): string {
	switch (dz.kind) {
		case 'item-gap':
			return `item:${toolbarKeyOf(dz.toolbar)}:${dz.gap}`
		case 'track-gap':
			return `track:${trackKeyOf(dz.track)}:${dz.gap}`
		case 'stack-gap':
		case 'outside': {
			// Borders are stable per region (never replaced) — resolve the
			// region live so the key survives DZ object recreation.
			const live = props.core.layout.getLayout()
			const regions = ['top', 'right', 'bottom', 'left'] as const
			const region = regions.find((name) => live.borders[name] === dz.border) ?? '?'
			return `stack:${region}:${dz.gap}`
		}
		case 'parking-gap':
			return `parking:${dz.gap}`
	}
}

/** Mirror a highlight event into `appliedHighlights` (`off` deletes). */
function recordHighlight(dz: DropZone, state: HighlightState): void {
	if (state === 'off') {
		appliedHighlights.delete(highlightKeyOf(dz))
		return
	}
	appliedHighlights.set(highlightKeyOf(dz), { dz, state })
}

/**
 * Re-apply every lit mirror entry (post-structure re-render flush).
 * Entries whose nodes still do not resolve (pruned gaps) are dropped —
 * the session baseline already forgot them, so re-emitting is impossible
 * and holding them would paint a gap the engine considers dark.
 */
function reapplyHighlights(): void {
	for (const [key, entry] of [...appliedHighlights]) {
		const node = gapNodeFor(entry.dz)
		if (!(node instanceof HTMLElement)) {
			appliedHighlights.delete(key)
			continue
		}
		node.classList.toggle('highlighted', true)
		node.classList.toggle('hovered', entry.state === 'double')
	}
}

function applyHighlight(dz: DropZone, state: HighlightState): void {
	recordHighlight(dz, state)
	const on = state === 'on' || state === 'double'
	const hovered = state === 'double'
	const node = gapNodeFor(dz)
	if (!(node instanceof HTMLElement)) return
	node.classList.toggle('highlighted', on)
	node.classList.toggle('hovered', hovered)
	// A track-axis flip changes live geometry (a lit gap widens its
	// toolbar, moving the flanking gap edges the slide span is measured
	// from) — re-measure the span so the dragged toolbar stops at the DZ.
	// Skipped while the follow is not yet armed (e.g. the `highlight`
	// events of the same `over()` pass that promoted a subset to a slide:
	// the synchronous re-arm in `applyStructureEvent` runs BEFORE these
	// highlights, but `remeasureSlideSpan` must never run before the
	// frame exists — measuring here would push a stale frame the re-arm
	// then has to overwrite.
	if ((dz.kind === 'item-gap' || dz.kind === 'track-gap') && slideToolbar !== undefined)
		remeasureSlideSpan()
}

/** Re-measure the slide span after a track-axis DZ paint flip. */
function remeasureSlideSpan(): void {
	if (dragSession === undefined || slideToolbar === undefined) return
	const element = barRegistry.elementOfToolbar(slideToolbar)
	if (!(element instanceof HTMLElement)) return
	const region = regionOfToolbar(slideToolbar)
	if (region === undefined) return
	const direction = directionFor(region)
	const horizontal = direction === 'horizontal'
	const prevTransform = element.style.transform
	element.style.transform = ''
	const bounds = toolbarSlideBounds(element, direction)
	const rect = element.getBoundingClientRect()
	element.style.transform = prevTransform
	if (bounds === undefined) return
	const resting = (horizontal ? rect.left : rect.top) - bounds.start
	const grab = slideGrabOffset ?? 0
	dragSession.measure({
		axis: horizontal ? 'horizontal' : 'vertical',
		start: bounds.start,
		available: bounds.available,
		resting,
		grab,
	})
}

/**
 * Apply a session `structure` event synchronously, in emission order.
 *
 * Core emits `structure` first and the `highlight` diff for the same
 * `over()` pass immediately after (`afterStructure()` clears the paint
 * baseline, then `repaintAfterCommit()` re-derives the zones). The
 * adapter must therefore have fresh nodes + a fresh slide frame BEFORE
 * the highlights land — exactly like the vanilla `applyStructureEvent`
 * (`applyOp` → `applyDragChrome` → re-arm in the same emit pass).
 *
 * Vue cannot re-render synchronously here (`bump()` only schedules),
 * so this path does the DOM work the highlights need directly:
 * re-sync the registry to the live elements, re-arm the slide frame,
 * and re-apply the drag chrome. The scheduled re-render (`bump()`)
 * then reconciles declaratively on top of already-correct paint.
 *
 * Highlights of the same `over()` pass that name post-commit nodes
 * cannot resolve yet (the DOM still shows the pre-commit structure) —
 * they are recorded in `appliedHighlights` and re-applied after the
 * re-render flushes (see `reapplyHighlights`), converging with the
 * session baseline the diff will never re-emit.
 */
function applyStructureEvent(): void {
	// Mirror the session's `afterStructure()`: the paint baseline is
	// dropped with no `off` emissions, so the mirror must drop too —
	// otherwise the flush below would re-light gaps the session already
	// forgot. The pass's own highlights arrive after this and re-record.
	appliedHighlights.clear()
	syncBarRegistryToLiveDom()
	applyDragChrome()
	rearmSlideAfterStructure()
	bump()
	void nextTick(() => {
		reopenTrackedDrawers()
		syncBarRegistryToLiveDom()
		// The re-render recreates bars (fresh nodes, no paint) but patches
		// track/stack gaps in place (stale pre-commit paint survives on the
		// same nodes — and the session never emits `off` for paint its
		// cleared baseline forgot). Wipe everything, then re-light exactly
		// what the mirror recorded; re-apply the drag chrome the re-render
		// destroyed with the old bar node.
		const root = ideRootRef.value
		if (root instanceof HTMLElement) clearGapClasses(root)
		reapplyHighlights()
		applyDragChrome()
	})
}

/**
 * Re-sync the element registry to the live DOM after a commit.
 *
 * The declarative re-render (`bump()`) has not run yet when the
 * `structure` event lands, so the registry still points at detached
 * nodes while the `highlight` events of the same `over()` pass need
 * live ones. Walk the rendered bars/tracks/items (DOM order mirrors
 * live layout order) and re-point the registry at the connected
 * elements, creating entries for fresh toolbars/tracks the registry
 * has never seen (restructure extraction).
 */
function syncBarRegistryToLiveDom(): void {
	const root = ideRootRef.value
	if (!(root instanceof HTMLElement)) return
	const liveLayout = props.core.layout.getLayout()
	for (const region of ['top', 'right', 'bottom', 'left'] as const) {
		const borderEl = root.querySelector(`.toolbar-border[data-region="${region}"]`)
		if (!(borderEl instanceof HTMLElement)) continue
		const border = liveLayout.borders[region]
		const trackEls = [...borderEl.querySelectorAll(':scope > .toolbar-track')].filter(
			(node): node is HTMLElement => node instanceof HTMLElement
		)
		const inverse = region === 'right' || region === 'bottom'
		for (let position = 0; position < trackEls.length; position += 1) {
			const positionedTrack = border[inverse ? border.length - 1 - position : position]
			const track = positionedTrack
		if (track === undefined) continue
			// DOM order is render order: the live index maps from the DOM
			// position (single mapping — never a pre-reversed copy).
			const trackEl = trackEls[position]
			if (trackEl instanceof HTMLElement) barRegistry.setTrack(track, trackEl)
			if (!(trackEl instanceof HTMLElement)) continue
			const slotEls = [...trackEl.querySelectorAll(':scope > .toolbar-track-slot')].filter(
				(node): node is HTMLElement => node instanceof HTMLElement
			)
			// The DOM still shows the pre-commit structure when this runs
			// (the declarative re-render has not run yet): pair slot
			// elements to LIVE slots by render position — the DOM order
			// IS the live order minus the commit delta, and the bar
			// occupying each rendered slot is the bar for the live
			// toolbar now at that position. The freshly extracted
			// singleton reuses the dragged bar node (same DOM position),
			// so the bar sitting in the slot the fresh toolbar now
			// occupies is its live bar. Identity checks against the
			// pre-commit DOM would resolve every bar to the OLD toolbar
			// (same object the drag grabbed) and veto the correct sync.
			for (let slotIndex = 0; slotIndex < track.length; slotIndex += 1) {
				const toolbar = track[slotIndex]?.toolbar
				if (toolbar === undefined) continue
				const slotEl = slotEls[slotIndex]
				if (!(slotEl instanceof HTMLElement)) continue
				const bar = slotEl.querySelector(':scope > .toolbar')
				if (!(bar instanceof HTMLElement)) continue
				barRegistry.setToolbar(toolbar, bar)
				const itemEls = [...bar.querySelectorAll(':scope > .toolbar-item')].filter(
					(node): node is HTMLElement => node instanceof HTMLElement
				)
				for (let itemIndex = 0; itemIndex < toolbar.length; itemIndex += 1) {
					const item = toolbar[itemIndex]
					const itemEl = itemEls[itemIndex]
					if (item !== undefined && itemEl instanceof HTMLElement) barRegistry.setItem(item, itemEl)
				}
			}
		}
	}
}

function applySessionEvent(event: DragEvent): void {
	switch (event.type) {
		case 'highlight':
			applyHighlight(event.dz, event.state)
			return
		case 'structure':
			applyStructureEvent()
			return
		case 'slide':
			if (slideToolbar !== undefined && slideToolbar === event.toolbar) {
				slideDelta = event.delta
				slideQueueWrite?.()
			}
			return
		case 'clearSlide': {
			if (slideToolbar !== undefined && slideToolbar !== event.toolbar) return
			const live = slideToolbar !== undefined ? barRegistry.elementOfToolbar(slideToolbar) : undefined
			if (live instanceof HTMLElement) live.style.transform = ''
			slideToolbar = undefined
			slideDelta = undefined
			slideQueued = false
			return
		}
		case 'slideLimit':
			applySlideLimitEvent(event.toolbar, event.atLimit)
			return
		case 'resize':
			applyResizeEvent(event.track, event.index)
			return
	}
}

/** Slide extreme chrome: core decides, the adapter applies verbatim. */
function applySlideLimitEvent(toolbar: Toolbar, atLimit: boolean): void {
	const node = barRegistry.elementOfToolbar(toolbar)
	if (!(node instanceof HTMLElement)) return
	if (atLimit) delete node.dataset.dragged
	else node.dataset.dragged = 'true'
}

/** Re-read the two gaps flanking `track[index]` after core wrote `space`. */
function applyResizeEvent(track: Track, index: number): void {
	const trackEl = barRegistry.elementOfTrack(track)
	if (!(trackEl instanceof HTMLElement)) return
	for (const gap of [index, index + 1]) {
		const node = trackEl.querySelector(`[data-track-space-index="${gap}"]`)
		if (!(node instanceof HTMLElement)) continue
		const space = actualTrackSpaceAt(track, gap)
		node.style.flexBasis = `${space * 100}%`
		node.style.flexGrow = `${Math.max(space, configuration.trackGapMinGrow)}`
	}
}

/** Re-open tracked drawers after a structural re-render (fresh popup starts hidden). */
function reopenTrackedDrawers(): void {
	if (openDrawerItems.size === 0) return
	const root = ideRootRef.value
	const doc = root?.ownerDocument ?? document
	for (const item of [...openDrawerItems]) {
		const wrapper = barRegistry.elementOfItem(item)
		const drawer = wrapper?.querySelector('.palettable-drawer')
		if (!(drawer instanceof HTMLElement) || !doc.contains(drawer)) continue
		const open = (drawer as unknown as { __openDrawer?: () => void }).__openDrawer
		if (typeof open === 'function') open()
	}
}

function armSlide(toolbar: Toolbar, region: PaletteRegion, event: PointerEvent, options?: { readonly recenter?: boolean }): void {
	disarmSlide()
	if (dragSession === undefined) return
	const element = barRegistry.elementOfToolbar(toolbar)
	if (!(element instanceof HTMLElement)) return
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
		grabOffset =
			toolbarGrabOffset({ toolbarElement: element, clientX: event.clientX, clientY: event.clientY, direction })
	}
	slideGrabOffset = grabOffset
	const bounds = toolbarSlideBounds(element, direction)
	if (bounds === undefined) return
	const resting = (horizontal ? rect.left : rect.top) - bounds.start
	dragSession.measure({
		axis: horizontal ? 'horizontal' : 'vertical',
		start: bounds.start,
		available: bounds.available,
		resting,
		grab: grabOffset,
	})
	slideToolbar = toolbar
	slideDelta = undefined
	slideQueued = false
	const flush = () => {
		slideQueued = false
		if (slideToolbar === undefined) return
		const live = barRegistry.elementOfToolbar(slideToolbar)
		if (!(live instanceof HTMLElement) || !live.isConnected) return
		const delta = slideDelta
		if (delta === undefined) return
		live.style.willChange = 'transform'
		live.style.transform =
			delta === 0 ? '' : horizontal ? `translate3d(${delta}px, 0, 0)` : `translate3d(0, ${delta}px, 0)`
	}
	slideQueueWrite = () => {
		if (!slideQueued) {
			slideQueued = true
			ownerWindow.requestAnimationFrame(flush)
		}
	}
	slideCleanup = () => {
		const live = slideToolbar !== undefined ? barRegistry.elementOfToolbar(slideToolbar) : undefined
		if (live instanceof HTMLElement) {
			live.style.transform = ''
			live.style.willChange = ''
		}
		slideToolbar = undefined
		slideDelta = undefined
		slideQueued = false
		slideQueueWrite = undefined
	}
}

/** Grab offset for a restructure extraction: button offset + intra-button grab. */
function recenterGrabOffset(toolbarElement: HTMLElement, direction: 'horizontal' | 'vertical'): number {
	const live = dragSession !== undefined ? sessionState(dragSession) : draggingState
	const item = live?.tools[0]
	const itemNode = item !== undefined ? barRegistry.elementOfItem(item) : undefined
	return extractionGrabOffset({
		toolbarElement,
		buttonElement: itemNode,
		buttonGrab: slideItemGrab,
		direction,
	})
}

function disarmSlide(): void {
	dragSession?.measure(undefined)
	slideCleanup?.()
	slideCleanup = undefined
}

function rearmSlideAfterStructure(): void {
	// Read the live session state, never the cached `draggingState` mirror:
	// core mutates `session.origin` / `isWholeToolbar` on every commit
	// (extraction promotes a subset to a whole-toolbar slide), and the
	// mirror is only refreshed at grab time.
	const live = dragSession !== undefined ? sessionState(dragSession) : undefined
	const target = live?.origin.toolbar
	const event = slideRearmEvent
	if (!live?.isWholeToolbar || target === undefined || event === undefined) {
		disarmSlide()
		return
	}
	const node = barRegistry.elementOfToolbar(target)
	if (node instanceof HTMLElement) node.style.transform = ''
	slideDelta = undefined
	slideQueued = false
	const region = regionOfToolbar(target)
	if (region === undefined) {
		disarmSlide()
		return
	}
	armSlide(target, region, event, {
		recenter: slideGrabOffset === undefined,
	})
}

function applyDragChrome(): void {
	if (dragSession === undefined) return
	const root = ideRootRef.value
	if (!(root instanceof HTMLElement)) return
	root.classList.add('dragging')
	root.dataset.dragging = 'true'
	for (const node of root.querySelectorAll('.toolbar[data-dragged]')) {
		if (node instanceof HTMLElement) delete node.dataset.dragged
	}
	const dragged = (dragSession as unknown as { draggedToolbar?: Toolbar }).draggedToolbar
	if (dragged === undefined) return
	const node = barRegistry.elementOfToolbar(dragged)
	if (node instanceof HTMLElement) node.dataset.dragged = 'true'
}

function clearDragChrome(): void {
	const root = ideRootRef.value
	if (root instanceof HTMLElement) {
		root.classList.remove('dragging')
		delete root.dataset.dragging
		for (const node of root.querySelectorAll('.toolbar[data-dragged]')) {
			if (node instanceof HTMLElement) delete node.dataset.dragged
		}
	}
}

function endToolDrag(): void {
	dragSession?.end()
	disarmSlide()
	dragSession = undefined
	draggingState = undefined
	slideGrabOffset = undefined
	slideItemGrab = undefined
	hoveredTrackSpace = undefined
	hoveredTrackRef = undefined
	maskLitRegions.clear()
	panelMaskLit = false
	appliedHighlights.clear()
	clearDragChrome()
	const root = ideRootRef.value
	if (root instanceof HTMLElement) clearGapClasses(root)
}

function startToolDrag(event: PointerEvent, toolbar: Toolbar, item: ToolbarItem): void {
	if (dragSession) return
	if (event.button !== 0) return
	if (isEditableTarget(event.target)) return
	if (!editing.value) return
	event.preventDefault()
	const grabTarget = event.currentTarget
	const buttonNode = grabTarget instanceof HTMLElement ? barRegistry.elementOfItem(item) : undefined
	const buttonBox = buttonNode ?? grabTarget
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
		dragSession = props.core.layout.createDrag({ kind: 'tool', toolbar, item })
		draggingState = sessionState(dragSession)
		dragSession.subscribe(applySessionEvent)
	} catch {
		dragSession = undefined
		draggingState = undefined
		return
	}
	const guard = event.currentTarget
	if (guard instanceof HTMLElement && guard.hasPointerCapture?.(event.pointerId)) {
		try {
			guard.releasePointerCapture(event.pointerId)
		} catch {
			// Already released.
		}
	}
	applyDragChrome()
	if (draggingState.isWholeToolbar) {
		const regionEl = (event.currentTarget as HTMLElement | null)?.closest?.('.toolbar-border')
		const regionName = regionEl?.getAttribute?.('data-region') as PaletteRegion | null
		if (regionName) armSlide(draggingState.origin.toolbar, regionName, event)
	}
	startDragSession({ event, onMove: () => {}, onStop: () => endToolDrag() })
}

function startToolbarDrag(event: PointerEvent, toolbar: Toolbar, region: PaletteRegion): void {
	if (dragSession) return
	if (event.button !== 0) return
	if (isEditableTarget(event.target)) return
	if (!editing.value) return
	if ((event.target as HTMLElement | null)?.closest?.('.toolbar-item')) return
	event.preventDefault()
	try {
		dragSession = props.core.layout.createDrag({ kind: 'toolbar', toolbar })
		draggingState = sessionState(dragSession)
		dragSession.subscribe(applySessionEvent)
	} catch {
		dragSession = undefined
		draggingState = undefined
		return
	}
	if (event.target instanceof HTMLElement && event.target.hasPointerCapture?.(event.pointerId)) {
		try {
			event.target.releasePointerCapture(event.pointerId)
		} catch {
			// Already released.
		}
	}
	applyDragChrome()
	armSlide(draggingState.origin.toolbar, region, event)
	startDragSession({ event, onMove: () => {}, onStop: () => endToolDrag() })
}

function startCatalogDrag(event: PointerEvent, item: ToolbarItem): void {
	if (dragSession) return
	if (event.button !== 0) return
	if (isEditableTarget(event.target)) return
	if (!editing.value) return
	event.preventDefault()
	slideItemGrab = undefined
	dragSession = props.core.layout.createDrag({ kind: 'catalog', item })
	draggingState = sessionState(dragSession)
	dragSession.subscribe(applySessionEvent)
	if (event.target instanceof HTMLElement && event.target.hasPointerCapture?.(event.pointerId)) {
		try {
			event.target.releasePointerCapture(event.pointerId)
		} catch {
			// Already released.
		}
	}
	applyDragChrome()
	startDragSession({ event, onMove: () => {}, onStop: () => endToolDrag() })
}

function toHoverable(target: HTMLElement, bar: HTMLElement): Hoverable | null {
	if (target.closest('.toolbar') !== bar) return null
	const spaceEl = target.closest('[data-item-space-index]')
	if (spaceEl && bar.contains(spaceEl)) {
		const index = Number((spaceEl as HTMLElement).dataset.itemSpaceIndex)
		if (!Number.isInteger(index)) return null
		const toolbar = toolbarOfBar(bar) ?? toolbarAtElement(bar)
		if (!toolbar) return null
		return { kind: 'item-gap', toolbar, gap: index }
	}
	const itemEl = target.closest('[data-item-index]')
	if (itemEl && bar.contains(itemEl)) {
		const toolbar = toolbarOfBar(bar) ?? toolbarAtElement(bar)
		const active = Number((itemEl as HTMLElement).dataset.itemIndex)
		if (!toolbar || !Number.isInteger(active)) return null
		const item = toolbar[active]
		if (!item) return null
		return { kind: 'tool', toolbar, item }
	}
	return null
}

function overItemGap(session: ToolbarDrag, toolbar: Toolbar, gap: number, event: PointerEvent): void {
	slideRearmEvent = event
	session.over({ kind: 'item-gap', toolbar, gap }, pointerSample(event))
	slideRearmEvent = undefined
}

function paintItemSpaces(
	toolbar: Toolbar,
	activeItem: number | undefined,
	hovered: number | undefined,
	event: PointerEvent
): void {
	const session = dragSession
	if (!editing.value || !session) {
		session?.over(null, pointerSample(event))
		return
	}
	if (hovered === undefined && activeItem === undefined) {
			session.over({ kind: 'toolbar', toolbar }, pointerSample(event))
		return
	}
	const hover: Hoverable =
		hovered !== undefined
			? { kind: 'item-gap', toolbar, gap: hovered }
			: { kind: 'toolbar', toolbar, activeItem }
	session.over(hover, pointerSample(event))
}

function outsideGapAt(borderEl: HTMLElement, border: Border, event: PointerEvent): number | undefined {
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
		spans.push(horizontal ? { start: box.top, end: box.bottom } : { start: box.left, end: box.right })
	}
	if (spans.length === 0) return 0
	return outsideGapForTrack(spans, horizontal ? event.clientY : event.clientX)
}

function closeUnrelatedDrawers(target: EventTarget | null, spare?: HTMLElement): void {
	if (!editing.value) return
	if (!(target instanceof HTMLElement)) return
	if (!target.isConnected) return
	const root = ideRootRef.value
	const doc = root?.ownerDocument ?? document
	const midDrag = dragSession !== undefined
	for (const popup of doc.querySelectorAll('.palettable-drawer__popup')) {
		if (!(popup instanceof HTMLElement) || popup.hidden) continue
		const wrapper = popup.closest('.palettable-drawer')
		if (!(wrapper instanceof HTMLElement)) continue
		if (spare !== undefined && wrapper === spare) continue
		if (midDrag) {
			if (popup.contains(target)) continue
			const itemWrapper = wrapper.closest('[data-item-index]')
			if (itemWrapper instanceof HTMLElement && itemWrapper.contains(target)) continue
			const close = (wrapper as unknown as { __closeDrawer?: () => void }).__closeDrawer
			if (typeof close === 'function') {
				close()
				continue
			}
			popup.hidden = true
			continue
		}
		if (wrapper.contains(target)) continue
		const itemWrapper = wrapper.closest('[data-item-index]')
		if (itemWrapper instanceof HTMLElement && itemWrapper.contains(target)) continue
		const close = (wrapper as unknown as { __closeDrawer?: () => void }).__closeDrawer
		if (typeof close === 'function') {
			close()
			continue
		}
		popup.hidden = true
	}
}

/** Drawer item behind a hovered node (guard reports itself — resolve via wrapper). */
function drawerItemFromGuardOrContent(candidate: HTMLElement): ToolbarItem | undefined {
	const wrapper = candidate.closest('[data-item-index]')
	if (!(wrapper instanceof HTMLElement)) return undefined
	const bar = candidate.closest('.toolbar')
	if (!(bar instanceof HTMLElement) || !bar.contains(wrapper)) return undefined
	const toolbar = toolbarOfBar(bar)
	if (toolbar === undefined) return undefined
	const index = Number(wrapper.dataset.itemIndex)
	if (!Number.isInteger(index)) return undefined
	const item = toolbar[index]
	if (item === undefined) return undefined
	if ((item as { control?: unknown }).control !== 'drawer') return undefined
	return item
}

/** Drawer item under the cursor scoped to `bar` (position-based, no reverse lookup). */
function drawerItemOfTarget(target: HTMLElement, bar: HTMLElement): ToolbarItem | undefined {
	const itemEl = target.closest('[data-item-index]')
	if (!(itemEl instanceof HTMLElement) || !bar.contains(itemEl)) return undefined
	const toolbar = toolbarOfBar(bar)
	if (toolbar === undefined) return undefined
	const index = Number(itemEl.dataset.itemIndex)
	if (!Number.isInteger(index)) return undefined
	const item = toolbar[index]
	if (item === undefined) return undefined
	if ((item as { control?: unknown }).control !== 'drawer') return undefined
	return item
}

function contextFor(
	region: PaletteRegion,
	toolbar: Toolbar,
	item: ToolbarItem,
	_itemIndex: number
): HeadContext {
	return {
		core: props.core,
		item,
		surface: surfaceForRegion(region),
		region,
		strings: strings.value,
		display: display.value,
		iconResolver: props.iconResolver,
		theme: themeSetting.value,
		onOpenConsole: (mode) => props.consoleStore.open(mode),
		onInspect: () => {
			inspected.value = item
		},
		isEditing: () => editing.value,
		isDragging: () => dragActive.value,
		onOpenDrawer: (drawerItem) => {
			openDrawerItems.add(drawerItem)
		},
		onCloseDrawer: (drawerItem) => {
			openDrawerItems.delete(drawerItem)
		},
		closeUnrelatedDrawers: (target) => closeUnrelatedDrawers(target),
		onDrawerPointermove: (event) => onDrawerPointermove(event),
		onDrawerPointerover: (event) => onDrawerPointerover(event),
	}
}

function findToolbarOf(live: ReturnType<PaletteCore['layout']['getLayout']>, item: ToolbarItem): Toolbar | undefined {
	for (const region of ['top', 'right', 'bottom', 'left'] as const) {
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

function locationOfItem(item: ToolbarItem): import('@palettable/core').ItemLocation | undefined {
	const liveLayout = props.core.layout.getLayout()
	for (const region of ['top', 'right', 'bottom', 'left'] as const) {
		const border = liveLayout.borders[region]
		for (let trackIndex = 0; trackIndex < border.length; trackIndex += 1) {
			const track = border[trackIndex]!
			for (let slotIndex = 0; slotIndex < track.length; slotIndex += 1) {
				const toolbar = track[slotIndex]?.toolbar
				if (toolbar === undefined) continue
				const itemIndex = toolbar.indexOf(item)
				if (itemIndex >= 0)
					return { container: 'border', region, trackIndex, toolbarIndex: slotIndex, itemIndex }
			}
		}
	}
	for (let toolbarIndex = 0; toolbarIndex < liveLayout.parking.length; toolbarIndex += 1) {
		const toolbar = liveLayout.parking[toolbarIndex]!
		const itemIndex = toolbar.indexOf(item)
		if (itemIndex >= 0) return { container: 'parking', toolbarIndex, itemIndex }
	}
	return undefined
}

function patchLive(item: ToolbarItem, apply: (target: ToolbarItem) => void): void {
	if (findToolbarOf(props.core.layout.getLayout(), item) === undefined) return
	apply(item)
	bump()
}

function onDeleteInspected(): void {
	if (inspected.value === undefined) return
	const from = locationOfItem(inspected.value)
	if (from === undefined) return
	props.core.layout.moveItem(from, undefined)
	inspected.value = undefined
}

function onSelectAddEntry(entry: AddableEntry): void {
	props.consoleStore.patch({ selectedEntryId: entry.id })
	bump()
}

function onClearInspecting(): void {
	inspected.value = undefined
}

function onToggleMode(): void {
	const snapshot = props.consoleStore.snapshot
	props.consoleStore.open(snapshot.mode === 'edit' ? 'run' : 'edit')
}

function onPreviewPointerdown(event: PointerEvent, item: ToolbarItem): void {
	startCatalogDrag(event, item)
}

const consoleOpen = computed(() => {
	void layoutRevision.value
	return props.consoleStore.snapshot.open
})

function onInspect(item: ToolbarItem): void {
	inspected.value = item
}

/** Guard grab: resolve the live toolbar + item from the pointer at grab time.
 * The guard emits only the event (no toolbar/item props): a bubbled
 * `pointerdown` can race a structural commit, so render-time props may
 * already be stale. The wrapper's `data-item-index` + the bar registry
 * pin the live objects; a drawer-child guard resolves through the drawer
 * path. (Vanilla closes over render-time values via `makeGuard(resolve)`
 * — safe there because the node map re-syncs synchronously in the commit
 * pass; the declarative adapter must look up live instead.)
 */
function onGuardPointerdown(event: PointerEvent): void {
	const target = event.target
	if (!(target instanceof HTMLElement)) return
	const wrapper = target.closest('[data-item-index]')
	if (!(wrapper instanceof HTMLElement)) return
	const itemIndex = Number(wrapper.dataset.itemIndex)
	if (!Number.isInteger(itemIndex)) return
	const bar = wrapper.closest('.toolbar')
	if (!(bar instanceof HTMLElement)) return
	const toolbar = toolbarOfBar(bar) ?? toolbarAtElement(bar)
	if (toolbar === undefined) return
	const item = toolbar[itemIndex]
	if (item === undefined) return
	inspected.value = item
	startToolDrag(event, toolbar, item)
}

function onBarPointerdown(event: PointerEvent, toolbar: Toolbar, region: PaletteRegion): void {
	startToolbarDrag(event, toolbar, region)
}

function onBarPointerover(event: PointerEvent, toolbar: Toolbar): void {
	void toolbar
	const target = event.target
	if (target instanceof HTMLElement && target.closest('.palettable-drawer__popup')) return
	if (target instanceof HTMLElement && target.closest('.toolbar')) {
		const openedDrawer = maybeOpenDrawerAt(event)
		closeUnrelatedDrawers(event.target, openedDrawer ?? undefined)
		return
	}
	if (dragSession !== undefined) return
	closeUnrelatedDrawers(event.target)
}

function onBarPointermove(event: PointerEvent, toolbar: Toolbar): void {
	const session = dragSession
	if (!session) return
	// Track-gap hovers bubble through nested bars: the track listener
	// (`onTrackPointermove`) owns them with an idempotency memo (the fresh
	// toolbar sits under the pointer after a commit — re-committing would
	// build a second toolbar for the same gap). The bar handler must not
	// re-emit them: its coordinate hit-test would resolve the same gap
	// through a stale toolbar object and commit a duplicate extraction.
	// Vanilla's bar listener never sees track gaps (separate elements, no
	// bubbling overlap); here the track nests the bars, so guard on the
	// COORDINATE hit-test (not `event.target`, which the redispatch path
	// may have frozen on the grab guard): when the element under the
	// pointer is a track gap outside any bar, this handler owns nothing.
	const under = coordinateTarget(event)
	if (under instanceof HTMLElement) {
		const gapEl = under.closest('[data-track-space-index]')
		if (gapEl instanceof HTMLElement && under.closest('.toolbar') === null) return
	}
	// Stale-prop guard: the emitted `toolbar` prop may predate the latest
	// structural commit (same component instance, updated prop racing the
	// bubbled event). Resolve the live toolbar from the element under the
	// pointer; the prop is only the fallback for position-based events.
	// A hover that reaches a bar neutralizes the mask the same way a
	// track-gap hover does (see onTrackPointermove): mask bits are
	// paint-only and must never outlive the session diff.
	paintMask(false)
	paintPanelMask(false)
	const openedDrawer = maybeOpenDrawerAt(event)
	closeUnrelatedDrawers(under ?? event.target, openedDrawer ?? undefined)
	const target = under ?? (event.target instanceof HTMLElement ? event.target : undefined)
	if (!(target instanceof HTMLElement)) return
	// Drawer-child bars route through the drawer handler (drawer-gap commit
	// path) — the border item-gap path would misroute them.
	if (target.closest('[data-drawer-track]')) {
		onDrawerPointermove(event)
		return
	}
	if (target.closest('.palettable-drawer__popup')) return
	const liveBar = target.closest('.toolbar')
	if (!(liveBar instanceof HTMLElement)) return
	// Live-first resolution (see `toolbarOfBar`): the registry is re-synced
	// on every structural commit, so it already points at the fresh bar;
	// the prop fallback covers the pre-mount window only.
	const liveToolbar = toolbarOfBar(liveBar) ?? toolbarAtElement(liveBar) ?? toolbar
	if (liveToolbar === undefined) return
	const hoveredDrawerItem = drawerItemOfTarget(target, liveBar)
	if (hoveredDrawerItem !== undefined) {
		const drawerActive = liveToolbar.indexOf(hoveredDrawerItem)
		paintItemSpaces(liveToolbar, drawerActive >= 0 ? drawerActive : undefined, undefined, event)
		return
	}
	const guardItem = target.closest('.toolbar-item-guard')
	if (guardItem instanceof HTMLElement) {
		const wrapper = guardItem.closest('[data-item-index]')
		const active = wrapper && liveBar.contains(wrapper) ? Number((wrapper as HTMLElement).dataset.itemIndex) : undefined
		if (Number.isInteger(active)) {
			const item = liveToolbar[active as number]
			if (item !== undefined) {
				paintItemSpaces(liveToolbar, active as number, undefined, event)
				return
			}
		}
	}
	const hover = liveBar === event.currentTarget || true ? toHoverable(target, liveBar) : null
	if (hover === null) {
		const itemEl = target.closest('[data-item-index]')
		const active = itemEl && liveBar.contains(itemEl) ? Number((itemEl as HTMLElement).dataset.itemIndex) : undefined
		paintItemSpaces(liveToolbar, Number.isInteger(active) ? (active as number) : undefined, undefined, event)
		return
	}
	if (hover.kind !== 'item-gap') {
		if (hover.kind !== 'tool') return
		const active = liveToolbar.indexOf(hover.item)
		paintItemSpaces(liveToolbar, active >= 0 ? active : undefined, undefined, event)
		return
	}
	overItemGap(session, liveToolbar, hover.gap, event)
}

function coordinateTarget(event: PointerEvent): HTMLElement | null {
	if (event.clientX === undefined || event.clientY === undefined) return null
	const root = ideRootRef.value
	const doc = root?.ownerDocument ?? document
	if (typeof doc.elementFromPoint !== 'function') return null
	const under = doc.elementFromPoint(event.clientX, event.clientY)
	return under instanceof HTMLElement ? under : null
}

function maybeOpenDrawerAt(event: PointerEvent): HTMLElement | null {
	if (!editing.value) return null
	const under = coordinateTarget(event)
	const candidates: HTMLElement[] = []
	if (under) candidates.push(under)
	if (event.target instanceof HTMLElement && event.target !== under) candidates.push(event.target)
	for (const candidate of candidates) {
		const item = drawerItemFromGuardOrContent(candidate)
		if (item === undefined) continue
		const itemNode = barRegistry.elementOfItem(item)
		const wrapper =
			itemNode instanceof HTMLElement
				? (itemNode.querySelector('.palettable-drawer') ?? itemNode.closest('.palettable-drawer'))
				: candidate.closest('.palettable-drawer')
		if (!(wrapper instanceof HTMLElement)) continue
		wrapper.dispatchEvent(new CustomEvent('palettable-drawer-drag-hover', { detail: item, bubbles: true }))
		return wrapper
	}
	return null
}

function onBorderPointermove(event: PointerEvent, border: Border): void {
	const session = dragSession
	if (!session) return
	// Track-gap hovers bubble: the track listener owns them (see the bar
	// guard above) — the border handler must not re-emit them through a
	// possibly-stale track object. Guard on the coordinate hit-test (not
	// `event.target`, frozen on the grab guard by the redispatch path).
	const underPre = coordinateTarget(event)
	if (underPre instanceof HTMLElement) {
		const gapEl = underPre.closest('[data-track-space-index]')
		if (gapEl instanceof HTMLElement) return
	}
	const target = underPre ?? (event.target instanceof HTMLElement ? event.target : undefined)
	if (!(target instanceof HTMLElement)) return
	if (target.closest('.palettable-drawer__popup')) return
	if (target.closest('.toolbar')) return
	const root = ideRootRef.value
	const borderEl = (event.currentTarget instanceof HTMLElement ? event.currentTarget : target.closest('.toolbar-border')) as HTMLElement | null
	if (!(borderEl instanceof HTMLElement) || (root instanceof HTMLElement && !root.contains(borderEl))) return
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
		if (!Number.isInteger(index)) return
		session.over({ kind: 'stack-gap', border, gap: index }, pointerSample(event))
		return
	}
	const outside = outsideGapAt(borderEl, border, event)
	if (outside !== undefined) {
		session.over({ kind: 'outside', border, gap: outside }, pointerSample(event))
	}
}

function onBorderPointerleave(event: PointerEvent): void {
	dragSession?.over(null, pointerSample(event))
}

function onParkingPointermove(event: PointerEvent): void {
	const session = dragSession
	if (!session) return
	const target = coordinateTarget(event) ?? (event.target instanceof HTMLElement ? event.target : undefined)
	if (!(target instanceof HTMLElement)) return
	const liveLayout = props.core.layout.getLayout()
	const parking = liveLayout.parking
	paintPanelMask(false)
	// Inside a row toolbar → that toolbar owns the item DZs (vanilla
	// returns here — the bar handler owns the hover via bubbling).
	if (target.closest('.toolbar')) return
	const gapEl = target.closest('[data-parking-gap-index]')
	if (gapEl) {
		const index = Number((gapEl as HTMLElement).dataset.parkingGapIndex)
		if (!Number.isInteger(index)) return
		session.over({ kind: 'parking-gap', parking, gap: index }, pointerSample(event))
		return
	}
	const rowEl = target.closest('[data-parking-row-index]')
	if (rowEl) {
		const rowIndex = Number((rowEl as HTMLElement).dataset.parkingRowIndex)
		if (!Number.isInteger(rowIndex)) return
		const rowToolbar = parking[rowIndex]
		if (rowToolbar === undefined) return
		const item = rowToolbar[0]
		if (item === undefined) {
			session.over({ kind: 'parking-gap', parking, gap: rowIndex }, pointerSample(event))
			return
		}
		session.over({ kind: 'tool', toolbar: rowToolbar, item }, pointerSample(event))
		return
	}
	// Stack background: project onto the nearest rendered parking gap.
	const root = ideRootRef.value
	const stack = root?.querySelector('.palette-parking')
	if (!(stack instanceof HTMLElement)) return
	const gaps: { readonly gap: number; readonly top: number }[] = []
	for (const node of stack.querySelectorAll(':scope > [data-parking-gap-index]')) {
		if (!(node instanceof HTMLElement)) continue
		const gap = Number(node.dataset.parkingGapIndex)
		if (!Number.isInteger(gap)) continue
		gaps.push({ gap, top: node.getBoundingClientRect().top })
	}
	if (gaps.length === 0) return
	let best = gaps[0]!
	for (const candidate of gaps) {
		if (Math.abs(event.clientY - candidate.top) < Math.abs(event.clientY - best.top)) {
			best = candidate
		}
	}
	session.over({ kind: 'parking-gap', parking, gap: best.gap }, pointerSample(event))
}

/** Panel background (outside parking rows/gaps/popups): paint the parking end gap. */
function isPanelBackground(target: HTMLElement): boolean {
	const panel = target.closest('.palette-default-command-panel')
	if (!(panel instanceof HTMLElement)) return false
	if (target.closest('.palette-parking')) return false
	if (target.closest('.palettable-drawer__popup, dialog')) return false
	return true
}

function onPanelPointermove(event: PointerEvent): void {
	if (!editing.value || dragSession === undefined || draggingState === undefined) {
		paintPanelMask(false)
		return
	}
	// Coordinate hit-test (same implicit-capture reason as the bar/stack
	// handlers): `event.target` may freeze on the grab guard while the
	// cursor is over the panel, and the background check below would then
	// misroute. Vanilla's `overPanelBackground` has the same shape but
	// reads `event.target` directly (no capture issue there — its window
	// listeners don't retarget); here the redispatch path needs the live
	// element.
	const target = coordinateTarget(event) ?? (event.target instanceof HTMLElement ? event.target : undefined)
	if (!(target instanceof HTMLElement) || !isPanelBackground(target)) {
		paintPanelMask(false)
		return
	}
	paintPanelMask(true)
}

function onPanelPointerleave(event: PointerEvent): void {
	paintPanelMask(false)
	dragSession?.over(null, pointerSample(event))
}

function onParkingPointerleave(event: PointerEvent): void {
	dragSession?.over(null, pointerSample(event))
}

/** Resolve the live `Track` behind a rendered `.toolbar-track` node. */
function trackOfElement(trackEl: HTMLElement): Track | undefined {
	// The DOM stamps the live track index (`BorderStack` passes
	// `orderedIndices[position - 1]`, a live index, as `track-index`),
	// so it indexes the live border directly — no render-order mapping.
	const trackIndex = Number(trackEl.dataset.trackIndex)
	if (!Number.isInteger(trackIndex)) return undefined
	const borderEl = trackEl.closest('.toolbar-border')
	if (!(borderEl instanceof HTMLElement)) return undefined
	const region = borderEl.dataset.region as PaletteRegion | undefined
	if (region === undefined) return undefined
	const live = props.core.layout.getLayout()
	return live.borders[region]?.[trackIndex]
}

function onTrackPointermove(event: PointerEvent, track: Track, _trackIndex: number): void {
	const session = dragSession
	if (!session) return
	const under = coordinateTarget(event)
	const target = under ?? (event.target instanceof HTMLElement ? event.target : undefined)
	if (!(target instanceof HTMLElement)) return
	// Inside a toolbar → that toolbar owns the perpendicular DZs.
	// Keep the memo (vanilla `hoveredTrackSpace` discipline): after a
	// commit the fresh toolbar sits under the pointer, and clearing here
	// would re-arm the same gap on the next move (duplicate toolbar).
	// Stale-prop guard: the emitted `track` may predate the latest
	// structural commit (the commit splices a fresh track array while the
	// component instance keeps the old prop). Resolve the live track by
	// identity — the gap element's own track beats the stale prop.
	if (target.closest('.toolbar')) return
	const spaceEl = target.closest('[data-track-space-index]')
	if (!spaceEl) {
		hoveredTrackSpace = undefined
		return
	}
	const index = Number((spaceEl as HTMLElement).dataset.trackSpaceIndex)
	if (!Number.isInteger(index)) {
		hoveredTrackSpace = undefined
		return
	}
	// Any true track/stack/outside hover clears the center mask + panel
	// hover paints: the mask is paint-only (never via the session), so a
	// stale mask bit would outlive the session highlight diff and read as
	// a phantom lit gap.
	paintMask(false)
	paintPanelMask(false)
	// Idempotency memo: same gap = no-op (the fresh toolbar sits under
	// the pointer after a commit — re-committing would build a second
	// toolbar for the same gap). Keyed on the gap element's track
	// identity, so a stale prop from a pre-commit render can never
	// re-arm a gap the live layout already consumed.
	const gapTrackEl = spaceEl.closest('.toolbar-track')
	const gapTrack = gapTrackEl instanceof HTMLElement ? trackOfElement(gapTrackEl) : undefined
	const liveTrack = gapTrack ?? track
	if (hoveredTrackSpace === index && hoveredTrackRef === liveTrack) return
	hoveredTrackSpace = index
	hoveredTrackRef = liveTrack
	slideRearmEvent = event
	session.over({ kind: 'track-gap', track: liveTrack, gap: index }, pointerSample(event))
	slideRearmEvent = undefined
}

function onTrackPointerleave(event: PointerEvent, _track: Track, _trackIndex: number): void {
	// Leaving the track element clears the memo (vanilla `pointerleave`);
	// the bubbling bar/track nesting means a move between two bars inside
		// the same track must NOT clear: only a true leave (target ===
	// currentTarget) resets. A cleared memo re-arms the same gap on the
	// next move (duplicate toolbar).
	if (event.target !== event.currentTarget) return
	hoveredTrackSpace = undefined
	hoveredTrackRef = undefined
}

/** Drawer-child hover: item-gap paint + commit, same session path as borders. */
function onDrawerPointermove(event: PointerEvent): void {
	const session = dragSession
	if (!session) {
		const target = event.target
		if (target instanceof HTMLElement && target.closest('.palettable-drawer__popup')) return
		closeUnrelatedDrawers(event.target)
		return
	}
	const under = coordinateTarget(event)
	closeUnrelatedDrawers(under ?? event.target)
	paintMask(false)
	paintPanelMask(false)
	if (!editing.value) return
	const target = under ?? (event.target instanceof HTMLElement ? event.target : undefined)
	if (!(target instanceof HTMLElement)) return
	const wrap = target.closest('[data-drawer-track]')
	if (!(wrap instanceof HTMLElement)) return
	const liveBar = target.closest('.toolbar')
	if (!(liveBar instanceof HTMLElement) || !wrap.contains(liveBar)) return
	const liveToolbar = toolbarOfBar(liveBar)
	if (liveToolbar === undefined) return
	const guardItem = target.closest('.toolbar-item-guard')
	if (guardItem instanceof HTMLElement) {
		const wrapper = guardItem.closest('[data-item-index]')
		const active = wrapper && liveBar.contains(wrapper) ? Number((wrapper as HTMLElement).dataset.itemIndex) : undefined
		if (Number.isInteger(active)) {
			const item = liveToolbar[active as number]
			if (item !== undefined) {
				paintItemSpaces(liveToolbar, active as number, undefined, event)
				return
			}
		}
	}
	const spaceEl = target.closest('[data-item-space-index]')
	if (spaceEl instanceof HTMLElement && liveBar.contains(spaceEl)) {
		const gap = Number(spaceEl.dataset.itemSpaceIndex)
		if (!Number.isInteger(gap)) return
		overItemGap(session, liveToolbar, gap, event)
		return
	}
	const itemEl = target.closest('[data-item-index]')
	const active = itemEl instanceof HTMLElement && liveBar.contains(itemEl) ? Number((itemEl as HTMLElement).dataset.itemIndex) : undefined
	paintItemSpaces(liveToolbar, Number.isInteger(active) ? (active as number) : undefined, undefined, event)
}

function onDrawerPointerover(event: PointerEvent): void {
	const target = event.target
	if (target instanceof HTMLElement && target.closest('.palettable-drawer__popup')) return
	closeUnrelatedDrawers(event.target)
}

/** Mask affordance: paint the inner end gap of each border (paint-only, never via session). */
function paintMask(active: boolean): void {
	const root = ideRootRef.value
	if (!(root instanceof HTMLElement)) return
	const liveLayout = props.core.layout.getLayout()
	for (const region of ['top', 'right', 'bottom', 'left'] as const) {
		const border = liveLayout.borders[region]
		const borderEl = root.querySelector(`.toolbar-border[data-region="${region}"]`)
		if (!(borderEl instanceof HTMLElement)) continue
		const gap = border.length
		const node = borderEl.querySelector(`:scope > [data-stack-index="${gap}"]`)
		if (!(node instanceof HTMLElement)) continue
		const emptied =
			draggingState !== undefined ? draggingEmptiesTrackIndex(draggingState, border) : undefined
		const vetoed = emptied !== undefined && (gap === emptied || gap === emptied + 1)
		if (active) {
			node.classList.toggle('highlighted', !vetoed)
			node.classList.toggle('hovered', false)
			if (!vetoed) maskLitRegions.add(region)
			else maskLitRegions.delete(region)
			continue
		}
		if (!maskLitRegions.has(region)) continue
		maskLitRegions.delete(region)
		node.classList.toggle('highlighted', false)
		node.classList.toggle('hovered', false)
	}
}

/** Panel affordance: paint the parking end gap (paint-only, never via session). */
function paintPanelMask(active: boolean): void {
	const root = ideRootRef.value
	const stack = root?.querySelector('.palette-parking')
	if (!(stack instanceof HTMLElement)) return
	const liveLayout = props.core.layout.getLayout()
	const gap = liveLayout.parking.length
	const node = stack.querySelector(`:scope > [data-parking-gap-index="${gap}"]`)
	if (!(node instanceof HTMLElement)) return
	const whole =
		draggingState !== undefined ? draggingWholeParkingRow(draggingState, liveLayout.parking) : undefined
	const vetoed = whole !== undefined && (gap === whole || gap === whole + 1)
	if (active) {
		node.classList.toggle('highlighted', !vetoed)
		node.classList.toggle('hovered', false)
		panelMaskLit = !vetoed
		return
	}
	if (!panelMaskLit) return
	panelMaskLit = false
	node.classList.toggle('highlighted', false)
	node.classList.toggle('hovered', false)
}

function onKeyDown(event: KeyboardEvent): void {
	if (event.defaultPrevented) return
	if (isEditableTarget(event.target)) return
	if (event.key === 'Escape') {
		if (props.consoleStore.snapshot.open) {
			event.preventDefault()
			props.consoleStore.close()
		}
		return
	}
	if (editing.value) return
	const keys = createVueKeys(props.core.keys)
	const runnable = keys.resolve(event)
	if (!runnable) return
	try {
		if (runnable.kind === 'inc' || runnable.kind === 'dec') {
			let can = true
			try {
				can = props.core.can(runnable)
			} catch {
				return
			}
			if (!can) return
		}
		event.preventDefault()
		event.stopPropagation()
		props.core.run(runnable)
	} catch {
		// Unresolvable bindings never break typing.
	}
}

onMounted(() => {
	window.addEventListener('keydown', onKeyDown)
})

const opsUnsub = props.core.subscribeLayoutOps(() => {
	// Skip layout-op bumps while a drag session is live: the session's own
	// `structure` events already drive `bump()` + slide re-arm in emission
	// order. A second bump from the op listener double-renders mid-gesture
	// (the dwell gap node is replaced under the pointer and the dwell
	// timer never fires). Non-drag commits (console add/delete, presets)
	// bump normally.
	if (dragSession !== undefined) return
	bump()
})
const consoleUnsub: () => void = (props.consoleStore as ConsoleStore).subscribe(() => bump())
// Context bags: key changes update tools in place via the value lens
// (no shell re-render — vanilla's `bindTool` path); identity changes
// (`setContext`/`removeContext` emit `[]`) re-resolve every tool reading
// the bag, so bump the shell then. The mission timer only writes the
// `mission` bag (status tools re-read via lens, no shell bump needed).
const contextUnsub = props.core.subscribeContext((_bagName, changed) => {
	if (changed.length > 0) return
	bump()
})
// Root store values: the value lens owns per-tool reactivity (vanilla's
// `bindTool` path) — the shell never re-renders on value writes. A full
// shell `bump()` here would rebuild every border on every timer-adjacent
// store write and destroy the drag session's hover targets mid-gesture
// (the dwell gap node is replaced, the timer never fires).
let localeUnsub: (() => void) | undefined
try {
	localeUnsub = props.core.values.subscribe(props.localePointId ?? 'locale', () => {
		syncIdeCatalogStrings(props)
		bump()
	})
} catch {
	localeUnsub = undefined
}

syncIdeCatalogStrings(props)

onBeforeUnmount(() => {
	opsUnsub()
	consoleUnsub()
	localeUnsub?.()
	contextUnsub()
	window.removeEventListener('keydown', onKeyDown)
})

defineExpose({ bump, inspected, dragActive: { get value() { return isDragLive() } } })
</script>

<template>
	<div
		ref="ideRoot"
		class="palette-ide"
		:class="{ editing }"
		:data-palette-id="paletteId"
		:data-editing="editing ? 'true' : undefined"
	>
		<BorderStack
			:border="live.borders.top"
			region="top"
			:editing="editing"
			:strings="strings"
			:context-for="(toolbar, item, itemIndex) => contextFor('top', toolbar, item, itemIndex)"
			:theme-enabled="themeEnabled"
			:inspected-item="inspected"
			@inspect="onInspect"
			@guard-pointerdown="onGuardPointerdown"
			@bar-pointerdown="onBarPointerdown"
			@bar-pointermove="onBarPointermove"
			@bar-pointerover="onBarPointerover"
			@border-pointermove="onBorderPointermove"
			@border-pointerleave="onBorderPointerleave"
			@track-pointermove="onTrackPointermove"
			@track-pointerleave="onTrackPointerleave"
		/>
		<div class="palette-ide-middle">
			<BorderStack
				:border="live.borders.left"
				region="left"
				:editing="editing"
				:strings="strings"
				:context-for="(toolbar, item, itemIndex) => contextFor('left', toolbar, item, itemIndex)"
				:theme-enabled="themeEnabled"
				:inspected-item="inspected"
				@inspect="onInspect"
				@guard-pointerdown="onGuardPointerdown"
				@bar-pointerdown="onBarPointerdown"
				@bar-pointermove="onBarPointermove"
				@bar-pointerover="onBarPointerover"
				@border-pointermove="onBorderPointermove"
				@border-pointerleave="onBorderPointerleave"
				@track-pointermove="onTrackPointermove"
				@track-pointerleave="onTrackPointerleave"
			/>
			<div class="palette-ide-center">
				<slot name="work-zone" />
				<ConsoleOverlay
					v-if="consoleOpen"
					:core="props.core"
					:console-store="props.consoleStore"
					:editing="editing"
					:can-edit="props.isEditable()"
					:edit-only="commandBoxPresent"
					:inspected="inspected"
					:icon-resolver="props.iconResolver"
					:icon-choices="props.iconChoices"
					:item-controls="props.itemControls"
					:theme-enabled="themeEnabled"
					:theme="themeSetting"
					:strings="strings"
					:display="display"
					:on-close="() => props.consoleStore.close()"
					:on-toggle-mode="onToggleMode"
					:on-select-add-entry="onSelectAddEntry"
					:on-clear-inspecting="onClearInspecting"
					:on-delete-inspected="onDeleteInspected"
					:patch-live="patchLive"
					@preview-pointerdown="onPreviewPointerdown"
					@panel-pointermove="onPanelPointermove"
					@panel-pointerleave="onPanelPointerleave"
				/>
				<slot name="console" />
			</div>
			<BorderStack
				:border="live.borders.right"
				region="right"
				:editing="editing"
				:strings="strings"
				:context-for="(toolbar, item, itemIndex) => contextFor('right', toolbar, item, itemIndex)"
				:theme-enabled="themeEnabled"
				:inspected-item="inspected"
				@inspect="onInspect"
				@guard-pointerdown="onGuardPointerdown"
				@bar-pointerdown="onBarPointerdown"
				@bar-pointermove="onBarPointermove"
				@bar-pointerover="onBarPointerover"
				@border-pointermove="onBorderPointermove"
				@border-pointerleave="onBorderPointerleave"
				@track-pointermove="onTrackPointermove"
				@track-pointerleave="onTrackPointerleave"
			/>
		</div>
		<BorderStack
			:border="live.borders.bottom"
			region="bottom"
			:editing="editing"
			:strings="strings"
			:context-for="(toolbar, item, itemIndex) => contextFor('bottom', toolbar, item, itemIndex)"
			:theme-enabled="themeEnabled"
			:inspected-item="inspected"
			@inspect="onInspect"
			@guard-pointerdown="onGuardPointerdown"
			@bar-pointerdown="onBarPointerdown"
			@bar-pointermove="onBarPointermove"
			@bar-pointerover="onBarPointerover"
			@border-pointermove="onBorderPointermove"
			@border-pointerleave="onBorderPointerleave"
			@track-pointermove="onTrackPointermove"
			@track-pointerleave="onTrackPointerleave"
		/>
	</div>
</template>
