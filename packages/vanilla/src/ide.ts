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
 * Drop-zone highlight arrives as per-gap `DragEvent`s from the core session;
 * no session means no paint, so hover alone never paints. Guards also inspect
 * (`pointerdown` selects for the configurator).
 */

import {
	type ActionableEntry,
	type AddableEntry,
	type AnyPoint,
	actionableEntries,
	actualTrackSpaceAt,
	addableEntries,
	axisForRegion,
	type Border,
	buttonPresenter,
	type ConsoleStore,
	canonicalItemPoint,
	configuration,
	configuratorControlCleanup,
	controlChoicesFor,
	type DerivedVariant,
	type DragEvent,
	type DraggingState,
	type DropZone,
	draggingEmptiesTrackIndex,
	draggingWholeParkingRow,
	filterCommandEntries,
	type HighlightState,
	type Hoverable,
	isActionPoint,
	isValuedPoint,
	type LayoutOp,
	type PaletteCore,
	type PaletteRegion,
	paletteDerivedVariants,
	type SlideFrame,
	type SurfaceContext,
	selectClosedLabel,
	selectPresenter,
	sliderPresenter,
	statusPresenter,
	type Toolbar,
	type ToolbarDrag,
	type ToolbarItem,
	type Track,
	themePresenter,
	togglePresenter,
	type Unsubscribe,
	validateSerializedLayout,
} from '@palettable/core'
// Side-effect import: wires `PaletteLayoutTree.prototype.createDrag`.
// TODO: understand what is happening with this wireing
import '@palettable/core'
import { itemFromAddSelection } from './add-item.js'
import { startDragSession } from './drag-session.js'
import {
	createPreviewCore,
	type IconResolver,
	liveValue,
	PREVIEW_SURFACE,
	type PreviewCore,
	readThemeSetting,
	renderHeadItem,
	resolveIcon,
	selectWatermark,
	surfaceForRegion,
	syncStatusValue,
} from './head.js'
import { clearGapClasses } from './highlight.js'
import { createVanillaKeys, isEditableTarget } from './keys.js'
import { NodeRegistry } from './nodes.js'
import { outsideGapForTrack } from './outside.js'
import { extractionGrabOffset, toolbarGrabOffset, toolbarSlideBounds } from './slide.js'
import {
	el,
	iconSpan,
	segmentedOptionShellTemplate,
	selectOptionShellTemplate,
} from './templates.js'
import { applyThemeSetting } from './theme.js'

export type IdeOptions = {
	readonly core: PaletteCore
	readonly consoleStore: ConsoleStore
	readonly isEditable: () => boolean
	/** Control-only item ids for the console add-box (`controls.item` keys). */
	readonly itemControls?: readonly string[]
	readonly paletteId?: string
	/** Optional string-glyph icon resolver (consumer-owned, e.g. the demo
	 * maps `icon:moon` via a hard-coded dictionary). Threaded into every
	 * `HeadContext`; absent = identity (emoji passthrough). */
	readonly iconResolver?: IconResolver
	/** Predefined icon choices offered by the configurator Icon row
	 * (combo suggestions — free text always stays allowed). */
	readonly iconChoices?: readonly string[]
	/** Custom Icon-row field factory: replaces the default text input when
	 * provided (demo combo + free text). Receives the current value, an
	 * `onChange` writer, and the `iconChoices` above. */
	readonly renderIconField?: IconFieldFactory
	/** Test-only geometry override for the drawer center-seeking flip
	 * (jsdom reports zero rects). Threaded into every `HeadContext` as
	 * `ideRect` / `triggerRect`. */
	readonly headContext?: {
		readonly ideRect?: { left: number; top: number; width: number; height: number }
		readonly triggerRect?: { left: number; top: number; width: number; height: number }
	}
}

/** Factory for the configurator Icon row: current value + writer +
 * predefined choices → field element. Free text must stay possible. */
export type IconFieldFactory = (options: {
	readonly value: string
	readonly onChange: (next: string) => void
	readonly choices: readonly string[]
}) => HTMLElement

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

/**
 * Insert rows for new `listOptions` entries and drop rows whose value is
 * gone, preserving open state + focus (no list rebuild). Row content
 * (icon + full-text label) follows the `renderSelect` initial render;
 * selection/disabled patching stays with the caller. Filter input + empty
 * rows (`.palette-default-select-filter*`, `.palette-default-command-empty`)
 * are never treated as option rows.
 */
function reconcileSelectRows(
	core: PaletteCore | PreviewCore,
	list: HTMLElement,
	view: ReturnType<typeof selectPresenter>,
	resolver?: IconResolver
): void {
	const wanted = new Set(view.listOptions.map((option) => option.value))
	for (const row of [...list.querySelectorAll('.palette-default-select-option')]) {
		if (!wanted.has((row as HTMLElement).dataset.value ?? '')) row.remove()
	}
	const existing = new Set(
		[...list.querySelectorAll('.palette-default-select-option')].map(
			(row) => (row as HTMLElement).dataset.value ?? ''
		)
	)
	for (const option of view.listOptions) {
		if (existing.has(option.value)) continue
		const frag = document.createElement('template')
		frag.innerHTML = selectOptionShellTemplate({
			value: option.value,
			selected: view.value === option.value,
			can: option.can,
		}).trim()
		const row = frag.content.firstElementChild
		if (!(row instanceof HTMLButtonElement)) continue
		const icon = row.querySelector('.palette-default-choice-icon')
		const text = row.querySelector('.palette-default-choice')
		if (icon instanceof HTMLElement) {
			if (option.icon === undefined) icon.remove()
			else {
				icon.hidden = false
				icon.textContent = resolveIcon(option.icon, resolver) ?? ''
			}
		}
		if (text instanceof HTMLElement) text.textContent = option.label
		row.addEventListener('click', (event) => {
			event.stopPropagation()
			void core.run(view.select(option.value))
			list.hidden = true
			const trigger = list.parentElement?.querySelector('.palette-default-select-trigger')
			trigger?.setAttribute('aria-expanded', 'false')
			list.style.top = ''
			list.style.bottom = ''
			// Reset the filter query (mirrors `closeList` in `head.ts`).
			const filter = list.querySelector(
				'.palette-default-select-filter-input'
			) as HTMLInputElement | null
			if (filter) {
				filter.value = ''
				for (const other of list.querySelectorAll('.palette-default-select-option')) {
					;(other as HTMLElement).hidden = false
				}
				const empty = list.querySelector('.palette-default-command-empty')
				if (empty instanceof HTMLElement) empty.hidden = true
			}
		})
		// The filter row (when present) is the first child; plain `append`
		// keeps new rows below it. (The empty state lives inside the filter
		// wrapper, never as a direct list child.)
		list.append(row)
	}
}

/**
 * Insert buttons for new `options` entries and drop buttons whose value is
 * gone. Button content (icon + label honoring `showText`) follows the
 * `renderSegmented` initial render; selection/disabled patching stays with
 * the caller.
 */
function reconcileSegmentedButtons(
	core: PaletteCore | PreviewCore,
	group: HTMLElement,
	view: ReturnType<typeof selectPresenter>,
	resolver?: IconResolver
): void {
	const wanted = new Set(view.options.map((option) => option.value))
	for (const button of [...group.querySelectorAll('button')]) {
		if (!wanted.has((button as HTMLElement).dataset.value ?? '')) button.remove()
	}
	const existing = new Set(
		[...group.querySelectorAll('button')].map(
			(button) => (button as HTMLElement).dataset.value ?? ''
		)
	)
	for (const option of view.options) {
		if (existing.has(option.value)) continue
		const frag = document.createElement('template')
		frag.innerHTML = segmentedOptionShellTemplate({
			value: option.value,
			selected: view.value === option.value,
			can: option.can,
		}).trim()
		const button = frag.content.firstElementChild
		if (!(button instanceof HTMLButtonElement)) continue
		button.title = option.text
		const icon = button.querySelector('.palette-default-choice-icon')
		const text = button.querySelector('.palette-default-choice')
		if (icon instanceof HTMLElement) {
			if (option.icon === undefined) icon.remove()
			else {
				icon.hidden = false
				icon.textContent = resolveIcon(option.icon, resolver) ?? ''
			}
		}
		const label = view.showText
			? option.label
			: option.icon === undefined
				? (option.label ?? option.value)
				: undefined
		if (text instanceof HTMLElement) {
			if (label === undefined) text.remove()
			else {
				text.hidden = false
				text.textContent = label
			}
		}
		button.addEventListener('click', () => core.run(view.select(option.value)))
		group.append(button)
	}
}

/** Resolve the point id a tool item binds (canonical spec id). */
function pointIdOf(item: ToolbarItem): string | undefined {
	const id = canonicalItemPoint(item)
	return id === '' ? undefined : id
}

/** Re-run the presenter view-model and patch the live DOM node in place. */
function updateToolNode(
	core: PaletteCore | PreviewCore,
	item: ToolbarItem,
	surface: SurfaceContext,
	node: HTMLElement,
	resolver?: IconResolver
): void {
	const control = (item as { control?: unknown }).control
	const pointId = pointIdOf(item)
	const point = pointId !== undefined ? core.getDefinition(pointId) : undefined
	const value = liveValue(core, point)
	const bags = core.resolveBags(point?.uses)
	switch (control) {
		case 'toggle': {
			const view = togglePresenter(item, { point, value, bags })
			const button = node.querySelector('button')
			if (!button) return
			button.disabled = !view.can
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
			const closedLabel = selectClosedLabel(view)
			const trigger = node.querySelector('.palette-default-select-trigger')
			// Icons nest inside the value chip (tool icon + value icon, like
			// numerics), so only the label node carries the text — rewriting
			// textContent would destroy the icons.
			const chip = node.querySelector('.palette-default-select-value')
			// Vertical: the closed label is a direct child of the trigger,
			// sibling of the icon chip (segmented pattern); horizontal keeps
			// it inside the chip.
			const labelParent =
				view.direction === 'vertical' && trigger instanceof HTMLButtonElement ? trigger : chip
			if (chip) {
				chip.classList.toggle('is-icon-only', closedLabel === undefined && !view.isSkeleton)
				const resolvedToolIcon = resolveIcon(view.toolIcon, resolver)
				const resolvedValueIcon = resolveIcon(view.icon, resolver)
				const toolIconNode = chip.querySelector('.palette-default-tool-icon')
				if (resolvedToolIcon === undefined) {
					toolIconNode?.remove()
				} else if (toolIconNode) {
					if (toolIconNode.textContent !== resolvedToolIcon)
						toolIconNode.textContent = resolvedToolIcon
				} else {
					const toolIcon = el('span', 'palette-default-icon palette-default-tool-icon')
					toolIcon.textContent = resolvedToolIcon
					chip.prepend(toolIcon)
				}
				// Value icon mirrors the tool-icon remove/re-create pattern:
				// absent means the node goes away (no reserved space).
				const iconNode = chip.querySelector('.palette-default-value-icon')
				if (resolvedValueIcon === undefined) {
					iconNode?.remove()
				} else if (iconNode) {
					if (iconNode.textContent !== resolvedValueIcon) iconNode.textContent = resolvedValueIcon
				} else {
					const valueIcon = el('span', 'palette-default-icon palette-default-value-icon')
					valueIcon.textContent = resolvedValueIcon
					chip.append(valueIcon)
				}
				const labelScope = labelParent ?? chip
				// Skeleton watermark vs closed label: disjoint selectors so
				// the two never match each other across transitions.
				const labelNode = labelScope.querySelector(':scope > .palette-default-choice')
				const watermarkNode = labelScope.querySelector(':scope > .palette-default-select-watermark')
				if (view.isSkeleton) {
					labelNode?.remove()
					if (!watermarkNode) labelScope.append(selectWatermark())
				} else if (closedLabel === undefined) {
					labelNode?.remove()
					watermarkNode?.remove()
				} else if (labelNode) {
					watermarkNode?.remove()
					if (labelNode.textContent !== closedLabel) labelNode.textContent = closedLabel
					// A direction flip (horizontal ↔ vertical) moves the label
					// node to its axis-home without rebuilding the trigger.
					if (labelNode.parentElement !== labelScope) labelScope.append(labelNode)
				} else {
					watermarkNode?.remove()
					const text = document.createElement('span')
					text.className = 'palette-default-choice'
					text.textContent = closedLabel
					labelScope.append(text)
				}
			}
			// Rows always render full text: match on `data-value` (stable
			// identity), not rendered text. Preserve the open state + focus —
			// reconcile rows in place (insert new, drop stale) instead of
			// rebuilding the list mid-interaction.
			const list = node.querySelector('.palette-default-select-list')
			if (list instanceof HTMLElement && trigger instanceof HTMLButtonElement) {
				const wasOpen = !list.hidden
				reconcileSelectRows(core, list, view, resolver)
				for (const row of list.querySelectorAll('.palette-default-select-option')) {
					const spec = view.listOptions.find(
						(entry) => entry.value === (row as HTMLElement).dataset.value
					)
					if (!spec) continue
					row.classList.toggle('is-selected', view.value === spec.value)
					row.setAttribute('aria-selected', view.value === spec.value ? 'true' : 'false')
					if (row instanceof HTMLButtonElement) row.disabled = !spec.can || !view.can
				}
				list.hidden = !wasOpen
				trigger.setAttribute('aria-expanded', wasOpen ? 'true' : 'false')
			}
			if (trigger instanceof HTMLButtonElement) trigger.disabled = !view.can
			const box = node.classList.contains('palette-default-select') ? node : null
			if (box) box.title = view.title
			return
		}
		case 'segmented': {
			const view = selectPresenter(item, { point, value, bags }, surface)
			const group =
				node.classList.contains('palette-default-segmented') && node instanceof HTMLElement
					? node
					: (node.querySelector('.palette-default-segmented') as HTMLElement | null)
			if (group) reconcileSegmentedButtons(core, group, view, resolver)
			const buttons = node.querySelectorAll('button')
			buttons.forEach((button) => {
				// Match on `data-value` (stable identity), not rendered text:
				// the label node is split and may be hidden per axis.
				const spec = view.options.find(
					(entry) => entry.value === (button as HTMLElement).dataset.value
				)
				if (!spec) return
				button.classList.toggle('is-selected', view.value === spec.value)
				button.disabled = !spec.can || !view.can || view.value === spec.value
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
				if (button instanceof HTMLButtonElement) button.disabled = !view.can
			})
			return
		}
		case 'slider':
		case 'drawerSlider': {
			const view = sliderPresenter(item, { point, value, bags }, surface)
			// The readout always follows the model — including mid-drag, which
			// is when it matters most: the pointer focuses the range, so a
			// guard placed before this would leave the number stale while the
			// user drags.
			const readout = node.querySelector('.palette-default-slider-value')
			// The icon nests inside the readout (mirroring the stepper chip),
			// so only the text node carries the value — rewriting textContent
			// would destroy the icon. With `showValue: false` the chip is
			// icon-only: drop any text nodes instead of updating them.
			if (readout) {
				if (!view.showValue) {
					for (const child of [...readout.childNodes]) {
						if (child.nodeType === Node.TEXT_NODE) child.remove()
					}
				} else {
					let updated = false
					readout.childNodes.forEach((child) => {
						if (child.nodeType === Node.TEXT_NODE) {
							child.textContent = view.text
							updated = true
						}
					})
					if (!updated) readout.append(document.createTextNode(view.text))
				}
			}
			const input = node.querySelector('input[type="range"]')
			if (!(input instanceof HTMLInputElement)) return
			input.disabled = !view.can
			// Guard: keep a dragged thumb alive — never rewrite the *value*
			// while focused, or the thumb fights the pointer.
			if (document.activeElement === input) return
			const next = String(view.value ?? view.min)
			if (input.value !== next) input.value = next
			return
		}
		case 'stepper': {
			const view = sliderPresenter(item, { point, value, bags }, surface)
			const buttons = node.querySelectorAll('button')
			const readout = node.querySelector('.palette-default-stepper-value')
			const minus = buttons[0]
			const plus = buttons[1]
			if (minus instanceof HTMLButtonElement)
				minus.disabled = !view.can || view.value === undefined || view.value - view.step < view.min
			if (plus instanceof HTMLButtonElement)
				plus.disabled = !view.can || view.value === undefined || view.value + view.step > view.max
			if (readout) {
				readout.childNodes.forEach((child) => {
					if (child.nodeType === Node.TEXT_NODE) child.textContent = String(view.value)
				})
			}
			return
		}
		case 'status': {
			const view = statusPresenter(item, { point, value, bags }, surface)
			syncStatusValue(node, view.value)
			if (view.can) node.removeAttribute('aria-disabled')
			else node.setAttribute('aria-disabled', 'true')
			return
		}
		case 'button': {
			const pointId = pointIdOf(item) ?? ''
			const can = point !== undefined && isActionPoint(point) ? core.evaluateCan(point.id) : true
			const view = buttonPresenter(
				item,
				{ point, value: undefined, bags },
				{ kind: 'action', point: pointId },
				can
			)
			const button = node.querySelector('button')
			if (!(button instanceof HTMLButtonElement)) return
			button.disabled = !view.can
			button.title = view.title
			return
		}
		case 'theme': {
			const view = themePresenter(item, { point, value: readThemeSetting(), bags })
			const button = node.querySelector('button')
			if (button instanceof HTMLButtonElement) {
				button.title = view.title
				button.disabled = point === undefined
				const icon = button.querySelector('.palette-default-icon')
				const resolvedValueIcon = resolveIcon(view.valueIcon, resolver)
				if (icon instanceof HTMLElement) {
					if (resolvedValueIcon === undefined) icon.hidden = true
					else {
						icon.hidden = false
						if (icon.textContent !== resolvedValueIcon) icon.textContent = resolvedValueIcon
					}
				}
			}
			if (point !== undefined && typeof document !== 'undefined') {
				applyThemeSetting(document.documentElement, view.value ?? readThemeSetting())
			}
			return
		}
		default:
			return
	}
}

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
					const id = pointIdOf(item)
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

/** Vanilla head capability registry for the configurator control choices. */
const VANILLA_CONTROL_REGISTRY = {
	boolean: {
		toggle: { id: 'toggle', label: 'Toggle', families: ['boolean'] as const },
	},
	enum: {
		select: { id: 'select', label: 'Select', families: ['enum'] as const },
		segmented: { id: 'segmented', label: 'Segmented', families: ['enum'] as const },
	},
	number: {
		slider: { id: 'slider', label: 'Slider', families: ['number'] as const },
		drawerSlider: { id: 'drawerSlider', label: 'Drawer slider', families: ['number'] as const },
		stepper: { id: 'stepper', label: 'Stepper', families: ['number'] as const },
		stars: { id: 'stars', label: 'Stars', families: ['number'] as const },
	},
	item: {
		commandBox: { id: 'commandBox', label: 'Command box', families: ['item'] as const },
		drawer: { id: 'drawer', label: 'Drawer', families: ['item'] as const },
		status: { id: 'status', label: 'Status', families: ['item'] as const },
		theme: { id: 'theme', label: 'Theme', families: ['item'] as const },
	},
	run: {
		button: { id: 'button', label: 'Button', families: ['action'] as const },
	},
} as never

const VANILLA_CONTROL_DEFAULTS = {
	run: 'button',
	boolean: 'toggle',
	enum: 'select',
	number: 'slider',
} as never

function defaultControlFor(point: AnyPoint | undefined): string | undefined {
	if (point === undefined) return 'status'
	if (isActionPoint(point)) return 'button'
	if (!isValuedPoint(point)) return 'status'
	if (point.type === 'boolean') return 'toggle'
	if (point.type === 'enum') return 'select'
	return 'slider'
}

/** Free-text filter for addable rows — same scorer as run rows (`filterCommandEntries`). */
function filterAddSources(
	sources: readonly AddableEntry[],
	query: string
): readonly AddableEntry[] {
	return filterCommandEntries(sources, { free: query })
}

export function createIDE(container: HTMLElement, options: IdeOptions): IdeHandle {
	const { core, consoleStore } = options
	const paletteId = options.paletteId ?? 'demo'
	const itemControls = options.itemControls ?? ['commandBox', 'drawer', 'status', 'theme']
	const iconResolver = options.iconResolver
	const iconChoices = options.iconChoices ?? []
	const renderIconField = options.renderIconField
	const headGeometry = options.headContext
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
	 * update — never a structural sync). Valued controls follow
	 * `values.subscribe(id)`; action buttons follow `subscribeCan` flips;
	 * context-bound tools (`uses`) additionally follow `subscribeContext`
	 * (bag change → re-read dual-source value). Nothing-point tools
	 * (`status`/`commandBox`/`drawer`/`theme`) follow `subscribeContext`
	 * for their used bags; `theme` additionally re-applies the document-root
	 * class on every update (adapter-owned system value).
	 */
	function bindTool(content: HTMLElement, item: ToolbarItem, surface: SurfaceContext): void {
		const control = (item as { control?: unknown }).control
		const pointId = pointIdOf(item)
		const point = pointId !== undefined ? core.getDefinition(pointId) : undefined
		const update = () => updateToolNode(core, item, surface, content, iconResolver)
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
				// Context tools disable on skeleton (no value) and re-enable on
				// hydration — a `can` flip without a value change (e.g. the
				// selection key moving while the value stays absent).
				unsubs.push(
					core.subscribeCan((id) => {
						if (id === point.id) update()
					})
				)
			}
			// Enum option lists evolve through `defineEnumOptions` /
			// `defineVirtual` — reconcile select/segmented rows in place.
			if (control === 'select' || control === 'segmented') {
				unsubs.push(
					core.subscribeDefinitions((id) => {
						if (id === point.id) update()
					})
				)
			}
		} else if (point !== undefined && isActionPoint(point) && control === 'button') {
			unsubs.push(
				core.subscribeCan((id) => {
					if (id === point.id) update()
				})
			)
		} else if (point !== undefined && !isValuedPoint(point)) {
			// Nothing-point tools: re-render on context identity/key changes
			// for their used bags (missing bag → disabled + placeholder).
			if ((point.uses ?? []).length > 0) {
				unsubs.push(
					core.subscribeContext((bagName, _changed) => {
						if (!(point.uses ?? []).includes(bagName)) return
						update()
					})
				)
			}
		}
		if (unsubs.length > 0) toolBindings.set(content, unsubs)
	}

	let inspecting: ToolbarItem | undefined
	let consoleQuery = ''
	/**
	 * Add-flow draft: the detached `ToolbarItem` the add panel edits +
	 * previews (never inserted into the layout — the preview drag clones
	 * it into a `catalog` session). Rebuilt when the entry/variant
	 * changes; the configurator mutates it via `patchDraft` and the
	 * preview re-renders from it. `undefined` = no buildable selection.
	 */
	let addDraft: ToolbarItem | undefined
	/** Preview-local selected value for the draft's point (seeded from the live store). */
	let addDraftValue: unknown
	/** Point id the draft binds (`undefined` for control-only items). */
	let addDraftPointId: string | undefined
	/**
	 * Last console add selection the details panel rendered for
	 * (`selectedEntryId`). Patches that leave it unchanged skip the details
	 * re-render (keeps configurator focus + preview identity while typing).
	 */
	let lastAddSelection: { readonly entryId: string | undefined } | undefined
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
	 * Mask paint ownership: which end gaps the mask affordances (`paintMask`
	 * per region, `paintPanelMask` for parking) lit themselves. The mask
	 * nodes double as session DZs, so deactivating the mask must only clear
	 * paint the mask itself lit — never blind-clear, which would wipe the
	 * session's own highlight on the same node.
	 */
	const maskLitRegions = new Set<PaletteRegion>()
	let panelMaskLit = false
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
	 * Drawer hover-open for a pointer move: resolve the drawer item under
	 * the cursor and dispatch the bubbling drag-hover event its wrapper
	 * listens for. Owns BOTH cases: mid-drag (session live) and rest
	 * hover (no session) — the guard covers the trigger in both, so the
	 * coordinate hit-test + wrapper dispatch is the single path.
	 *
	 * The drawer tool's own guard covers the trigger (`inset: -3px`), so
	 * `elementFromPoint` at the trigger center hits the drawer's OWN guard
	 * — never the trigger. The guard carries no `data-item-index`, but its
	 * parent wrapper does: resolve the item through the wrapper first
	 * (same pattern as the bar handler's guard path), then verify it is a
	 * drawer tool. Falls back to `event.target` (implicit capture can
	 * freeze coordinates on a highlighted gap elsewhere while the event
	 * itself bubbles from the drawer bar).
	 *
	 * Called BEFORE hierarchy close so opening wins over closing on the
	 * same move; hierarchy close then spares the just-opened wrapper
	 * (it contains the hovered drawer element).
	 *
	 * @returns The wrapper that was opened (for hierarchy-close sparing),
	 * or `null` when no drawer hovered.
	 */
	function maybeOpenDrawerAt(event: PointerEvent): HTMLElement | null {
		if (!computeEditing()) return null
		const doc =
			(event.currentTarget instanceof HTMLElement
				? event.currentTarget.ownerDocument
				: undefined) ?? document
		const under =
			event.clientX !== undefined && event.clientY !== undefined
				? typeof doc.elementFromPoint === 'function'
					? doc.elementFromPoint(event.clientX, event.clientY)
					: null
				: null
		const candidates: HTMLElement[] = []
		if (under instanceof HTMLElement) candidates.push(under)
		if (event.target instanceof HTMLElement && event.target !== under) candidates.push(event.target)
		for (const candidate of candidates) {
			const item = drawerItemFromGuardOrContent(candidate)
			if (item === undefined) continue
			// Dispatch on the wrapper so the drawer listens on itself (not
			// on `document` — a document-level listener would need global
			// cleanup and would fire for drawers in other IDE instances).
			// Resolve the wrapper from the item's rendered node (the
			// candidate may be a guard whose wrapper is correct but whose
			// `.palettable-drawer` ancestor lookup misses when the guard
			// is a sibling overlay — so look up via the node map).
			const itemNode = nodes.get(item)
			const wrapper =
				itemNode instanceof HTMLElement
					? (itemNode.querySelector('.palettable-drawer') ?? itemNode.closest('.palettable-drawer'))
					: candidate.closest('.palettable-drawer')
			if (!(wrapper instanceof HTMLElement)) continue
			wrapper.dispatchEvent(
				new CustomEvent('palettable-drawer-drag-hover', { detail: item, bubbles: true })
			)
			return wrapper
		}
		return null
	}

	/**
	 * Drawer item behind a hovered node: the guard reports itself (no
	 * `data-item-index`), so resolve through its parent wrapper first, then
	 * verify the item at that index is a drawer tool. Content hits (trigger
	 * button, chevron) resolve through the same wrapper.
	 */
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

	/**
	 * Hierarchy close for drawers in edit mode: close every open drawer
	 * popup whose wrapper does NOT contain `target` (the hovered element).
	 * `spare` (the wrapper just opened by hover-open) is always spared —
	 * the retargeted event target may lie outside it. Ancestors of the
	 * hover stay open; siblings and unrelated drawers close. No-op outside
	 * edit mode (run mode keeps click/Escape/outside-click close) and when
	 * `target` is not an element.
	 */
	function closeDrawersOutside(target: EventTarget | null, spare?: HTMLElement): void {
		if (!computeEditing()) return
		if (!(target instanceof HTMLElement)) return
		for (const popup of document.querySelectorAll('.palettable-drawer__popup')) {
			if (!(popup instanceof HTMLElement) || popup.hidden) continue
			const wrapper = popup.closest('.palettable-drawer')
			if (!(wrapper instanceof HTMLElement)) continue
			if (spare !== undefined && wrapper === spare) continue
			if (wrapper.contains(target)) continue
			// Trigger hover: the guard covers the trigger (`inset: -3px`)
			// and is a SIBLING of the drawer content (both children of
			// the `.toolbar-item` wrapper), so the retargeted target
			// (guard) lies OUTSIDE `.palettable-drawer` — the contains
			// check above misses and hierarchy close would shut the
			// drawer just opened on the same bubbling `pointerover`
			// (bar opens with spare, then the ancestor wrap handler
			// closes without one). Spare when the target sits inside the
			// drawer's own item wrapper (trigger/guard/content).
			const itemWrapper = wrapper.closest('[data-item-index]')
			if (itemWrapper instanceof HTMLElement && itemWrapper.contains(target)) continue
			// Close through the head state (expando) so `open` stays in
			// sync — falling back to the direct `hidden` + chrome toggle
			// when the head never rendered one (e.g. preview DOM).
			const close = (wrapper as unknown as { __closeDrawer?: () => void }).__closeDrawer
			if (typeof close === 'function') {
				close()
				continue
			}
			// The popup toggles `hidden` in `head.ts` — mirror that contract
			// here (plus the trigger chrome) so hierarchy close needs no
			// per-drawer handle.
			popup.hidden = true
			const trigger = wrapper?.querySelector('.palettable-drawer__trigger')
			if (trigger instanceof HTMLElement) trigger.setAttribute('aria-expanded', 'false')
			const chevron = wrapper?.querySelector('.palette-default-drawer-chevron')
			if (chevron instanceof HTMLElement) chevron.textContent = '▸'
		}
	}

	/**
	 * Re-measure the slide span after a track-axis DZ paint flip: the flip
	 * changed live geometry (a lit gap widens its toolbar, moving the
	 * flanking gap edges the span is measured from), so the frame's
	 * `start`/`available` are stale. Pushes a fresh frame with the same grab
	 * (the cursor never left the toolbar) — no rAF churn, no transform reset.
	 *
	 * Measures with the follow transform cleared: `getBoundingClientRect`
	 * includes the live `translate`, so reading `rect.left` under it would
	 * freeze the current delta into the new `resting` and the toolbar
	 * would jump (visible blink after an extraction, where the fresh
	 * singleton is already offset by a tool width). Cleared synchronously
	 * and restored before return, so no paint lands in between.
	 */
	function remeasureSlideSpan(): void {
		if (dragSession === undefined || slideToolbar === undefined) return
		const element = nodes.get(slideToolbar)
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
	 * Live item location for an item object (identity scan — position is
	 * never trusted across renders). Used by the configurator delete path
	 * so it removes the inspected tool wherever a drag has moved it.
	 */
	function locationOfItem(item: ToolbarItem): import('@palettable/core').ItemLocation | undefined {
		const live = core.layout.getLayout()
		for (const region of REGIONS) {
			const border = live.borders[region]
			for (let trackIndex = 0; trackIndex < border.length; trackIndex += 1) {
				const track = border[trackIndex]!
				for (let slotIndex = 0; slotIndex < track.length; slotIndex += 1) {
					const toolbar = track[slotIndex]?.toolbar
					if (toolbar === undefined) continue
					const itemIndex = toolbar.indexOf(item)
					if (itemIndex >= 0)
						return {
							container: 'border',
							region,
							trackIndex,
							toolbarIndex: slotIndex,
							itemIndex,
						}
				}
			}
		}
		for (let toolbarIndex = 0; toolbarIndex < live.parking.length; toolbarIndex += 1) {
			const toolbar = live.parking[toolbarIndex]!
			const itemIndex = toolbar.indexOf(item)
			if (itemIndex >= 0) return { container: 'parking', toolbarIndex, itemIndex }
		}
		return undefined
	}

	/** Live border region holding an item (for the configurator surface). */
	function regionOfItem(item: ToolbarItem): PaletteRegion | undefined {
		const live = core.layout.getLayout()
		for (const region of REGIONS) {
			for (const track of live.borders[region]) {
				for (const slot of track) {
					if (slot.toolbar.includes(item)) return region
				}
			}
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
			// Unknown toolbar (stale node) — no drag session, no crash.
			dragSession = undefined
			dragging = undefined
			return
		}
		// Touch/pen drags implicitly capture the pointer to the guard, so
		// every later `pointermove` retargets to it and hover freezes on
		// the origin. Release it: window listeners still get all moves,
		// and `target` becomes the element actually under the cursor.
		// Mouse is unaffected (no implicit capture) — the call no-ops.
		if (guard instanceof HTMLElement && guard.hasPointerCapture?.(event.pointerId)) {
			try {
				guard.releasePointerCapture(event.pointerId)
			} catch {
				// Already released — hover still retargets correctly.
			}
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
		// Same implicit-capture release as the tool/toolbar grabs.
		if (event.target instanceof HTMLElement && event.target.hasPointerCapture?.(event.pointerId)) {
			try {
				event.target.releasePointerCapture(event.pointerId)
			} catch {
				// Already released — hover still retargets correctly.
			}
		}
		applyDragChrome()
		startDragSession({
			event,
			onMove: () => {},
			onStop: () => endToolDrag(),
		})
	}

	/**
	 * Phase 6 chrome mirror: container `.dragging` + `data-dragging` (the
	 * Phase 1–5 chrome) plus per-toolbar `data-dragged` on the core-decided
	 * dragged toolbar (`dragSession.draggedToolbar` — vanilla applies it
	 * verbatim via `nodes.get`, never computes it) plus root
	 * `palette-dragging` (mirrors svelte `paletteRoot`). Re-applied after
	 * every `structure` event (the placed toolbar is a fresh object / new
	 * container after a commit). A subset drag owns no chrome (nothing
	 * moves yet); it appears only once the drag slides freely.
	 */
	function applyDragChrome(): void {
		if (dragSession === undefined) return
		container.classList.add('dragging')
		container.dataset.dragging = 'true'
		// `palette-dragging` has no CSS rule (dead mirror, kept cleared in
		// `clearDragChrome`); `data-dragged` keeps the sliding toolbar's
		// handles exposed while it moves (mirrors svelte `Toolbar`
		// `data-dragged`). It changes the
		// toolbar's border width, so slide/outside measurements must run
		// against the post-chrome DOM — arm/re-arm order is grab →
		// `applyDragChrome` → `armSlide`, and `structure` → `applyOp` →
		// `applyDragChrome` → re-arm.
		// Core decides, vanilla applies: clear any stale attribute, then
		// stamp the single live node (if any — catalog creation has no
		// live toolbar until the first placement inserts).
		for (const host of [topHost, leftHost, rightHost, bottomHost, consoleHost]) {
			for (const node of host.querySelectorAll('.toolbar[data-dragged]')) {
				if (node instanceof HTMLElement) delete node.dataset.dragged
			}
		}
		const dragged = dragSession.draggedToolbar
		if (dragged === undefined) return
		const node = nodes.get(dragged)
		if (node instanceof HTMLElement) node.dataset.dragged = 'true'
	}

	/** Clear the drag chrome mirror (per-toolbar `data-dragged`). */
	function clearDragChrome(): void {
		container.classList.remove('palette-dragging')
		// Sweep stays so the mirror cannot leave stale attributes behind.
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
			// Unknown toolbar (stale node) — no drag session, no crash.
			dragSession = undefined
			dragging = undefined
			return
		}
		// Same implicit-capture release as the tool grab: touch/pen would
		// otherwise retarget every move to the bar and freeze hover.
		if (event.target instanceof HTMLElement && event.target.hasPointerCapture?.(event.pointerId)) {
			try {
				event.target.releasePointerCapture(event.pointerId)
			} catch {
				// Already released — hover still retargets correctly.
			}
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
		maskLitRegions.clear()
		panelMaskLit = false
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
	 * the transform + disarms the follow loop; `slideLimit` drops/restores
	 * the per-toolbar `data-dragged` chrome at the slide extremes;
	 * `resize` re-reads the two gaps' `space` into flex.
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
			case 'slideLimit':
				applySlideLimitEvent(event.toolbar, event.atLimit)
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
	 * Slide extreme chrome: while the toolbar "hits" its neighbour
	 * (`atLimit: true`) it loses its `data-dragged` status; moving free
	 * again (`false`) restores it. Core decides (the `slideLimit` event),
	 * vanilla applies verbatim via `nodes.get` — never computed here.
	 * The container `.dragging` / `data-dragging` chrome stays for the
	 * whole gesture (it drives the `:not(.dragging)` handle rules).
	 */
	function applySlideLimitEvent(toolbar: Toolbar, atLimit: boolean): void {
		const node = nodes.get(toolbar)
		if (!(node instanceof HTMLElement)) return
		if (atLimit) delete node.dataset.dragged
		else node.dataset.dragged = 'true'
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
	 *
	 * The fresh node is measured with any stale follow transform cleared:
	 * `applyOp` reuses the dragged element's DOM node across the commit,
	 * so a `translate` written for the old (wider) toolbar is still on it
	 * when `armSlide` reads `rect` — freezing a one-tool offset into the
	 * new `resting`/`grab` and blinking between the two sizes on every
	 * move. Cleared before measuring; the next `slide` event re-applies
	 * the correct delta from the fresh frame.
	 */
	function rearmSlideAfterStructure(): void {
		const target = dragging?.origin.toolbar
		const event = slideRearmEvent
		if (!dragging?.isWholeToolbar || target === undefined || event === undefined) {
			disarmSlide()
			return
		}
		const node = nodes.get(target)
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

	/**
	 * Drawer item under the cursor: the live drawer `ToolbarItem` whose
	 * wrapper contains `target` (scoped to `bar` — the bar under the
	 * cursor). `undefined` when the hover is not over a drawer tool.
	 * Position-based (wrapper `data-item-index` + live toolbar), so it
	 * needs no node-map reverse lookup.
	 */
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

	/** Reverse lookup: live `Toolbar` array behind a rendered `.toolbar` bar.
	 * Drawer-child bars resolve too (identity scan through drawer child
	 * tracks) — the session routes them to the drawer commit path itself. */
	function toolbarOfBar(bar: HTMLElement): Toolbar | undefined {
		const live = core.layout.getLayout()
		for (const region of REGIONS) {
			for (const track of live.borders[region]) {
				for (const slot of track) {
					if (nodes.get(slot.toolbar) === bar) return slot.toolbar
					const found = findDrawerBar(slot.toolbar, bar)
					if (found !== undefined) return found
				}
			}
		}
		for (const toolbar of live.parking) {
			if (nodes.get(toolbar) === bar) return toolbar
			const found = findDrawerBar(toolbar, bar)
			if (found !== undefined) return found
		}
		return undefined
	}

	/** Recursive drawer scan for a rendered bar node (`===` via the node map). */
	function findDrawerBar(toolbar: Toolbar, bar: HTMLElement): Toolbar | undefined {
		for (const item of toolbar) {
			const child = (item as { control?: unknown; toolbar?: unknown }).toolbar
			if ((item as { control?: unknown }).control !== 'drawer' || !Array.isArray(child)) continue
			for (const slot of child as Track) {
				if (nodes.get(slot.toolbar) === bar) return slot.toolbar
				const found = findDrawerBar(slot.toolbar, bar)
				if (found !== undefined) return found
			}
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
	 * the gap in the event, never a full container set). A track-axis flip
	 * (item/track gap) changes live geometry, so the slide span is
	 * re-measured from the neighbours' live edges — the dragged toolbar
	 * stops at the DZ, not at the resting edge. */
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
				remeasureSlideSpan()
				return
			}
			case 'track-gap': {
				const node = nodes.get(dz.track)
				if (!(node instanceof HTMLElement)) return
				toggle(node.querySelector(`[data-track-space-index="${dz.gap}"]`))
				remeasureSlideSpan()
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
	 * item under the pointer. The session resolves the container itself
	 * (border toolbar vs parking row) and merges the parking flanks for
	 * row hovers — so a parking tool hover paints its item gaps AND the
	 * two flanking parking gaps in one pass.
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
		// No anchor at all → the bar itself is the anchor: report a
		// `toolbar` hover with no active item so core still paints the
		// flanking gaps (`addTrackFlanks` merges `parkingFlanks` /
		// `stackFlanks` for any toolbar/tool/item-gap hover). Sending
		// `null` here would wipe outer paint — hovering a parking bar
		// background must light its flanks, not clear them.
		if (hovered === undefined && activeItem === undefined) {
			session.over({ kind: 'toolbar', toolbar }, pointerSample(event))
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
	 * Build one edit-mode drag guard for a tool wrapper: `pointerdown`
	 * starts the tool drag (inspect + session). Rest hover-open needs NO
	 * guard listener: the bar-level `pointerover` (coordinate hit-test +
	 * wrapper dispatch in `maybeOpenDrawerAt`) owns BOTH cases (rest and
	 * mid-drag) — the guard covers the trigger in both. Single factory
	 * so render-time and `applyEditing` guards behave identically.
	 */
	function makeGuard(
		wrapper: HTMLElement,
		resolve: () => { toolbar: Toolbar; item: ToolbarItem } | undefined
	): HTMLElement {
		const guard = el('div', 'toolbar-item-guard')
		guard.dataset.paletteId = paletteId
		guard.setAttribute('aria-hidden', 'true')
		guard.addEventListener('pointerdown', (event) => {
			const found = resolve()
			if (found === undefined) return
			setInspecting(found.item)
			startToolDrag(event, found.toolbar, found.item)
		})
		void wrapper
		return guard
	}

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
			if (active) {
				node.classList.toggle('highlighted', !vetoed)
				node.classList.toggle('hovered', false)
				if (!vetoed) maskLitRegions.add(region)
				else maskLitRegions.delete(region)
				continue
			}
			// Deactivating the mask must only clear paint the mask itself
			// lit: the same node is also the session's end-gap DZ, and a
			// blind clear here wipes session paint (the stack/border
			// handlers call this on every move while the session highlights
			// the same gap — the live "only the last gap lights" bug).
			if (!maskLitRegions.has(region)) continue
			maskLitRegions.delete(region)
			node.classList.toggle('highlighted', false)
			node.classList.toggle('hovered', false)
		}
	}

	/**
	 * Phase 6 panel affordance (mirrors svelte `Console`
	 * `parkingMaskHover`): while editing + dragging, a pointer over the
	 * console panel background but outside parking rows/gaps (and outside
	 * popups/dialogs) paints the parking end gap — paint-only and
	 * consequence-free, like `paintMask` (never through the session, so no
	 * dwell ever arms here — mirrors the svelte `masked` guard). The veto
	 * rule stays core-owned (`draggingWholeParkingRow`: the two gaps
	 * touching the dragged whole row stay dark at any stack size).
	 */
	function paintPanelMask(active: boolean): void {
		const stack = consoleHost.querySelector('.palette-parking')
		if (!(stack instanceof HTMLElement)) return
		const live = core.layout.getLayout()
		const gap = live.parking.length
		const node = stack.querySelector(`:scope > [data-parking-gap-index="${gap}"]`)
		if (!(node instanceof HTMLElement)) return
		const whole =
			dragging !== undefined ? draggingWholeParkingRow(dragging, live.parking) : undefined
		const vetoed = whole !== undefined && (gap === whole || gap === whole + 1)
		if (active) {
			node.classList.toggle('highlighted', !vetoed)
			node.classList.toggle('hovered', false)
			if (!vetoed) panelMaskLit = true
			else panelMaskLit = false
			return
		}
		// Same ownership rule as `paintMask`: only clear paint the mask
		// itself lit — the end gap is also the session's dwell DZ.
		if (!panelMaskLit) return
		panelMaskLit = false
		node.classList.toggle('highlighted', false)
		node.classList.toggle('hovered', false)
	}

	/**
	 * Whether the pointer is over the console panel background (outside
	 * parking rows/gaps and outside popups/dialogs). Pure hit-test — the
	 * caller decides paint (`paintPanelMask`) vs session routing.
	 */
	function isPanelBackground(target: HTMLElement): boolean {
		const panel = target.closest('.palette-default-command-panel')
		if (!(panel instanceof HTMLElement)) return false
		// Over parking itself → parking owns the highlight, not the mask.
		if (target.closest('.palette-parking')) return false
		// On a popup/dialog → neither parking nor mask.
		if (target.closest('.palettable-drawer__popup, dialog')) return false
		return true
	}

	function overPanelBackground(event: PointerEvent): boolean {
		if (!computeEditing() || dragSession === undefined || dragging === undefined) {
			paintPanelMask(false)
			return false
		}
		const target = event.target
		if (!(target instanceof HTMLElement) || !isPanelBackground(target)) {
			paintPanelMask(false)
			return false
		}
		paintPanelMask(true)
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
					if (
						slot.toolbar.some((item) => (item as { control?: unknown }).control === 'commandBox')
					) {
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
		_basePath:
			| {
					readonly container: 'border'
					readonly region: PaletteRegion
					readonly trackIndex: number
					readonly slotIndex: number
					readonly ideRect?: { left: number; top: number; width: number; height: number }
					readonly triggerRect?: { left: number; top: number; width: number; height: number }
			  }
			| {
					readonly container: 'parking'
					readonly toolbarIndex: number
					readonly ideRect?: { left: number; top: number; width: number; height: number }
					readonly triggerRect?: { left: number; top: number; width: number; height: number }
			  },
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
		// Rest hover-open (no drag) + hierarchy close live here: the
		// guard covers the trigger, so the coordinate hit-test +
		// wrapper dispatch in `maybeOpenDrawerAt` is the single path
		// (mid-drag AND rest) — `pointermove` never fires on first entry,
		// so `pointerover` (bubbles, unlike `pointerenter`) owns both.
		bar.addEventListener('pointerover', (event) => {
			// Popup-inner hovers bubble through the outer bar too — skip
			// those (the popup's own `pointerover` keeps its drawer open;
			// closing here would shut the drawer just entered).
			const target = event.target
			if (target instanceof HTMLElement && target.closest('.palettable-drawer__popup')) {
				return
			}
			// Drawer hover-open FIRST (before hierarchy close): hovering a
			// drawer trigger must open it, and hierarchy close would shut a
			// drawer whose wrapper doesn't contain the retargeted event
			// target. Open first (spared below because the wrapper contains
			// the drawer guard/content), then close only drawers outside
			// the hovered drawer + target chain.
			const openedDrawer = maybeOpenDrawerAt(event)
			closeDrawersOutside(event.target, openedDrawer ?? undefined)
			return
		})
		bar.addEventListener('pointermove', (event) => {
			const session = dragSession
			if (!session) return
			// Drawer hover-open FIRST (before hierarchy close): hovering a
			// drawer trigger must open it, and hierarchy close would shut a
			// drawer whose wrapper doesn't contain the retargeted event
			// target. Open first (spared below because the wrapper contains
			// the drawer guard/content), then close only drawers outside
			// the hovered drawer + target chain.
			const openedDrawer = maybeOpenDrawerAt(event)
			// Hierarchy close on every drag hover: drawers outside the
			// hovered ancestor chain close (no mouseleave close in edit).
			closeDrawersOutside(event.target, openedDrawer ?? undefined)
			// During a drag the pointer may be implicitly captured to the
			// grab guard (touch/pen, and Playwright's synthetic mouse in
			// e2e/probes) — `event.target` then freezes on the origin and
			// this bar handler never fires for the bar under the cursor.
			// Hit-test from coordinates instead: the element under the
			// pointer owns the hover, wherever this listener is attached.
			const under =
				event.clientX !== undefined && event.clientY !== undefined
					? typeof bar.ownerDocument.elementFromPoint === 'function'
						? bar.ownerDocument.elementFromPoint(event.clientX, event.clientY)
						: null
					: null
			const target = under instanceof HTMLElement ? under : event.target
			if (!(target instanceof HTMLElement)) return
			// The bar under the cursor owns the hover — but this listener
			// may be attached to a different bar (events bubble to window
			// listeners, not here; a stale bar must not claim the hover).
			// Resolve the live toolbar from the element under the cursor.
			const liveBar = target.closest('.toolbar')
			if (!(liveBar instanceof HTMLElement)) {
				// Not over any bar: the stack/panel handler owns the hover.
				return
			}
			const liveToolbar = toolbarOfBar(liveBar)
			if (liveToolbar === undefined) return
			// The drawer tool paints its flanking item-gaps (active-item
			// fallback) like any other toolbar tool — hover-open itself
			// already fired above (`maybeOpenDrawerAt`, before hierarchy
			// close), so the popup's gaps exist for this same move.
			const hoveredDrawerItem = drawerItemOfTarget(target, liveBar)
			if (hoveredDrawerItem !== undefined) {
				const drawerActive = liveToolbar.indexOf(hoveredDrawerItem)
				paintItemSpaces(
					liveBar,
					liveToolbar,
					drawerActive >= 0 ? drawerActive : undefined,
					undefined,
					event
				)
				return
			}
			// With capture retargeting, this listener may belong to the
			// origin bar while the cursor is over another bar: route the
			// hover through the bar actually under the cursor.
			const hitBar = liveToolbar !== toolbar ? liveBar : bar
			const hitToolbar = liveToolbar !== toolbar ? liveToolbar : toolbar
			// The guard covers the whole item (`inset: -3px`, `z-index: 1`)
			// and reports itself as the target — but it carries no
			// `data-item-index`, so `toHoverable` below would miss the tool
			// hover. Resolve the item through the wrapper first: a guard
			// hover is a tool hover on the wrapped item.
			const guardItem = target.closest('.toolbar-item-guard')
			if (guardItem instanceof HTMLElement) {
				const wrapper = guardItem.closest('[data-item-index]')
				const active =
					wrapper && hitBar.contains(wrapper)
						? Number((wrapper as HTMLElement).dataset.itemIndex)
						: undefined
				if (Number.isInteger(active)) {
					const item = hitToolbar[active as number]
					if (item !== undefined) {
						paintItemSpaces(hitBar, hitToolbar, active, undefined, event)
						return
					}
				}
			}
			// Single hit-test: one `toHoverable` call classifies tool vs gap.
			const hover = toHoverable(target, hitBar)
			if (hover === null) {
				// Hovering neither a tool nor a gap (bar background): fall back
				// to the active-item path via the item under the pointer.
				const itemEl = target.closest('[data-item-index]')
				const active =
					itemEl && hitBar.contains(itemEl)
						? Number((itemEl as HTMLElement).dataset.itemIndex)
						: undefined
				paintItemSpaces(
					hitBar,
					hitToolbar,
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
				const active = hitToolbar.indexOf(hover.item)
				paintItemSpaces(hitBar, hitToolbar, active >= 0 ? active : undefined, undefined, event)
				return
			}
			// `session.over()` decides paint + commit in one call: a highlighted
			// gap restructures (the session raises `structure`), a dark gap
			// emits nothing. Paint and structure both arrive via the session
			// subscription — the adapter never reconciles a return value.
			// Parking rows have no `dragTarget` — the core locates the row in
			// the live parking stack itself.
			overItemGap(session, hitToolbar, hover.gap, event)
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
			const wrapper = el('div', 'toolbar-item')
			wrapper.dataset.itemIndex = String(itemIndex)
			nodes.setItem(item, wrapper)
			const point = (item as { point?: unknown }).point
			if (typeof point === 'string') wrapper.dataset.point = point
			const control = (item as { control?: unknown }).control
			if (typeof control === 'string') wrapper.dataset.control = control
			if (inspecting === item) wrapper.dataset.inspected = 'true'
			const content = el('div', 'toolbar-item-content')
			// Drawer items are exempt from the inert shield: the popup
			// renders INSIDE the content (inline, not body-portaled like
			// svelte), and an inert ancestor removes the whole subtree
			// from hit-testing — `elementFromPoint` would pass through
			// the open popup to the center behind it, so drawer-child
			// gaps could never highlight. The trigger stays covered by
			// its sibling guard, so edit behavior is unchanged.
			if (editing && control !== 'drawer') {
				;(content as HTMLElement & { inert?: boolean }).inert = true
				content.setAttribute('inert', '')
			}
			const surface = surfaceForRegion(region)
			const rendered = renderHeadItem({
				core,
				item,
				surface,
				region,
				iconResolver,
				onOpenConsole: (mode) => consoleStore.open(mode),
				onInspect: () => setInspecting(item),
				isEditing: () => computeEditing(),
				isDragging: () => dragSession !== undefined,
				closeUnrelatedDrawers: (target) => closeDrawersOutside(target),
				ideRect: _basePath.ideRect ?? headGeometry?.ideRect,
				triggerRect: _basePath.triggerRect ?? headGeometry?.triggerRect,
				renderToolbar: (childTrack: Track, childAxis, childRegion) =>
					renderDrawerTrack(childTrack, childAxis, childRegion, editing),
			})
			if (rendered) content.append(rendered)
			bindTool(content, item, surface)
			wrapper.append(content)
			if (editing) {
				wrapper.append(
					makeGuard(wrapper, () => {
						setInspecting(item)
						return { toolbar, item }
					})
				)
			}
			bar.append(wrapper)
			appendSpace(itemIndex + 1)
		})
		void axis
		return bar
	}

	/** Render drawer content (one track, several toolbars stacked along
	 * the child axis). Drawer content is NOT a border track: no track gaps,
	 * no stack gaps — the popup holds bare toolbars whose item-spaces are
	 * live DZs during a drag (same `item-gap` session path as borders).
	 * Tagged `data-drawer-track` to keep border-scoped queries (drag
	 * hit-testing, e2e locators) on the real border toolbars. Child bars
	 * render with the popup's own axis/region (perpendicular to the
	 * parent) so edit handles follow the child axis. Empty child tracks
	 * never render (core keeps one empty bar behind — the drop target). */
	function renderDrawerTrack(
		track: Track,
		axis: 'horizontal' | 'vertical',
		region: PaletteRegion,
		editing: boolean
	): HTMLElement {
		const wrap = el('div', 'toolbar-track')
		wrap.dataset.drawerTrack = 'true'
		// Drawer hover routes into the drag session (item-gap paint +
		// commit, same as border bars) and applies hierarchy close: only
		// drawers outside the hovered ancestor chain close. Child bars
		// render with the popup's own axis/region (perpendicular to the
		// parent) so edit handles follow the child axis.
		//
		// NOTE: `event.target` here is the element under the cursor — the
		// drawer-child guards do NOT retarget (each drawer tool owns its
		// guard, and `renderToolbarElement` wires `pointerdown` →
		// `startToolDrag` on every one, so grabs start inside the drawer).
		// The bar-level coordinate hit-test is unnecessary here: the wrap
		// listener fires for the bar actually hovered.
		wrap.addEventListener('pointermove', (event) => {
			const session = dragSession
			if (!session) {
				// Rest (no drag): no DZ paint exists — only hierarchy
				// close, and only when the hover is OUTSIDE every popup
				// (popup-inner moves bubble through this wrap; closing
				// here would shut the drawer just entered — the guard
				// hover that opened it included).
				const target = event.target
				if (target instanceof HTMLElement && target.closest('.palettable-drawer__popup')) {
					return
				}
				closeDrawersOutside(event.target)
				return
			}
			// Mid-drag: hierarchy close FIRST (drawers outside the
			// hovered chain close), then DZ paint. The close spares the
			// hovered chain via `contains` (popup-inner targets sit
			// inside their wrapper), so paint targets survive it.
			closeDrawersOutside(event.target)
			if (!computeEditing()) return
			const target = event.target
			if (!(target instanceof HTMLElement)) return
			const liveBar = target.closest('.toolbar')
			if (!(liveBar instanceof HTMLElement) || !wrap.contains(liveBar)) return
			const liveToolbar = toolbarOfBar(liveBar)
			if (liveToolbar === undefined) return
			// Guard hover is a tool hover on the wrapped item (same pattern
			// as the border bar handler — the guard carries no
			// `data-item-index` itself).
			const guardItem = target.closest('.toolbar-item-guard')
			if (guardItem instanceof HTMLElement) {
				const wrapper = guardItem.closest('[data-item-index]')
				const active =
					wrapper && liveBar.contains(wrapper)
						? Number((wrapper as HTMLElement).dataset.itemIndex)
						: undefined
				if (Number.isInteger(active)) {
					const item = liveToolbar[active as number]
					if (item !== undefined) {
						paintItemSpaces(liveBar, liveToolbar, active, undefined, event)
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
			const active =
				itemEl instanceof HTMLElement && liveBar.contains(itemEl)
					? Number((itemEl as HTMLElement).dataset.itemIndex)
					: undefined
			paintItemSpaces(
				liveBar,
				liveToolbar,
				Number.isInteger(active) ? (active as number) : undefined,
				undefined,
				event
			)
		})
		// No `pointerleave` close in edit mode: drawers close only when
		// hover moves outside their ancestor chain (hierarchy close).
		// Rest hover-open (no drag): `pointermove` never fires on first
		// entry, so the wrapper's bubbling `pointerover` owns opening —
		// the drawer's own `pointerover` listener opens the popup, and
		// this only applies hierarchy close (no session needed). Skip
		// popup-inner hovers: they bubble through the outer bar AND this
		// wrap, and closing here would shut the drawer just entered.
		wrap.addEventListener('pointerover', (event) => {
			const target = event.target
			if (target instanceof HTMLElement && target.closest('.palettable-drawer__popup')) {
				return
			}
			closeDrawersOutside(event.target)
		})
		track.forEach((slot, slotIndex) => {
			const slotEl = el('div', 'toolbar-track-slot')
			slotEl.dataset.toolbarSlotIndex = String(slotIndex)
			slotEl.append(
				renderToolbarElement(slot.toolbar, axis, region, editing, 'border', {
					container: 'border',
					region,
					trackIndex: 0,
					slotIndex,
					ideRect: headGeometry?.ideRect,
					triggerRect: headGeometry?.triggerRect,
				})
			)
			wrap.append(slotEl)
		})
		return wrap
	}

	function renderBorder(host: HTMLElement, region: PaletteRegion, editing: boolean): void {
		dropBindingsIn(host)
		host.textContent = ''
		const direction = directionFor(region)
		const inverse = region === 'right' || region === 'bottom'
		const borderEl = el('div', 'toolbar-border')
		borderEl.style.setProperty('--layout', direction)
		borderEl.style.setProperty('--region', region)
		borderEl.dataset.paletteId = paletteId
		borderEl.dataset.region = region
		const live = core.layout.getLayout()
		const border = live.borders[region]
		// Stack gaps paint via session `highlight` events (the dwell commit
		// fires from the session itself in Phase 3). Hover alone stays dark.
		borderEl.addEventListener('pointerleave', (event) => {
			dragSession?.over(null, pointerSample(event))
		})
		borderEl.addEventListener('pointerover', (event) => {
			// Rest hierarchy close on ENTRY (no drag): `pointermove` never
			// fires on first entry, so a track/stack-gap hover elsewhere
			// must close on `pointerover` (bubbles, unlike `pointerenter`).
			// Popup-inner hovers bubble through here too — skip those (the
			// popup's own `pointerover` keeps its drawer open). ALSO skip
			// hovers inside ANY toolbar: the bar `pointerover` above owns
			// those (open-first-then-close with spare) — closing here
			// first would shut the drawer before the bar handler opens it
			// (both fire on the same bubbling `pointerover`, border
			// listener first as the ancestor).
			if (dragSession !== undefined) return
			const target = event.target
			if (target instanceof HTMLElement) {
				if (target.closest('.palettable-drawer__popup')) return
				if (target.closest('.toolbar')) return
			}
			closeDrawersOutside(event.target)
		})
		borderEl.addEventListener('pointermove', (event) => {
			// Rest hierarchy close (no drag): `pointermove` never fires on
			// first entry, but it DOES fire on every move after — so an
			// open drawer closes as soon as the pointer moves over a
			// track/stack gap elsewhere. (Bar-background moves are owned
			// by the bar `pointerover` above; popup-inner moves return
			// early in the wrap handler below.)
			if (dragSession === undefined) {
				const target = event.target
				if (target instanceof HTMLElement && target.closest('.palettable-drawer__popup')) {
					return
				}
				closeDrawersOutside(event.target)
				return
			}
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
				// Rest hierarchy close (no drag): moving over a track gap
				// elsewhere closes drawers outside the hovered chain.
				if (dragSession === undefined) {
					const target = event.target
					if (target instanceof HTMLElement && target.closest('.palettable-drawer__popup')) {
						return
					}
					closeDrawersOutside(event.target)
					return
				}
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
							ideRect: headGeometry?.ideRect,
							triggerRect: headGeometry?.triggerRect,
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
		const stack = el('div', 'palette-parking')
		stack.style.setProperty('--layout', 'horizontal')
		stack.style.setProperty('--region', 'top')
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
			// Coordinate hit-test (same implicit-capture reason as the bar
			// handler): `event.target` may freeze on the grab guard while
			// the cursor is over the stack background, and the toolbar
			// check below would then bail out forever.
			const under =
				event.clientX !== undefined && event.clientY !== undefined
					? typeof stack.ownerDocument.elementFromPoint === 'function'
						? stack.ownerDocument.elementFromPoint(event.clientX, event.clientY)
						: null
					: null
			const target = under instanceof HTMLElement ? under : event.target
			if (!(target instanceof HTMLElement)) return
			// Parking owns its own background — the panel mask never paints
			// while the pointer is over the stack.
			paintPanelMask(false)
			// Inside a row toolbar → that toolbar owns the item DZs.
			if (target.closest('.toolbar')) return
			const gapEl = target.closest('[data-parking-gap-index]')
			if (gapEl && stack.contains(gapEl)) {
				const index = Number((gapEl as HTMLElement).dataset.parkingGapIndex)
				if (!Number.isInteger(index)) return
				// Direct parking-gap hover: paints now, dwell fires the commit.
				session.over({ kind: 'parking-gap', parking, gap: index }, pointerSample(event))
				return
			}
			// Over a row (not a gap): report the row hover so core paints
			// the two flanking parking gaps (active-row fallback, no dwell
			// arm — mirrors the svelte `hoverRow` + border `stackFlanks`).
			const rowEl = target.closest('[data-parking-row-index]')
			if (rowEl && stack.contains(rowEl)) {
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
			// Stack background (between/around rows, on no row or gap):
			// project onto the nearest rendered parking gap so every part
			// of the stack reads as a drop target — mirrors the border
			// `outside` projection. A direct gap hover paints `double` and
			// arms the dwell; vetoed (dark) gaps never commit.
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
		})
		const visible = live.parking
			.map((toolbar, index) => ({ toolbar, index }))
			.filter(({ toolbar }) =>
				toolbar.some((item) => (item as { control?: unknown }).control !== 'commandBox')
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
		addDraft = undefined
		addDraftPointId = undefined
		addDraftValue = undefined
		lastAddSelection = undefined
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
		// The console preview is a live tool, not a toolbar child: it
		// must never go inert (its inputs stay interactive) and never
		// grow a drag guard (it owns its own pointerdown → catalog drag).
		// Drawer contents are exempt too (see `renderToolbarElement`):
		// the popup renders inline inside the content, and an inert
		// ancestor would remove it from hit-testing.
		for (const content of container.querySelectorAll(
			'.toolbar-item-content:not(.palette-default-add-preview-content)'
		)) {
			if (!(content instanceof HTMLElement)) continue
			if (content.querySelector('.palettable-drawer')) continue
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
				wrapper.append(
					makeGuard(wrapper, () => {
						const item = itemOfWrapper(wrapper)
						if (item === undefined) return undefined
						const live = core.layout.getLayout()
						const toolbar = findToolbarOf(live, item)
						if (toolbar === undefined) return undefined
						return { toolbar, item }
					})
				)
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
	 * details panel (which reads `inspecting` at render time). The
	 * selection is the live item object (`===`), never a path — a drag
	 * commit moves the same object to a new container, so the edition
	 * follows the tool instead of pointing at whatever slid into its
	 * old index.
	 */
	function setInspecting(next: ToolbarItem | undefined): void {
		if (next !== undefined && inspecting === next) return
		const oldNode = inspecting !== undefined ? nodes.get(inspecting) : undefined
		if (oldNode instanceof HTMLElement) delete oldNode.dataset.inspected
		inspecting = next
		if (next !== undefined) {
			const node = nodes.get(next)
			if (node instanceof HTMLElement) node.dataset.inspected = 'true'
			// Inspecting a live tool abandons the add-flow draft (the
			// details panel shows one or the other, never both).
			addDraft = undefined
			addDraftPointId = undefined
			addDraftValue = undefined
		}
		renderConsoleDetails()
	}

	/** Resolve the live item object behind a rendered wrapper (identity scan).
	 * Drawer-child wrappers live inside a hierarchical popup
	 * (`[data-drawer-track]`): they have no border origin, so they resolve
	 * to `undefined` (no inspect-drag — mirrors the `createDrag` catch in
	 * `startToolDrag`/`startToolbarDrag`). */
	function itemOfWrapper(wrapper: HTMLElement): ToolbarItem | undefined {
		if (wrapper.closest('[data-drawer-track]')) return undefined
		const live = core.layout.getLayout()
		const itemIndex = Number(wrapper.dataset.itemIndex ?? '-1')
		if (!Number.isInteger(itemIndex) || itemIndex < 0) return undefined
		const bar = wrapper.closest('.toolbar')
		if (!(bar instanceof HTMLElement)) return undefined
		if (bar.dataset.container === 'parking') {
			const row = wrapper.closest('.palette-parking-row')
			const toolbarIndex = Number(
				row instanceof HTMLElement ? (row.dataset.parkingRowIndex ?? '-1') : '-1'
			)
			if (!Number.isInteger(toolbarIndex) || toolbarIndex < 0) return undefined
			return live.parking[toolbarIndex]?.[itemIndex]
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
		if (region === undefined || trackIndex < 0 || slotIndex < 0) return undefined
		return live.borders[region][trackIndex]?.[slotIndex]?.toolbar[itemIndex]
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
			paintPanelMask(false)
			if (inspecting !== undefined) {
				const oldNode = nodes.get(inspecting)
				if (oldNode instanceof HTMLElement) delete oldNode.dataset.inspected
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
		// (outside parking rows/gaps/popups) paints the parking end gap —
		// paint-only, never through the session (no dwell, no commit).
		panel.addEventListener('pointermove', (event) => {
			overPanelBackground(event)
		})
		panel.addEventListener('pointerleave', (event) => {
			paintPanelMask(false)
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
				// Edit surface: one addable row per point (valued + action
				// + nothing) — SSR-safe, no `can` / `uses`.
				const sources = addableEntries(
					core.points,
					{ itemControls },
					{ excludePoints: ['console'] }
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
						// Selecting an add source starts the add flow: clear
						// any inspected toolbar item so the details panel
						// shows the add panel, not the stale inspector.
						// The draft resets (a new entry = a new tool).
						setInspecting(undefined)
						addDraft = undefined
						addDraftPointId = undefined
						addDraftValue = undefined
						consoleStore.patch({ selectedEntryId: source.id })
					})
					const copy = el('span', 'palette-default-command-result-copy')
					const label = el('span', 'palette-default-command-result-label')
					if (typeof source.icon === 'string') {
						const entryIcon = iconSpan(resolveIcon(source.icon, iconResolver))
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
			// Run surface: concrete executable rows with live `can` + `uses`.
			const all: readonly ActionableEntry[] = actionableEntries(
				core.points,
				{ keys: core.keys, values: core.values.asObject(), actionCan: actionCan() },
				{ excludePoints: ['console'] }
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
					const entryIcon = iconSpan(resolveIcon(entry.icon, iconResolver))
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
					const sources = addableEntries(
						core.points,
						{ itemControls },
						{ excludePoints: ['console'] }
					)
					const first = filterAddSources(sources, input.value)[0]
					if (first) {
						setInspecting(undefined)
						addDraft = undefined
						addDraftPointId = undefined
						addDraftValue = undefined
						consoleStore.patch({ selectedEntryId: first.id })
					}
				} else {
					const all: readonly ActionableEntry[] = actionableEntries(
						core.points,
						{ keys: core.keys, values: core.values.asObject(), actionCan: actionCan() },
						{ excludePoints: ['console'] }
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

		lastAddSelection =
			snapshot.selectedEntryId !== undefined ? { entryId: snapshot.selectedEntryId } : undefined
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
		renderConsoleDetailsInto(bottom)
	}

	function renderConsoleDetailsInto(bottom: HTMLElement): void {
		const snapshot = consoleStore.snapshot
		const canEdit = options.isEditable()
		const editOnly = hasCommandBoxTool()
		const isEditing = canEdit && (editOnly || snapshot.mode === 'edit')
		if (!isEditing) return
		// The details panel owns preview bindings (preview-local value
		// subscriptions): drop them with the old panel so discarded
		// preview nodes never leak listeners.
		const old = bottom.querySelector('.palette-default-details-panel')
		if (old instanceof HTMLElement) dropBindingsIn(old)
		old?.remove()
		const details = el('div', 'palette-default-panel palette-default-details-panel')
		details.dataset.testid = 'console-details-panel'
		bottom.append(details)
		const inspectingItem = inspecting !== undefined ? liveItemOf(inspecting) : undefined
		if (inspectingItem) {
			const title = el('div', 'palette-default-panel-title')
			title.textContent = 'Inspect'
			details.append(title)
			details.append(renderConfigurator(inspectingItem.item, inspecting!))
		} else {
			const selected = snapshot.selectedEntryId
				? addableEntries(core.points, { itemControls }, { excludePoints: ['console'] }).find(
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
					'Click a toolbar item to inspect its presentation, or select a point or control on the left to add it to a toolbar.'
				details.append(empty)
			}
		}
	}

	/**
	 * Resolve a live item still present in the layout (identity scan —
	 * the item object survives drag commits, so a stale reference simply
	 * resolves to `undefined` instead of pointing at a stranger).
	 */
	function liveItemOf(
		item: import('@palettable/core').ToolbarItem
	): { item: import('@palettable/core').ToolbarItem; point: AnyPoint | undefined } | undefined {
		if (findToolbarOf(core.layout.getLayout(), item) === undefined) return undefined
		return { item, point: pointFor(item) }
	}

	function pointFor(item: import('@palettable/core').ToolbarItem): AnyPoint | undefined {
		const point = (item as { point?: unknown }).point
		if (typeof point !== 'string') return undefined
		// `getDefinition` canonicalizes (`=` / `!` / `+=x` / `-=x`
		// stripped), so a bare `+`/`-` inside an id is never a suffix.
		return core.getDefinition(point)
	}

	/**
	 * Rebuild the detached add-flow draft from the console selection
	 * (entry + variant): `itemFromAddSelection` derives the item, the
	 * preview-local value seeds from the live store (dual-source read —
	 * context bag wins, else root). Control-only items bind no point
	 * (`addDraftPointId` stays `undefined`). Unbuildable selections
	 * clear the draft (no preview, no drag).
	 */
	function rebuildAddDraft(source: AddableEntry, variant: DerivedVariant): void {
		const draft = itemFromAddSelection(
			{ source, variant },
			core.points,
			core.controls,
			core.controlDefaults
		)
		if (draft === undefined) {
			addDraft = undefined
			addDraftPointId = undefined
			addDraftValue = undefined
			return
		}
		let pointId: string | undefined
		try {
			const id = canonicalItemPoint(draft)
			pointId = id === '' ? undefined : id
		} catch {
			pointId = undefined
		}
		const point = pointId !== undefined ? core.getDefinition(pointId) : undefined
		addDraft = draft
		addDraftPointId = pointId
		addDraftValue = liveValue(core, point)
	}

	/**
	 * Mutate the detached add-flow draft (never the live layout — the
	 * draft is not in the tree, so `patchLive`'s identity scan would
	 * no-op), then re-render the preview section in place (not the whole
	 * details panel — the configurator input keeps focus while typing).
	 */
	function patchDraft(patch: (item: import('@palettable/core').ToolbarItem) => void): void {
		if (addDraft === undefined) return
		patch(addDraft)
		refreshDraftPreview()
	}

	/**
	 * Re-render the draft preview section in place (configurator inputs
	 * keep focus + DOM identity — only the preview node rebuilds).
	 * No-op when the add panel or its preview section is absent.
	 */
	function refreshDraftPreview(): void {
		const overlay = consoleHost.querySelector('.palette-default-command-overlay')
		const panel = overlay?.querySelector('[data-testid="console-add-panel"]')
		if (!(panel instanceof HTMLElement)) return
		const old = panel.querySelector('[data-testid="console-add-preview"]')
		if (!(old instanceof HTMLElement) || addDraft === undefined) return
		dropBindingsIn(old)
		old.replaceWith(renderDraftPreview(addDraft))
	}

	/**
	 * Tool-owned config edit: mutate the live item in place (point + control
	 * created together — no core call), then re-render the borders so the
	 * tool rebuilds with its new presentation. Control-type swaps rebuild
	 * the whole tool element with initial values (see renderToolbarElement).
	 * The item is the identity — its container is resolved live, so a
	 * drag that moved it since selection still edits the same tool.
	 */
	function patchLive(
		item: import('@palettable/core').ToolbarItem,
		patch: (item: import('@palettable/core').ToolbarItem) => void
	): void {
		if (findToolbarOf(core.layout.getLayout(), item) === undefined) return
		patch(item)
		syncStructure()
	}

	function renderConfigurator(
		item: import('@palettable/core').ToolbarItem,
		inspectingItem: import('@palettable/core').ToolbarItem,
		patch: (
			item: import('@palettable/core').ToolbarItem,
			apply: (item: import('@palettable/core').ToolbarItem) => void
		) => void = (target, apply) => patchLive(target, apply),
		options: { readonly deletable?: boolean } = {}
	): HTMLElement {
		const table = el('div', 'palette-default-config-table')
		const point = pointFor(item)
		const config = ((item as { config?: Record<string, unknown> }).config ?? {}) as Record<
			string,
			unknown
		>
		// Live items resolve their border region for the control choices;
		// the detached add-flow draft is in no region → fixed top surface
		// (mirrors the preview + `controlFor` in `add-item.ts`).
		const region = regionOfItem(inspectingItem) ?? 'top'
		const surface =
			inspectingItem === item && regionOfItem(item) === undefined
				? PREVIEW_SURFACE
				: surfaceForRegion(region)
		const currentControl =
			(item as { control?: string }).control ?? defaultControlFor(point) ?? 'button'
		const choices = controlChoicesFor(
			point,
			{ axis: surface.axis === 'both' ? 'horizontal' : surface.axis, region: surface.region },
			VANILLA_CONTROL_REGISTRY,
			VANILLA_CONTROL_DEFAULTS,
			(item as { control?: string }).control
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
				: typeof (item as { point?: unknown }).point === 'string'
					? ((item as { point?: unknown }).point as string)
					: (currentControl ?? 'Item')
		row(
			'Label',
			textInput(labelValue, (next) =>
				patch(item, (target) => {
					const record = target as { config?: Record<string, unknown> }
					record.config = { ...(record.config ?? {}), label: next }
				})
			)
		)
		row(
			'Icon',
			renderIconField !== undefined
				? renderIconField({
						value: typeof config.icon === 'string' ? config.icon : '',
						onChange: (next) =>
							patch(item, (target) => {
								const record = target as { config?: Record<string, unknown> }
								record.config = { ...(record.config ?? {}), icon: next }
							}),
						choices: iconChoices,
					})
				: textInput(typeof config.icon === 'string' ? config.icon : '', (next) =>
						patch(item, (target) => {
							const record = target as { config?: Record<string, unknown> }
							record.config = { ...(record.config ?? {}), icon: next }
						})
					)
		)
		row(
			'Hint',
			textInput(typeof config.hint === 'string' ? config.hint : '', (next) =>
				patch(item, (target) => {
					const record = target as { config?: Record<string, unknown> }
					record.config = { ...(record.config ?? {}), hint: next }
				})
			)
		)
		// Single-choice points (1:1 nothing-points, single-control
		// families) bind silently — no Control row to pick from.
		const seen = new Set(choices.map((choice) => choice.id))
		if (seen.size > 1) {
			const controlSelect = document.createElement('select')
			for (const choice of choices) {
				if (controlSelect.querySelector(`option[value="${choice.id}"]`)) continue
				const option = document.createElement('option')
				option.value = choice.id
				option.textContent = choice.label
				controlSelect.append(option)
			}
			if (!seen.has(currentControl)) {
				const option = document.createElement('option')
				option.value = currentControl
				option.textContent = currentControl
				controlSelect.append(option)
			}
			controlSelect.value = currentControl
			controlSelect.addEventListener('change', () => {
				const next = controlSelect.value
				patch(item, (target) => {
					const record = target as {
						control?: string
						config?: Record<string, unknown>
					}
					record.control = next
					const cleanup = configuratorControlCleanup(next)
					if (record.config) {
						for (const key of cleanup) delete record.config[key]
					}
				})
			})
			row('Control', controlSelect)
		}
		const toneSelect = document.createElement('select')
		for (const tone of ['neutral', 'accent']) {
			const option = document.createElement('option')
			option.value = tone
			option.textContent = tone === 'neutral' ? 'Neutral' : 'Accent'
			toneSelect.append(option)
		}
		toneSelect.value = config.tone === 'accent' ? 'accent' : 'neutral'
		toneSelect.addEventListener('change', () => {
			patch(item, (target) => {
				const record = target as { config?: Record<string, unknown> }
				record.config = {
					...(record.config ?? {}),
					tone: toneSelect.value === 'accent' ? 'accent' : 'neutral',
				}
			})
		})
		row('Tone', toneSelect)
		if (currentControl === 'drawer') {
			const openSelect = document.createElement('select')
			for (const mode of ['hover', 'toggle']) {
				const option = document.createElement('option')
				option.value = mode
				option.textContent = mode[0]!.toUpperCase() + mode.slice(1)
				openSelect.append(option)
			}
			// Legacy `click` / `press` values normalize to the `toggle`
			// default (absent key); only `hover` is written explicitly.
			const openValue = config.open === 'hover' ? 'hover' : 'toggle'
			openSelect.value = openValue as string
			openSelect.dataset.testid = 'configurator-drawer-open'
			openSelect.setAttribute('aria-label', 'Open mode')
			openSelect.addEventListener('change', () => {
				patch(item, (target) => {
					const record = target as { config?: Record<string, unknown> }
					const next = { ...(record.config ?? {}) }
					if (openSelect.value === 'toggle') delete next.open
					else next.open = openSelect.value
					record.config = next
				})
			})
			row('Open mode', openSelect)
			const closeOnClickInput = document.createElement('input')
			closeOnClickInput.type = 'checkbox'
			closeOnClickInput.checked = config.closeOnClick === true
			closeOnClickInput.dataset.testid = 'configurator-drawer-close-on-click'
			closeOnClickInput.setAttribute('aria-label', 'Close on click')
			closeOnClickInput.addEventListener('change', () => {
				patch(item, (target) => {
					const record = target as { config?: Record<string, unknown> }
					const next = { ...(record.config ?? {}) }
					if (closeOnClickInput.checked) next.closeOnClick = true
					else delete next.closeOnClick
					record.config = next
				})
			})
			row('Close on click', closeOnClickInput)
		}
		if (currentControl === 'status') {
			row(
				'Status key',
				textInput(typeof config.statusKey === 'string' ? config.statusKey : '', (next) =>
					patch(item, (target) => {
						const record = target as { config?: Record<string, unknown> }
						const updated = { ...(record.config ?? {}) }
						if (next.trim() === '') delete updated.statusKey
						else updated.statusKey = next
						record.config = updated
					})
				)
			)
		}
		if (currentControl === 'slider' || currentControl === 'drawerSlider') {
			const showInput = document.createElement('input')
			showInput.type = 'checkbox'
			showInput.checked = config.showValue !== false
			showInput.dataset.testid = 'configurator-show-value'
			showInput.setAttribute('aria-label', 'Display number')
			showInput.addEventListener('change', () => {
				patch(item, (target) => {
					const record = target as { config?: Record<string, unknown> }
					const next = { ...(record.config ?? {}) }
					if (showInput.checked) delete next.showValue
					else next.showValue = false
					record.config = next
				})
			})
			row('Display number', showInput)
		}
		if (currentControl === 'select' || currentControl === 'segmented') {
			const showInput = document.createElement('input')
			showInput.type = 'checkbox'
			showInput.checked = config.showText !== false
			showInput.dataset.testid = 'configurator-show-text'
			showInput.setAttribute('aria-label', 'Show text')
			showInput.addEventListener('change', () => {
				patch(item, (target) => {
					const record = target as { config?: Record<string, unknown> }
					const next = { ...(record.config ?? {}) }
					if (showInput.checked) delete next.showText
					else next.showText = false
					record.config = next
				})
			})
			row('Show text', showInput)
		}
		if (currentControl === 'select') {
			const filterInput = document.createElement('input')
			filterInput.type = 'checkbox'
			filterInput.checked = config.showFilter === true
			filterInput.dataset.testid = 'configurator-show-filter'
			filterInput.setAttribute('aria-label', 'Filter list')
			filterInput.addEventListener('change', () => {
				patch(item, (target) => {
					const record = target as { config?: Record<string, unknown> }
					const next = { ...(record.config ?? {}) }
					if (filterInput.checked) next.showFilter = true
					else delete next.showFilter
					record.config = next
				})
			})
			row('Filter list', filterInput)
		}
		// The add-flow draft is detached (never in the layout), so there is
		// nothing to delete — the row is inspect-only (`deletable: false`
		// from `renderAddPanel`). Kept as a no-op guard regardless.
		if (options.deletable !== false) {
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
			deleteButton.textContent = 'Delete tool'
			deleteButton.addEventListener('click', () => {
				const from = locationOfItem(item)
				if (from === undefined) return
				core.layout.moveItem(from, undefined)
				inspecting = undefined
			})
			deleteValue.append(deleteButton)
			deleteLine.append(deleteKey, deleteValue)
			table.append(deleteLine)
		}
		return table
	}

	function renderAddPanel(source: AddableEntry): HTMLElement {
		const stack = el('div', 'palette-default-config-stack')
		stack.dataset.testid = 'console-add-panel'
		const header = el('div', 'palette-default-config-header')
		const strong = document.createElement('strong')
		strong.textContent = source.label
		const meta = el('span', '')
		meta.textContent = source.meta
		header.append(strong, meta)
		stack.append(header)
		// One source = one variant (`paletteDerivedVariants` returns a
		// single `set`/`tool`/`item` variant per source — action rows now
		// flow through `addableEntries`, whose `activity: 'action'` maps to
		// the legacy action branch), so there is no variant picker:
		// selecting the entry opens the configurator + preview directly.
		// Adding happens only via d&d from the preview below.
		const selected = paletteDerivedVariants(source, core.points)[0]
		if (selected === undefined) {
			const empty = el('div', 'palette-default-config-empty')
			empty.textContent = 'This entry cannot be added to a toolbar.'
			stack.append(empty)
			return stack
		}
		// The selected variant's draft: full configurator (Label/Icon/Hint/
		// Control/Tone/showValue/showText) bound to the detached draft via
		// `patchDraft`, then the disconnected preview below it.
		if (addDraft === undefined || !draftMatchesSelection(source, selected)) {
			rebuildAddDraft(source, selected)
		}
		if (addDraft !== undefined) {
			const configTitle = el('div', 'palette-default-panel-title')
			configTitle.textContent = 'Configure'
			stack.append(configTitle)
			stack.append(
				renderConfigurator(addDraft, addDraft, (_target, apply) => patchDraft(apply), {
					deletable: false,
				})
			)
			stack.append(renderDraftPreview(addDraft))
		}
		return stack
	}

	/**
	 * Whether the live `addDraft` still matches the console selection.
	 * The draft binds the point (no `=value` preset), so only entry +
	 * variant identity matter.
	 */
	function draftMatchesSelection(source: AddableEntry, variant: DerivedVariant): boolean {
		if (addDraft === undefined) return false
		const probe = itemFromAddSelection(
			{ source, variant },
			core.points,
			core.controls,
			core.controlDefaults
		)
		if (probe === undefined) return false
		return draftFingerprint(addDraft) === draftFingerprint(probe)
	}

	/** Structural fingerprint of a draft item (point + control + config). */
	function draftFingerprint(item: ToolbarItem): string {
		const point = (item as { point?: unknown }).point
		const control = (item as { control?: unknown }).control
		const config = (item as { config?: unknown }).config
		return JSON.stringify([point, control, config])
	}

	/**
	 * Disconnected preview of the draft tool: real choices/options from
	 * the point definitions, local selected value seeded from the live
	 * store. Interactions mutate the preview core only (never
	 * `core.values` / `core.run`) and re-render the preview node in
	 * place via a preview-local subscription. The preview content is
	 * the sole drag source: pointerdown clones the draft into a
	 * `catalog` session (the draft itself stays detached).
	 */
	function renderDraftPreview(draft: ToolbarItem): HTMLElement {
		const section = el('div', 'palette-default-add-preview')
		section.dataset.testid = 'console-add-preview'
		const title = el('div', 'palette-default-panel-title')
		title.textContent = 'Preview'
		section.append(title)
		const seed: Record<string, unknown> =
			addDraftPointId !== undefined && addDraftValue !== undefined
				? { [addDraftPointId]: addDraftValue }
				: {}
		const { core: previewCore, setLocal } = createPreviewCore(core, draft, seed)
		const content = el('div', 'toolbar-item-content palette-default-add-preview-content')
		content.dataset.testid = 'console-add-preview-content'
		const node = renderHeadItem({
			core: previewCore,
			item: draft,
			surface: PREVIEW_SURFACE,
			region: 'top',
			iconResolver,
			onOpenConsole: (mode) => consoleStore.open(mode),
			onInspect: undefined,
			renderToolbar: (childTrack: Track, childAxis, childRegion) =>
				renderDrawerTrack(childTrack, childAxis, childRegion, false),
		})
		if (node) content.append(node)
		bindPreview(content, draft, previewCore, setLocal)
		// The preview is the sole drag source (not the variant triggers
		// above): pointerdown clones the detached draft into a creation
		// session. Inputs inside the preview keep their gestures (value
		// inputs, select listboxes, drawer popups) — only the background
		// starts the drag.
		content.addEventListener('pointerdown', (event) => {
			if (isEditableTarget(event.target)) return
			if ((event.target as HTMLElement | null)?.closest?.('input, select, textarea')) return
			startCatalogDrag(event, structuredCloneDraft(draft))
		})
		section.append(content)
		return section
	}

	/** Deep-clone a draft item for the drag payload (the draft stays detached). */
	function structuredCloneDraft(draft: ToolbarItem): ToolbarItem {
		return JSON.parse(JSON.stringify(draft)) as ToolbarItem
	}

	/**
	 * Subscribe a preview node to its preview-local value (per-id,
	 * in-place update — never a structural sync). Mirrors `bindTool`
	 * but against the preview core: valued controls follow the preview
	 * `values.subscribe(id)`; action buttons follow live `subscribeCan`
	 * flips; nothing-point tools follow live `subscribeContext` for
	 * their used bags. Unowned by the layout — dropped with the details
	 * panel (`renderConsoleDetailsInto` drops bindings in the old panel).
	 */
	function bindPreview(
		content: HTMLElement,
		item: ToolbarItem,
		previewCore: PreviewCore,
		setLocal: (id: string, value: unknown) => void
	): void {
		const control = (item as { control?: unknown }).control
		const pointId = pointIdOf(item)
		const point = pointId !== undefined ? core.getDefinition(pointId) : undefined
		if (point === undefined) return
		const update = () => updateToolNode(previewCore, item, PREVIEW_SURFACE, content, iconResolver)
		const unsubs: Unsubscribe[] = []
		if (isValuedPoint(point)) {
			unsubs.push(previewCore.values.subscribe(point.id, () => update()))
			// Preview-local seed never follows the live store after seed:
			// a live value change mid-preview would rebuild the panel
			// anyway (details re-render), so no live subscription here.
			void setLocal
		} else if (isActionPoint(point) && control === 'button') {
			unsubs.push(
				core.subscribeCan((id) => {
					if (id === point.id) update()
				})
			)
		} else if (!isValuedPoint(point)) {
			if ((point.uses ?? []).length > 0) {
				unsubs.push(
					core.subscribeContext((bagName, _changed) => {
						if (!(point.uses ?? []).includes(bagName)) return
						update()
					})
				)
			}
		}
		if (unsubs.length > 0) toolBindings.set(content, unsubs)
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
		const touchesDrawer =
			op.from?.container === 'drawer' ||
			op.to?.container === 'drawer' ||
			op.pruned.some((victim) => victim.from.container === 'drawer')
		if (touchesDrawer) {
			// Drawer content re-renders from the live child tracks (open
			// popups stay open — `renderDrawerTrack` rebuilds bars only).
			syncOpenDrawers()
		}
		const touchesBorder =
			op.from?.container === 'border' ||
			op.to?.container === 'border' ||
			op.pruned.some((victim) => victim.from.container === 'border')
		if (!touchesBorder) {
			if (dragSession) rearmSlideAfterStructure()
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
	 * Re-render open drawer popups from the live child tracks (drawer-side
	 * structure events). Open state is preserved: only the popup's inner
	 * track rebuilds, so the drawer stays open mid-drag while its bars
	 * refresh around the commit.
	 */
	function syncOpenDrawers(): void {
		// Full-structure path would drop popup open state (borders rebuild
		// drawer wrappers closed). Instead re-render each open popup's inner
		// track in place from its live drawer item.
		syncOpenDrawerTracks()
	}

	/** In-place rebuild of open popup inner tracks from live drawer items. */
	function syncOpenDrawerTracks(): void {
		const editing = computeEditing()
		for (const popup of document.querySelectorAll('.palettable-drawer__popup')) {
			if (!(popup instanceof HTMLElement) || popup.hidden) continue
			const inner = popup.querySelector(':scope > [data-drawer-track]')
			if (!(inner instanceof HTMLElement)) continue
			// The drawer item owns the child track: resolve it by scanning
			// live drawer toolbars for the bars inside this popup. When the
			// popup holds no bars (emptied drawer toolbar), fall back to the
			// drawer item behind the trigger (identity scan from the border).
			const bars = [...popup.querySelectorAll(':scope .toolbar')]
			let childTrack: Track | undefined
			if (bars.length > 0) {
				const firstToolbar = toolbarOfBar(bars[0] as HTMLElement)
				if (firstToolbar !== undefined) childTrack = drawerChildTrackOf(firstToolbar)
			}
			if (childTrack === undefined) childTrack = drawerChildTrackOfPopup(popup)
			if (childTrack === undefined) continue
			// Rebuild axis from the popup's own `--layout` (the single
			// source of truth — the wrapper carries no axis).
			const layout = popup.style.getPropertyValue('--layout').trim()
			const axis: 'horizontal' | 'vertical' = layout === 'vertical' ? 'vertical' : 'horizontal'
			// Preserve the center-seeked content region across the rebuild
			// (the popup's own `--region`): re-deriving from the axis
			// would reset nested popups to the parent-region default.
			const region =
				(popup.style.getPropertyValue('--region').trim() as PaletteRegion | '') ||
				(axis === 'vertical' ? 'left' : 'top')
			dropBindingsIn(inner)
			inner.textContent = ''
			const fresh = renderDrawerTrack(childTrack, axis, region, editing)
			// `renderDrawerTrack` returns the wrap itself — move its children.
			for (const child of [...fresh.childNodes]) inner.append(child)
			clearGapClasses(inner)
		}
	}

	/** Child track of the drawer item owning `popup` (via trigger → item node). */
	function drawerChildTrackOfPopup(popup: HTMLElement): Track | undefined {
		const wrapper = popup.closest('.palettable-drawer')
		if (!(wrapper instanceof HTMLElement)) return undefined
		const trigger = wrapper.querySelector('.palettable-drawer__trigger')
		if (!(trigger instanceof HTMLElement)) return undefined
		// The trigger lives inside the tool content → item wrapper. Walk up
		// to the `[data-item-index]` wrapper, then resolve the item object
		// via position (the node map is object → node, so scan live items
		// for the wrapper identity).
		const itemWrapper = trigger.closest('[data-item-index]')
		if (!(itemWrapper instanceof HTMLElement)) return undefined
		const item = drawerItemOfWrapper(itemWrapper)
		if (item === undefined) return undefined
		const child = (item as { control?: unknown; toolbar?: unknown }).toolbar
		if ((item as { control?: unknown }).control !== 'drawer' || !Array.isArray(child))
			return undefined
		return child as Track
	}

	/** Reverse lookup: live drawer `ToolbarItem` behind a rendered item wrapper. */
	function drawerItemOfWrapper(wrapper: HTMLElement): ToolbarItem | undefined {
		// Items are keyed by wrapper in the node map — but the map is
		// object → node (not node → object), so scan live items for the
		// wrapper identity.
		const live = core.layout.getLayout()
		const visitToolbar = (toolbar: Toolbar): ToolbarItem | undefined => {
			for (const item of toolbar) {
				if (nodes.get(item) === wrapper) return item
				const child = (item as { control?: unknown; toolbar?: unknown }).toolbar
				if ((item as { control?: unknown }).control !== 'drawer' || !Array.isArray(child)) continue
				for (const slot of child as Track) {
					const found = visitToolbar(slot.toolbar)
					if (found !== undefined) return found
				}
			}
			return undefined
		}
		for (const region of REGIONS) {
			for (const track of live.borders[region]) {
				for (const slot of track) {
					const found = visitToolbar(slot.toolbar)
					if (found !== undefined) return found
				}
			}
		}
		for (const parked of live.parking) {
			const found = visitToolbar(parked)
			if (found !== undefined) return found
		}
		return undefined
	}

	/** Child track holding `toolbar` (drawer identity scan). */
	function drawerChildTrackOf(toolbar: Toolbar): Track | undefined {
		const live = core.layout.getLayout()
		const visit = (track: Track): Track | undefined => {
			for (const slot of track) {
				if (slot.toolbar === toolbar) return track
				for (const item of slot.toolbar) {
					const child = (item as { control?: unknown; toolbar?: unknown }).toolbar
					if ((item as { control?: unknown }).control !== 'drawer' || !Array.isArray(child))
						continue
					const found = visit(child as Track)
					if (found !== undefined) return found
				}
			}
			return undefined
		}
		for (const region of REGIONS) {
			for (const track of live.borders[region]) {
				const found = visit(track)
				if (found !== undefined) return found
			}
		}
		for (const parked of live.parking) {
			for (const item of parked) {
				const child = (item as { control?: unknown; toolbar?: unknown }).toolbar
				if ((item as { control?: unknown }).control !== 'drawer' || !Array.isArray(child)) continue
				const found = visit(child as Track)
				if (found !== undefined) return found
			}
		}
		return undefined
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
				if (op.from.container === 'drawer' || op.to.container === 'drawer') syncOpenDrawerTracks()
				return
			}
			case 'remove-item': {
				if (op.at.container === 'border') syncBorder(op.at.region)
				else if (op.at.container === 'drawer') syncOpenDrawerTracks()
				else syncStructure()
				return
			}
			case 'insert-item': {
				if (op.at.container === 'border') syncBorder(op.at.region)
				else if (op.at.container === 'drawer') syncOpenDrawerTracks()
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
				if (op.from?.container === 'drawer' || op.to?.container === 'drawer') syncOpenDrawerTracks()
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
		if (disposed) return
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
		const runnable = keys.resolve(event)
		if (!runnable) return
		try {
			// Steps are bounds-gated: a press at the bound is a no-op (no
			// preventDefault — the keystroke stays free for the host),
			// mirroring the disabled stepper button. `core.run` still
			// clamps as a backstop.
			if (runnable.kind === 'inc' || runnable.kind === 'dec') {
				let can = true
				try {
					can = core.can(runnable)
				} catch {
					return
				}
				if (!can) return
			}
			event.preventDefault()
			event.stopPropagation()
			core.run(runnable)
		} catch {
			// Unresolvable bindings never break typing.
		}
	}

	// Global shortcuts: listen on the window so bindings fire even when
	// focus is outside the IDE (body, demo chrome, …). Typing still wins
	// via `isEditableTarget`, and `defaultPrevented` keeps us from
	// double-handling events a child already consumed.
	const keyWindow = container.ownerDocument.defaultView ?? window
	keyWindow.addEventListener('keydown', onKeyDown)
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
		if (state.selectedEntryId === lastAddSelection?.entryId) {
			return
		}
		lastAddSelection =
			state.selectedEntryId !== undefined ? { entryId: state.selectedEntryId } : undefined
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
			keyWindow.removeEventListener('keydown', onKeyDown)
			consoleHost.textContent = ''
			// Hierarchical drawers die with their trigger (no body portal),
			// so nothing to sweep — the svelte-oracle overlay selector is
			// kept only for foreign portaled nodes, if any.
			for (const overlay of document.querySelectorAll('body > .palettable-drawer__overlay')) {
				overlay.remove()
			}
			core.dispose()
		},
	}
}

export { axisForRegion, validateSerializedLayout }
