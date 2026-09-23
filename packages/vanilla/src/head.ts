/**
 * `@palettable/vanilla` — default head controls (plain-DOM renderers).
 *
 * Each control renders one toolbar item into an `HTMLElement` from a core
 * presenter view-model (button/toggle/select/segmented/slider/stepper/stars/
 * status/theme/commandBox/drawer). Presentation only: all reads go through core
 * presenters, all writes through `core.run(runnable)` / `core.values.set`.
 * Status/commandBox/drawer/theme tools bind nothing-points (1:1 — one tool,
 * one nothing-point whose `uses` names its context); display state comes
 * from the resolved bags, never from `core.values`.
 * Mirrors the svelte default head + the demo
 * overrides (value badge, rating row).
 */

import {
	type ActionableEntry,
	type AnyPoint,
	type AnyValuedPoint,
	actionableEntries,
	axisForRegion,
	buttonPresenter,
	canonicalItemPoint,
	configuration,
	drawerChildRegionFor,
	drawerCloseOnClickOf,
	drawerOpenOf,
	filterCommandEntries,
	isActionPoint,
	isDrawerItem,
	isValuedPoint,
	type PaletteCore,
	type PaletteRegion,
	type Runnable,
	type SurfaceContext,
	selectClosedLabel,
	selectPresenter,
	sliderPresenter,
	statusPresenter,
	type ToolbarItem,
	type Track,
	themePresenter,
	togglePresenter,
	type ValuesBag,
} from '@palettable/core'

import {
	buttonShellTemplate,
	commandBoxShellTemplate,
	commandEmptyTemplate,
	commandResultRowTemplate,
	drawerPopupShellTemplate,
	drawerTriggerShellTemplate,
	elementFromHtml,
	segmentedOptionShellTemplate,
	segmentedShellTemplate,
	sel,
	selectFilterShellTemplate,
	selectOptionShellTemplate,
	selectShellTemplate,
	sliderShellTemplate,
	splitStatusTime,
	starsShellTemplate,
	statusShellTemplate,
	stepperShellTemplate,
} from './templates.js'
import { applyThemeSetting } from './theme.js'

/** Consumer icon resolver: maps an `IconToken` to its rendered glyph
 * (string-to-string only — keeps `textContent` + `escapeHtml` safety, no
 * DOM/SVG injection). Return `undefined` to keep the token as-is. */
export type IconResolver = (token: string) => string | undefined

/** Resolve one icon token through an optional resolver. `undefined`/empty
 * pass through untouched (still handled as absent by `fillIcon`/`takeIcon`);
 * unknown `icon:` names fall back to the raw token (debuggable, never blank). */
export function resolveIcon(
	token: string | undefined,
	resolver?: IconResolver
): string | undefined {
	if (token === undefined || token === '') return token
	if (resolver === undefined) return token
	return resolver(token) ?? token
}

export type HeadContext = {
	readonly core: PaletteCore | PreviewCore
	readonly item: ToolbarItem
	readonly surface: SurfaceContext
	readonly region?: PaletteRegion
	/** Optional string-glyph resolver: maps an `IconToken` to its rendered
	 * glyph. `undefined` return (or absent resolver) keeps the token as-is,
	 * so emoji passthrough is the default. Consumer-owned (e.g. the demo
	 * maps `icon:moon` via a hard-coded dictionary). */
	readonly iconResolver?: IconResolver
	readonly onOpenConsole?: (mode: 'run' | 'edit') => void
	readonly onInspect?: (item: ToolbarItem) => void
	/** Track an open drawer popup so the adapter can reposition it on layout change. */
	readonly onOpenDrawer?: (
		trigger: HTMLElement,
		popup: HTMLElement,
		surfaceAxis: 'horizontal' | 'vertical'
	) => void
	readonly onCloseDrawer?: (trigger: HTMLElement) => void
	readonly renderToolbar?: (
		toolbar: Track,
		axis: 'horizontal' | 'vertical',
		region: PaletteRegion
	) => HTMLElement
	/** Edit-mode drag state for drawer hover-open (threaded from the adapter). */
	readonly isEditing?: () => boolean
	readonly isDragging?: () => boolean
	/** Hierarchy close: close open drawers not containing `target`. */
	readonly closeUnrelatedDrawers?: (target: EventTarget | null) => void
	/** Test-only geometry override for the drawer center-seeking flip
	 * (jsdom reports zero rects): when provided, `renderDrawer` uses
	 * these instead of live `getBoundingClientRect()` reads. */
	readonly ideRect?: { left: number; top: number; width: number; height: number }
	readonly triggerRect?: { left: number; top: number; width: number; height: number }
}

/** Fill a shelled icon node: show + set glyph, or hide when absent.
 * An empty string is treated as absent (dev-time warn): it would unhide an
 * empty-but-space-reserving node (`width: 1rem` + parent gap). */
function fillIcon(node: HTMLElement | undefined, icon: string | undefined): void {
	if (node === undefined) return
	if (icon === undefined || icon === '') {
		if (icon === '' && typeof console !== 'undefined') {
			console.warn('[palettable] fillIcon received empty-string icon; treating as absent')
		}
		node.hidden = true
		return
	}
	node.hidden = false
	node.textContent = icon
}

/** Remove a shelled icon node when the view carries no icon (no reserved
 * space); otherwise fill it. Returns the surviving node (or `undefined`). */
function takeIcon(
	node: HTMLElement | undefined,
	icon: string | undefined
): HTMLElement | undefined {
	if (node === undefined) return undefined
	if (icon === undefined || icon === '') {
		if (icon === '' && typeof console !== 'undefined') {
			console.warn('[palettable] takeIcon received empty-string icon; removing node')
		}
		node.remove()
		return undefined
	}
	node.hidden = false
	node.textContent = icon
	return node
}

/** Stylised skeleton watermark for a select with no matching option (`?`).
 * Own class (never `.palette-default-choice`) so label selectors and the
 * overlay/joint `:has` rules never match it. */
export function selectWatermark(): HTMLElement {
	const node = document.createElement('span')
	node.className = 'palette-default-select-watermark'
	node.textContent = '?'
	node.setAttribute('aria-hidden', 'true')
	return node
}

export function boundOf(
	core: PaletteCore | PreviewCore,
	pointId: string | undefined
): {
	point: AnyPoint | undefined
	value: unknown
	bags: readonly (import('@palettable/core').ValuesBag | undefined)[]
} {
	const point = pointId !== undefined ? core.getDefinition(pointId) : undefined
	const bags = core.resolveBags(point?.uses)
	return { point, value: liveValue(core, point), bags }
}

/**
 * Read the live value for a bound point: dual-source precedence
 * (context-display) — first non-root used bag holding the id wins, else
 * the root value. Absent bag / absent key → root. Nothing-points carry no
 * value (always `undefined` — display state comes from the bags).
 * Shared by initial render (`boundOf`) and in-place updates
 * (`ide.ts:updateToolNode`). Delegates to `core.readValue` (the single
 * read path over plain point ids).
 */
export function liveValue(core: PaletteCore | PreviewCore, point: AnyPoint | undefined): unknown {
	if (point === undefined || !isValuedPoint(point)) return undefined
	try {
		return core.readValue(point.id)
	} catch {
		return undefined
	}
}

function pointIdOf(item: ToolbarItem): string | undefined {
	const point = (item as { point?: unknown }).point
	if (typeof point !== 'string') return undefined
	const id = canonicalItemPoint(item)
	return id === '' ? undefined : id
}

/** Bubbling activation event: a command / toggle / segmented inside a drawer
 * fired. `renderDrawer` wrappers listen for it and run the recursive
 * close-on-click chain. Dispatched AFTER `core.run(...)` so the action
 * always lands even when no drawer is listening. */
export const DRAWER_ITEM_ACTIVATE_EVENT = 'palettable-drawer-item-activate'

/** Dispatch the drawer item-activate event from an inner control node. */
export function notifyDrawerItemActivate(node: HTMLElement): void {
	node.dispatchEvent(new CustomEvent(DRAWER_ITEM_ACTIVATE_EVENT, { bubbles: true }))
}

/** Per-drawer close-on-click chain entry (innermost first). */
export type DrawerChainEntry = {
	readonly close: () => void
	readonly closeOnClick: boolean
	readonly openMode: 'hover' | 'toggle'
}

/**
 * Resolve which drawer chain entries to close after an inner activation.
 * Rule ("keep from top, remove from bottom", `keep && !remove`):
 * - pass 1 (bottom-up): mark remove from the leaf upward while
 *   `closeOnClick === true`, stopping (exclusive) at the first `false`.
 * - pass 2: mark remove from the leaf up to AND including the highest
 *   (outermost) ancestor with `open === 'hover'`.
 * The final set is the max / outermost of the two extents: indices
 * `0 .. max(removeEnd1, removeEnd2)`.
 * Returns the indices into `chain` (innermost-first) to close.
 */
export function drawerCloseChainIndices(chain: readonly DrawerChainEntry[]): readonly number[] {
	let end1 = -1
	for (let index = 0; index < chain.length; index++) {
		if (chain[index]?.closeOnClick !== true) break
		end1 = index
	}
	let end2 = -1
	for (let index = 0; index < chain.length; index++) {
		if (chain[index]?.openMode === 'hover') end2 = index
	}
	const end = Math.max(end1, end2)
	if (end < 0) return []
	return chain.slice(0, end + 1).map((_, index) => index)
}

/** Render a `button` (action) item. */
export function renderButton(context: HeadContext): HTMLElement {
	const { core, item } = context
	const resolver = context.iconResolver
	const pointId = pointIdOf(item) ?? ''
	const { point, bags } = boundOf(core, pointIdOf(item))
	const can = point !== undefined && isActionPoint(point) ? core.evaluateCan(point.id) : true
	const view = buttonPresenter(
		item,
		{ point, value: undefined, bags },
		{ kind: 'action', point: pointId },
		can
	)
	const [button, icon, label] = sel(
		buttonShellTemplate({ tone: view.tone }),
		'.palette-default-icon',
		'.palette-default-choice'
	)
	const btn = button as HTMLButtonElement
	btn.disabled = !view.can
	btn.title = view.title
	if (view.icon === undefined) icon.remove()
	else fillIcon(icon, resolveIcon(view.icon, resolver))
	label.textContent = view.label
	btn.addEventListener('click', () => {
		core.run(view.run)
		notifyDrawerItemActivate(btn)
	})
	return btn
}

/** Render a `toggle` (boolean) item. Skeleton (`pressed === undefined`) renders unpressed + `aria-pressed="mixed"`; a context tool with no value is disabled (`view.can === false`). */
export function renderToggle(context: HeadContext): HTMLElement {
	const { core, item } = context
	const resolver = context.iconResolver
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = togglePresenter(item, { point, value, bags })
	const [button, icon] = sel(
		buttonShellTemplate({ tone: view.tone, compact: true, pressed: view.pressed }),
		'.palette-default-icon'
	)
	const btn = button as HTMLButtonElement
	btn.disabled = !view.can
	btn.title = view.title
	fillIcon(icon, resolveIcon(view.icon, resolver))
	// Recompute the toggle spec at click time: `view.toggle` is captured
	// from render and goes stale after the first click (false→true would
	// replay forever, never unticking). Fresh read → run.
	btn.addEventListener('click', () => {
		const fresh = boundOf(core, pointIdOf(item))
		const live = togglePresenter(item, fresh)
		if (!live.can) return
		core.run(live.toggle)
		notifyDrawerItemActivate(btn)
	})
	return btn
}

/** Render a `select` (enum dropdown) item.
 * Custom button + listbox (no native `<select>`): the closed trigger always
 * shows the tool icon (when declared) *and* the value icon — icon+value,
 * like numerics — stacked vertically on a vertical toolbar (tool icon above,
 * value icon below, mirroring the vertical stepper readout). The closed
 * label follows `selectClosedLabel` (`showText` + `choiceDisplay`, icon-less
 * fallback keeps the label); the list always renders icon + full text and
 * opens on click only (never hover). On a vertical toolbar with text enabled
 * the label is a hover/focus overlay extending the icon stack into an
 * icon+text select box (segmented pattern), so the toolbar never resizes. */
export function renderSelect(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const resolver = context.iconResolver
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = selectPresenter(item, { point, value, bags }, surface)
	const closedLabel = selectClosedLabel(view)
	const [box, trigger, _chip, toolIcon, valueIcon, label] = sel(
		selectShellTemplate({
			tone: view.tone,
			direction: view.direction,
			iconOnly: closedLabel === undefined,
		}),
		'.palette-default-select-trigger',
		'.palette-default-select-value',
		'.palette-default-tool-icon',
		'.palette-default-value-icon',
		'.palette-default-choice'
	)
	box.title = view.title
	const triggerBtn = trigger as HTMLButtonElement
	// Context tool with no value (skeleton) or explicit `can: false` → the
	// trigger is disabled: there is nothing to write to.
	triggerBtn.disabled = !view.can
	// Tool icon first (when declared), then the value icon — icon+value, like
	// numerics. Absent icons are REMOVED (not hidden) so no space is
	// reserved. Skeleton (`isSkeleton`) renders the tool icon + a `?`
	// watermark instead of the closed label, so the trigger is never empty.
	takeIcon(toolIcon, resolveIcon(view.toolIcon, resolver))
	takeIcon(valueIcon, resolveIcon(view.icon, resolver))
	if (view.isSkeleton) {
		label.replaceWith(selectWatermark())
	} else if (closedLabel === undefined) label.remove()
	else label.textContent = closedLabel
	const list = box.querySelector('.palette-default-select-list') as HTMLElement
	let filterInput: HTMLInputElement | null = null
	let filterEmpty: HTMLElement | null = null
	const closeList = (): void => {
		list.hidden = true
		triggerBtn.setAttribute('aria-expanded', 'false')
		// Clear any viewport flip so the next open re-measures from CSS.
		list.style.top = ''
		list.style.bottom = ''
		// Reset the filter query so the next open starts unfiltered.
		if (filterInput) {
			filterInput.value = ''
			for (const row of list.querySelectorAll('.palette-default-select-option')) {
				;(row as HTMLElement).hidden = false
			}
			if (filterEmpty) filterEmpty.hidden = true
		}
	}
	// Opt-in text filter (`config.showFilter === true`): an input row pinned
	// at the top of the list. Typing hides non-matching rows (`hidden`, no
	// rebuild) by case-insensitive substring over label + value; Enter runs
	// the first visible row; Escape closes + refocuses the trigger. The
	// query clears on close and survives `updateToolNode` syncs while open
	// (syncs never touch the filter row).
	if (view.showFilter) {
		const [filterWrap, input, empty] = sel(
			selectFilterShellTemplate({}),
			'.palette-default-select-filter-input',
			'.palette-default-command-empty'
		)
		filterInput = input as HTMLInputElement
		filterEmpty = empty
		list.append(filterWrap)
		const applyFilter = (): void => {
			const term = (filterInput?.value ?? '').trim().toLowerCase()
			let visible = 0
			for (const row of list.querySelectorAll('.palette-default-select-option')) {
				const value = (row as HTMLElement).dataset.value ?? ''
				const label = row.querySelector('.palette-default-choice')?.textContent ?? ''
				const match = term === '' || `${label} ${value}`.toLowerCase().includes(term)
				;(row as HTMLElement).hidden = !match
				if (match) visible += 1
			}
			if (filterEmpty) filterEmpty.hidden = visible > 0
		}
		filterInput.addEventListener('input', applyFilter)
		filterInput.addEventListener('click', (event) => event.stopPropagation())
		filterInput.addEventListener('keydown', (event) => {
			event.stopPropagation()
			if (event.key === 'Enter') {
				event.preventDefault()
				const first = [...list.querySelectorAll('.palette-default-select-option')].find(
					(row) => !(row as HTMLElement).hidden && !(row as HTMLButtonElement).disabled
				)
				if (first instanceof HTMLButtonElement) {
					void core.run(view.select((first as HTMLElement).dataset.value ?? ''))
					closeList()
					triggerBtn.focus()
				}
			} else if (event.key === 'Escape') {
				closeList()
				triggerBtn.focus()
			}
		})
	}
	for (const option of view.listOptions) {
		const [row, rowIcon, rowText] = sel(
			selectOptionShellTemplate({
				value: option.value,
				selected: view.value === option.value,
				can: option.can,
			}),
			'.palette-default-choice-icon',
			'.palette-default-choice'
		)
		fillIcon(rowIcon, resolveIcon(option.icon, resolver))
		if (option.icon === undefined) rowIcon.remove()
		rowText.textContent = option.label
		row.addEventListener('click', (event) => {
			event.stopPropagation()
			void core.run(view.select(option.value))
			closeList()
		})
		list.append(row)
	}
	triggerBtn.addEventListener('click', (event) => {
		event.stopPropagation()
		// Single-open: close any other open select list first.
		for (const other of document.querySelectorAll('.palette-default-select-list:not([hidden])')) {
			if (other !== list) {
				other.setAttribute('hidden', '')
				const otherTrigger = other.parentElement?.querySelector('.palette-default-select-trigger')
				otherTrigger?.setAttribute('aria-expanded', 'false')
			}
		}
		const open = list.hidden
		list.hidden = !open
		triggerBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
		if (open) {
			// Drawer popups sit at an arbitrary viewport height (unlike
			// border tracks, where `region: bottom` flips the list up via
			// CSS). Flip up when the dropped list would run off-screen so
			// it floats like in the border tracks instead of pushing a
			// drawer scrollbar / viewport clip.
			requestAnimationFrame(() => {
				if (list.hidden) return
				const rect = list.getBoundingClientRect()
				if (rect.bottom > window.innerHeight - 8 && rect.height < window.innerHeight - 16) {
					list.style.top = 'auto'
					list.style.bottom = 'calc(100% + 4px)'
				}
			})
		}
	})
	// Clicking anywhere outside the box closes the list; Escape closes it and
	// returns focus to the trigger.
	document.addEventListener(
		'click',
		(event) => {
			if (!list.hidden && !box.contains(event.target as Node | null)) closeList()
		},
		{ capture: true }
	)
	triggerBtn.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !list.hidden) {
			event.stopPropagation()
			closeList()
			triggerBtn.focus()
		}
	})
	return box
}

/** Render a `segmented` (enum joined-buttons) item.
 * The option labels are optional (`config.showText === false` hides them,
 * leaving icon-only buttons on both axes), so a segmented stays readable
 * without widening the toolbar when shown. */
export function renderSegmented(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const resolver = context.iconResolver
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = selectPresenter(item, { point, value, bags }, surface)
	const [group] = sel(
		segmentedShellTemplate({
			tone: view.tone,
		})
	)
	group.title = view.title
	for (const option of view.options) {
		const [button, icon, text] = sel(
			segmentedOptionShellTemplate({
				value: option.value,
				selected: view.value === option.value,
				can: option.can && view.can,
			}),
			'.palette-default-choice-icon',
			'.palette-default-choice'
		)
		button.title = option.text
		// Absent option icons are REMOVED so no space is reserved; an
		// option with no icon keeps its label as a fallback so the button
		// is never empty.
		if (option.icon === undefined) icon.remove()
		else fillIcon(icon, resolveIcon(option.icon, resolver))
		// `showText: false` hides the label (icon-only on both axes); an
		// option with no icon keeps its label as a fallback so the button
		// is never empty.
		const label = view.showText
			? option.label
			: option.icon === undefined
				? (option.label ?? option.value)
				: undefined
		if (label === undefined) text.remove()
		else {
			text.hidden = false
			text.textContent = label
		}
		button.addEventListener('click', () => {
			core.run(view.select(option.value))
			notifyDrawerItemActivate(button)
		})
		group.append(button)
	}
	return group
}

/** Render a `slider` (number range) item.
 * The view-model picks the range layout (`inline` vs `drawer`); the value
 * readout next to the icon is optional (`config.showValue === false` hides
 * the number, leaving an icon-only chip), so a drawer slider stays readable
 * without opening the range when shown. */
export function renderSlider(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const resolver = context.iconResolver
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = sliderPresenter(item, { point, value, bags }, surface)
	const [label, icon, input] = sel(
		sliderShellTemplate({
			variant: view.variant,
			tone: view.tone,
			iconOnly: !view.showValue,
		}),
		'.palette-default-slider-value > .palette-default-icon',
		'input[type="range"]'
	)
	label.title = view.title
	// The readout mirrors the stepper readout exactly: the icon nests inside
	// the value chip (icon + text), so both read as one bordered chip.
	fillIcon(icon, resolveIcon(view.icon, resolver))
	if (view.showValue) label.querySelector('.palette-default-slider-value')?.append(view.text)
	const range = input as HTMLInputElement
	range.min = String(view.min)
	range.max = String(view.max)
	range.step = String(view.step)
	range.value = String(view.value ?? view.min)
	range.disabled = !view.can
	range.setAttribute('aria-label', view.title)
	range.addEventListener('input', () => {
		if (point?.id === undefined) return
		try {
			core.writeValue(point.id, Number(range.value))
		} catch {
			// Skeleton (no value anywhere): thumb has nothing to write to.
		}
	})
	return label
}

/** Render a `stepper` (number ±) item. */
export function renderStepper(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const resolver = context.iconResolver
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = sliderPresenter(item, { point, value, bags }, surface)
	const [group, minus, icon, readout, plus] = sel(
		stepperShellTemplate({ tone: view.tone }),
		'button:first-of-type',
		'.palette-default-stepper-value > .palette-default-icon',
		'.palette-default-stepper-value',
		'button:last-of-type'
	)
	group.title = view.title
	// Recompute the base value at click time: `view.value` is captured
	// from render and goes stale after the first click (repeated + would
	// replay the same write forever). Fresh read → step → write.
	const stepFromLive = (direction: 1 | -1): void => {
		if (point?.id === undefined) return
		try {
			const live = sliderPresenter(
				item,
				{ point, value: liveValue(core, point), bags: core.resolveBags(point?.uses) },
				surface
			)
			if (live.value === undefined) return
			core.writeValue(
				point.id,
				direction === 1
					? Math.min(live.max, live.value + live.step)
					: Math.max(live.min, live.value - live.step)
			)
		} catch {
			// Skeleton: nothing to write to.
		}
	}
	;(minus as HTMLButtonElement).disabled =
		!view.can || view.value === undefined || view.value - view.step < view.min
	;(minus as HTMLButtonElement).addEventListener('click', () => {
		stepFromLive(-1)
	})
	fillIcon(icon, resolveIcon(view.icon, resolver))
	readout.append(String(view.value))
	;(plus as HTMLButtonElement).disabled =
		!view.can || view.value === undefined || view.value + view.step > view.max
	;(plus as HTMLButtonElement).addEventListener('click', () => {
		stepFromLive(1)
	})
	return group
}

/** Render a `stars` (number rating) item — demo extension the head lacks. */
export function renderStars(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const resolver = context.iconResolver
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = sliderPresenter(item, { point, value, bags }, surface)
	const [group, icon] = sel(
		starsShellTemplate({ tone: view.tone, max: view.max }),
		':scope > .palette-default-icon'
	)
	group.title = view.title
	fillIcon(icon, resolveIcon(view.icon, resolver))
	const buttons = [...group.querySelectorAll('.palette-default-arrow')] as HTMLButtonElement[]
	buttons.forEach((button, offset) => {
		const index = offset + 1
		const filled = view.value !== undefined && index <= view.value
		button.classList.toggle('is-selected', filled)
		button.setAttribute('aria-checked', index === view.value ? 'true' : 'false')
		button.title = `${view.title} ${index}`
		button.textContent = filled ? '▶' : '▷'
		button.disabled = !view.can
		button.addEventListener('click', () => {
			if (point?.id === undefined) return
			try {
				core.writeValue(point.id, index)
			} catch {
				// Skeleton: nothing to write to.
			}
		})
	})
	return group
}

/** Read the current theme setting from the document root (`data-theme`, default `system`). Exported for `ide.ts` in-place updates. */
export function readThemeSetting(): 'light' | 'dark' | 'system' {
	if (typeof document === 'undefined') return 'system'
	const raw = document.documentElement.dataset.theme
	return raw === 'light' || raw === 'dark' ? raw : 'system'
}

/** Read the next theme value from a cycle runnable. */
function nextCycleValue(cycle: Runnable): 'light' | 'dark' | 'system' {
	const next = cycle.kind === 'set' ? cycle.value : undefined
	return next === 'light' || next === 'dark' ? next : 'system'
}

/** Render a `theme` tool bound to the enum-shaped `theme` nothing-point
 * (`light`/`dark`/`system` options). Get/set lives adapter-side: the
 * current setting is read from the document root (`data-theme` /
 * `palette-default-theme-light` class, `system` default) and writes go
 * through `applyThemeSetting` — never through `core.values`.
 * Applies the resolved theme to the document root on render + every click
 * (`head-light.css` keys off `.palette-default-theme-light`, so
 * body-portaled drawer popups follow the same switch). Icon-value only
 * (current option icon, no text — like the toggle): the button is a compact
 * icon square. Skeleton renders the tool icon only. */
export function renderTheme(context: HeadContext): HTMLElement {
	const { core, item } = context
	const resolver = context.iconResolver
	const { point, bags } = boundOf(core, pointIdOf(item))
	const value = readThemeSetting()
	const view = themePresenter(item, { point, value, bags })
	const [button, icon, label] = sel(
		buttonShellTemplate({ tone: view.tone, compact: true }),
		'.palette-default-icon',
		'.palette-default-choice'
	)
	const btn = button as HTMLButtonElement
	btn.title = view.title
	btn.dataset.testid = 'theme-tool'
	if (view.valueIcon === undefined) icon.remove()
	else fillIcon(icon, resolveIcon(view.valueIcon, resolver))
	label.remove()
	if (point === undefined) {
		btn.disabled = true
		return btn
	}
	if (typeof document !== 'undefined') {
		applyThemeSetting(document.documentElement, view.value)
	}
	btn.addEventListener('click', () => {
		// Recompute the cycle at click time: `view.cycle` is captured from
		// render and goes stale after the first click (system→light would
		// replay forever). Fresh read → apply next value to the root, then
		// refresh the icon in place (theme has no core value subscription —
		// the document root is the source of truth).
		const fresh = boundOf(core, pointIdOf(item))
		const next = themePresenter(item, { ...fresh, value: readThemeSetting() })
		const applied = nextCycleValue(next.cycle)
		applyThemeSetting(document.documentElement, applied)
		const synced = themePresenter(item, { ...fresh, value: applied })
		fillIcon(icon, resolveIcon(synced.valueIcon, resolver))
		btn.title = synced.title
	})
	return btn
}

/** Render a `status` tool bound to a nothing-point (read-only display from context bags).
 * Horizontal: icon + single value. Vertical: icon above minutes above
 * seconds in a pinned square (`splitStatusTime`); non-time strings fall
 * back to the single value node so the square is never empty. */
export function renderStatus(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const resolver = context.iconResolver
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = statusPresenter(item, { point, value, bags }, surface)
	const [span, icon] = sel(
		statusShellTemplate({
			tone: view.tone,
			direction: view.direction,
		}),
		'.palette-default-icon'
	)
	span.title = view.title
	if (view.icon === undefined) icon.remove()
	else fillIcon(icon, resolveIcon(view.icon, resolver))
	syncStatusValue(span, view.value)
	if (!view.can) span.setAttribute('aria-disabled', 'true')
	return span
}

/**
 * Patch a rendered status node in place: icon + value text only, never
 * `textContent` over the icon. Vertical toggles the split mm/ss pair vs
 * the single-value fallback; horizontal writes the single node.
 */
export function syncStatusValue(span: HTMLElement, value: string): void {
	const minutes = span.querySelector('.palette-default-status-minutes')
	const seconds = span.querySelector('.palette-default-status-seconds')
	const single = span.querySelector('.palette-default-status-value')
	if (minutes instanceof HTMLElement && seconds instanceof HTMLElement) {
		const split = splitStatusTime(value)
		if (split) {
			if (minutes.textContent !== split[0]) minutes.textContent = split[0]
			if (seconds.textContent !== split[1]) seconds.textContent = split[1]
			minutes.hidden = false
			seconds.hidden = false
			if (single instanceof HTMLElement) single.hidden = true
			return
		}
		if (single instanceof HTMLElement) {
			if (single.textContent !== value) single.textContent = value
			single.hidden = false
		}
		minutes.hidden = true
		seconds.hidden = true
		return
	}
	if (single instanceof HTMLElement && single.textContent !== value) single.textContent = value
}

/** Render a `commandBox` (toolbar combobox) item. Runs commands inline.
 * Horizontal: full input + popover inline. Vertical: icon-only trigger whose
 * shell/popover are CSS overlays (no portal), so the toolbar width is fixed. */
export function renderCommandBox(context: HeadContext): HTMLElement {
	const { core, item } = context
	const resolver = context.iconResolver
	const meta = (item as { config?: Record<string, unknown> }).config ?? {}
	const shellIcon = typeof meta.icon === 'string' ? (resolveIcon(meta.icon, resolver) ?? '⌘') : '⌘'
	const [box, input, popover, results, openButton, text] = sel(
		commandBoxShellTemplate({
			hint: typeof meta.hint === 'string' ? meta.hint : 'Search and run a command',
			icon: shellIcon,
		}),
		'.palette-default-command-input',
		'.palette-default-command-popover',
		'.palette-default-command-results',
		'.palette-default-command-open',
		'.palette-default-command-text'
	)
	if (
		!(input instanceof HTMLInputElement) ||
		!(popover instanceof HTMLElement) ||
		!(results instanceof HTMLElement) ||
		!(openButton instanceof HTMLButtonElement) ||
		!(text instanceof HTMLElement)
	) {
		throw new Error('commandBox shell missing nodes')
	}
	// Reflected on the box so CSS can drive the `:hover`-only input. The
	// rest-state readout mirrors the input's current text while non-empty
	// (icon-only while empty — no redundant hint, the input's own
	// placeholder covers that), so a populated box stays readable closed.
	const hasText = () => input.value.trim().length > 0
	const syncRest = () => {
		const filled = hasText()
		box.dataset.hasText = filled ? 'true' : 'false'
		text.textContent = filled ? input.value : input.placeholder
		text.classList.toggle('is-hint', !filled)
	}
	openButton.addEventListener('mousedown', (event) => event.preventDefault())
	openButton.addEventListener('click', () => {
		context.onOpenConsole?.('edit')
		input.blur()
	})

	const refresh = () => {
		const query = input.value
		syncRest()
		// Run surface: concrete executable rows with live `can` + `uses`.
		const all = actionableEntries(core.points, {
			keys: core.keys,
			values: core.values.asObject(),
		})
		const entries = filterCommandEntries(all, { free: query })
		results.textContent = ''
		if (entries.length === 0) {
			results.append(elementFromHtml(commandEmptyTemplate('No matching commands')))
			return
		}
		for (const entry of entries.slice(0, 8)) {
			const row = elementFromHtml(
				commandResultRowTemplate({
					label: entry.label,
					meta: entry.meta,
					icon: typeof entry.icon === 'string' ? resolveIcon(entry.icon, resolver) : undefined,
					disabled: entry.can === false,
				})
			)
			if (!(row instanceof HTMLButtonElement)) continue
			row.addEventListener('mousedown', (event) => event.preventDefault())
			row.addEventListener('click', () => {
				core.run(entry.run)
				popover.hidden = true
				input.blur()
			})
			results.append(row)
		}
	}
	input.addEventListener('focus', () => {
		popover.hidden = false
		refresh()
	})
	input.addEventListener('blur', () => {
		popover.hidden = true
	})
	input.addEventListener('input', refresh)
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault()
			const all: readonly ActionableEntry[] = actionableEntries(core.points, {
				keys: core.keys,
				values: core.values.asObject(),
			})
			const first = filterCommandEntries(all, { free: input.value })[0]
			if (first) core.run(first.run)
			popover.hidden = true
			input.blur()
		}
		if (event.key === 'Escape') {
			popover.hidden = true
			input.blur()
		}
	})
	syncRest()
	return box
}

/** Render a `drawer` trigger item. Hierarchical: trigger + popup are
 * siblings in a `.palettable-drawer` wrapper (child of the tool node).
 * The wrapper is purely structural (positioning anchor + flex item) and
 * carries NO region or axis — placement queries the PARENT container's
 * `--region` (center-seeked at open time: left→right, right→left,
 * top→down, bottom→up). The popup stamps its own `--layout` (child axis)
 * + `--region` (content half for inner tools).
 * Trigger behavior follows `config.open` (svelte `DrawerEditor` parity):
 * `toggle` toggles on primary-button pointerdown (default) plus a keyboard
 * `click` fallback (`event.detail === 0` — pointerdown never fires for
 * Enter/Space), `hover` opens on mouseenter and schedules close on
 * mouseleave via `configuration.drawerHoverCloseMs` (leaving the trigger
 * for the popup cancels the close; leaving the popup re-arms it).
 *
 * Close-on-click (`config.closeOnClick`, opt-in): a command / toggle /
 * segmented activation inside the popup bubbles a
 * `palettable-drawer-item-activate` event; the wrapper runs the recursive
 * chain (bottom-up `closeOnClick` run maxed with the highest `hover`
 * ancestor) and closes the resulting drawers.
 */
export function renderDrawer(context: HeadContext): HTMLElement {
	const { item, surface } = context
	const resolver = context.iconResolver
	const openMode = drawerOpenOf(item)
	const config = ((item as { config?: Record<string, unknown> }).config ?? {}) as Record<
		string,
		unknown
	>
	const label = typeof config.label === 'string' ? config.label : ''
	const hint = typeof config.hint === 'string' ? config.hint : undefined
	const tone = config.tone === 'accent' ? 'accent' : 'neutral'
	// Static trigger shell (templates.ts): icon + chevron + a11y attrs.
	// The label is never rendered as visible text (icon-only trigger on
	// every axis); it survives as the accessible name + tooltip instead.
	// The e2e drawer test clicks `getByRole('button', { name: 'More' })` —
	// the accessible name must be exactly the label, chevron hidden from it.
	const trigger = elementFromHtml(
		drawerTriggerShellTemplate({
			label,
			hint,
			tone,
			icon: typeof config.icon === 'string' ? resolveIcon(config.icon, resolver) : undefined,
			open: openMode,
		})
	)
	if (!(trigger instanceof HTMLButtonElement)) throw new Error('drawer trigger shell missing node')
	const chevron = trigger.querySelector('.palette-default-drawer-chevron')

	const childAxis = surface.axis === 'vertical' ? 'horizontal' : 'vertical'
	const childRegion: PaletteRegion = childAxis === 'vertical' ? 'left' : 'top'
	// The wrapper is purely structural (positioning anchor + flex item):
	// it stamps NO region and NO axis. Region/axis on the wrapper would
	// accumulate down the tree (classes don't override) and leak stale
	// parent values onto nested popups — placement queries the PARENT
	// container's `--region`, the popup stamps the child `--layout`
	// (inner toolbars query it) plus a pre-measure `--region` default;
	// `openPopup` center-seeks the PARENT `--region` from live geometry.
	const wrapper = elementFromHtml(`<div class="palettable-drawer"></div>`)
	const popup = elementFromHtml(drawerPopupShellTemplate(childAxis, childRegion))
	if (!popup.classList.contains('palettable-drawer__popup'))
		throw new Error('drawer popup shell missing node')
	// Drawer content is one track (several toolbars in line along the
	// child axis); render it like a border track with gaps.
	const track: Track = isDrawerItem(item) ? item.toolbar : []
	const inner =
		context.renderToolbar?.(track, childAxis, childRegion) ?? document.createElement('div')
	popup.append(inner)
	wrapper.append(trigger, popup)

	let open = false
	let depth = 0
	const close = () => {
		if (!open) return
		open = false
		depth = 0
		popup.hidden = true
		popup.style.zIndex = ''
		// Restore the pre-measure content region until the next center-seek.
		popup.style.setProperty('--region', childRegion)
		trigger.setAttribute('aria-expanded', 'false')
		if (chevron) chevron.textContent = '▸'
		context.onCloseDrawer?.(trigger)
	}
	const openPopup = () => {
		// Depth = nesting level (1 = top-level drawer, 2 = nested, …):
		// count ancestor drawer wrappers. Each level stacks above the
		// 200-range base so a nested popup paints over the popup hosting
		// it (base 211 keeps popups above command-box floats at z 5,
		// select lists at 40, and edit guards at 1–6).
		depth = 1
		let ancestor = wrapper.parentElement?.closest('.palettable-drawer') ?? null
		while (ancestor !== null) {
			depth += 1
			ancestor = ancestor.parentElement?.closest('.palettable-drawer') ?? null
		}
		open = true
		popup.hidden = false
		popup.style.zIndex = String(210 + depth)
		// Center-seeking placement: the popup queries the PARENT
		// container's `--region` (the half the trigger sits in) — the
		// popup's own `--region` stays the content half for inner tools
		// (always compatible with the child axis: a horizontal parent
		// measures left/right, a vertical parent top/bottom).
		// The wrapper carries nothing, so there is nothing to refresh —
		// only the parent container + the popup are stamped.
		// Skipped when the IDE reports a zero rect (jsdom / detached
		// DOM): the parent-region defaults stand.
		// NOTE: the override lives on the context captured at RENDER time.
		// Nested drawers render through `renderToolbar` — the adapter
		// forwards `ideRect`/`triggerRect` at every level (see
		// `renderToolbarElement` `_basePath`), so inner drawers see it too.
		// The seek measures the WRAPPER (trigger + popup as laid out), not
		// the trigger alone: a nested trigger at the popup's far edge
		// would otherwise always read "past center" and flip back outward.
		// At OPEN time the wrapper rect is live in real DOM; in unit tests
		// (jsdom zeros) the `triggerRect` override stands in for it — and
		// it MUST win over the live zero rect (never fall through to it).
		const liveIde = wrapper.closest('.palette-ide') ?? document.body
		const liveIdeRect = liveIde.getBoundingClientRect()
		const ideRect =
			context.ideRect ?? (liveIdeRect.width > 0 && liveIdeRect.height > 0 ? liveIdeRect : null)
		const liveWrapperRect = wrapper.getBoundingClientRect()
		const liveWrapperUsable = liveWrapperRect.width > 0 && liveWrapperRect.height > 0
		const triggerRect = context.triggerRect ?? (liveWrapperUsable ? liveWrapperRect : null)
		// The live parent region drives the pre-measure defaults below
		// (content region when geometry is missing).
		if (ideRect !== null && ideRect.width > 0 && ideRect.height > 0 && triggerRect !== null) {
			const triggerCenterX = triggerRect.left + triggerRect.width / 2
			const triggerCenterY = triggerRect.top + triggerRect.height / 2
			const ideCenterX = ideRect.left + ideRect.width / 2
			const ideCenterY = ideRect.top + ideRect.height / 2
			// Content half for inner tools (the popup's own `--region`).
			// Placement needs no stamping: the popup queries the PARENT
			// container's `--region` (static on borders, center-seeked on
			// parent popups), so it follows automatically.
			popup.style.setProperty(
				'--region',
				drawerChildRegionFor(
					surface.axis === 'vertical' ? 'vertical' : 'horizontal',
					surface.axis === 'horizontal' ? triggerCenterX : triggerCenterY,
					surface.axis === 'horizontal' ? ideCenterX : ideCenterY
				)
			)
		} else {
			// No geometry (jsdom / detached DOM): parent-region defaults.
			popup.style.setProperty('--region', childRegion)
		}
		trigger.setAttribute('aria-expanded', 'true')
		if (chevron) chevron.textContent = '▾'
		if (surface.axis !== 'both') {
			context.onOpenDrawer?.(trigger, popup, surface.axis)
		}
	}
	trigger.addEventListener('click', (event) => {
		// Toggle mode: pointer clicks are owned by the pointerdown toggle
		// below — but synthetic `click()` (tests, keyboard fallback where
		// pointerdown never fires for Enter/Space) carries `detail === 0`,
		// so only ignore clicks that follow a real pointer press
		// (`detail > 0`). This avoids a double toggle (down opens, click
		// would close) while keeping programmatic clicks working.
		if (openMode !== 'toggle' || event.detail !== 0) return
		if (open) close()
		else openPopup()
	})
	if (openMode === 'toggle') {
		trigger.addEventListener('pointerdown', (event) => {
			// Primary button only: right/middle presses must not toggle.
			if (event.button !== 0) return
			if (open) close()
			else openPopup()
		})
	}
	// `open: 'hover'` keeps the popup open while the pointer travels from
	// the trigger to the popup: leaving the trigger schedules a close that
	// entering the popup cancels (and vice versa). `toggle` mode
	// ignores hover entirely.
	let cancelHoverClose: () => void = () => {}
	if (openMode === 'hover') {
		let hoverCloseTimer: ReturnType<typeof setTimeout> | undefined
		cancelHoverClose = () => {
			if (hoverCloseTimer !== undefined) {
				clearTimeout(hoverCloseTimer)
				hoverCloseTimer = undefined
			}
		}
		const scheduleHoverClose = () => {
			cancelHoverClose()
			hoverCloseTimer = setTimeout(() => {
				hoverCloseTimer = undefined
				close()
			}, configuration.drawerHoverCloseMs)
		}
		trigger.addEventListener('mouseenter', () => {
			cancelHoverClose()
			openPopup()
		})
		trigger.addEventListener('mouseleave', scheduleHoverClose)
		popup.addEventListener('mouseenter', cancelHoverClose)
		popup.addEventListener('mouseleave', scheduleHoverClose)
	}
	// Edit-mode hover-open: in edit mode hovering the trigger OR the popup
	// opens the drawer — even when not dragging (any `config.open` mode).
	// Run mode keeps the `config.open` behavior (`toggle`/`hover`).
	// Hierarchy close is adapter-owned (no mouseleave close here): the
	// adapter closes only drawers outside the hovered ancestor chain.
	//
	// NOTE: the trigger's own `pointerenter`/`pointermove`/`pointerover`
	// do NOT fire while the drawer tool's own guard
	// (`position: absolute; inset: -3px; z-index: 1`) covers the trigger:
	// every pointer event retargets to the guard, and the guard is a
	// SIBLING of the drawer content (appended after it in the wrapper),
	// so guard events bubble to the `.toolbar-item` wrapper — never
	// through `.palettable-drawer`. The adapter's bar-level `pointermove`
	// (coordinate hit-test via `elementFromPoint`, resolving the item
	// through the guard's parent wrapper) owns hover-open instead: it
	// dispatches a bubbling `palettable-drawer-drag-hover` CustomEvent
	// carrying the hovered drawer item, and this wrapper opens only when
	// the item is its own. The popup listener covers the already-open
	// case (hovering the open popup's gaps keeps it open without
	// re-dispatch).
	//
	// Attached for EVERY open mode (including `hover`): an edit hover-open
	// must work regardless of the trigger's rest behavior — the drag needs
	// the toolbar visible to highlight its gaps.
	wrapper.addEventListener('palettable-drawer-drag-hover', (event) => {
		if ((event as CustomEvent<ToolbarItem>).detail !== item) return
		if (context.isEditing?.() !== true) return
		if (openMode === 'hover') cancelHoverClose()
		openPopup()
	})
	// Edit-mode rest hover-open (no drag): owned by the adapter's
	// bar-level `pointerover` (coordinate hit-test via `elementFromPoint`,
	// resolving the item through the guard's parent wrapper) — the guard
	// covers the trigger and is a SIBLING of the drawer content (both
	// children of the `.toolbar-item` wrapper, the drawer nested INSIDE
	// the content), so guard events bubble to the item wrapper, never to
	// `.palettable-drawer`. The adapter dispatches the
	// `palettable-drawer-drag-hover` event above for BOTH cases (rest and
	// mid-drag). The head keeps only the `__openDrawer` expando (read by
	// the adapter's guard factory) + the fallback `pointerover` listeners
	// below for run-mode-shaped DOM (no guard).
	;(wrapper as unknown as { __openDrawer?: () => void }).__openDrawer = () => {
		if (openMode === 'hover') cancelHoverClose()
		openPopup()
	}
	// Hierarchy-close support: the adapter closes drawers outside the
	// hovered chain — via this expando so the head's `open` flag stays in
	// sync (toggling `hidden` directly would leave `open === true` stale
	// and the next `close()` a no-op... actually the reverse: stale `open`
	// keeps `close()` working; the real need is keeping trigger chrome +
	// `onCloseDrawer` in one place).
	;(wrapper as unknown as { __closeDrawer?: () => void }).__closeDrawer = () => close()
	// Fallback for run-mode-shaped DOM (no guard): wrapper `pointerover`
	// still catches trigger/content hovers (they bubble through the drawer).
	wrapper.addEventListener('pointerover', () => {
		if (context.isEditing?.() !== true) return
		if (context.isDragging?.() === true) return
		if (openMode === 'hover') cancelHoverClose()
		openPopup()
	})
	popup.addEventListener('pointerover', () => {
		if (context.isEditing?.() !== true) return
		openPopup()
	})
	// Close-on-click chain: a command / toggle / segmented inside the popup
	// bubbles `palettable-drawer-item-activate`. Collect the drawer wrapper
	// chain innermost-first (this wrapper, then DOM ancestors), read each
	// drawer's `openMode` + `closeOnClick` from its expando, and close the
	// indices from `drawerCloseChainIndices`. Expandos are stamped below so
	// nested drawers (rendered earlier, deeper in the DOM) are readable.
	type DrawerExpando = {
		__closeDrawer?: () => void
		__drawerCloseOnClick?: boolean
		__drawerOpenMode?: 'hover' | 'toggle'
	}
	wrapper.addEventListener(DRAWER_ITEM_ACTIVATE_EVENT, (event) => {
		event.stopPropagation()
		const chain: DrawerChainEntry[] = []
		const closers: (() => void)[] = []
		let node: HTMLElement | null = wrapper
		while (node !== null) {
			const expando = node as HTMLElement & DrawerExpando
			if (typeof expando.__closeDrawer === 'function') {
				chain.push({
					close: expando.__closeDrawer,
					closeOnClick: expando.__drawerCloseOnClick === true,
					openMode: expando.__drawerOpenMode === 'hover' ? 'hover' : 'toggle',
				})
				closers.push(expando.__closeDrawer)
			}
			node = node.parentElement?.closest('.palettable-drawer') ?? null
		}
		for (const index of drawerCloseChainIndices(chain)) closers[index]?.()
	})
	;(wrapper as HTMLElement & DrawerExpando).__drawerCloseOnClick = drawerCloseOnClickOf(item)
	;(wrapper as HTMLElement & DrawerExpando).__drawerOpenMode = openMode
	// Outside-click closes (capture): clicks inside the wrapper (trigger,
	// popup, nested drawers) are ignored. Self-removes when the wrapper
	// leaves the DOM (re-render while open) so no listener leaks.
	const onDocumentClick = (event: MouseEvent) => {
		if (!wrapper.isConnected) {
			document.removeEventListener('click', onDocumentClick, true)
			window.removeEventListener('keydown', onEscape, true)
			return
		}
		if (!open || popup.hidden) return
		if (wrapper.contains(event.target as Node | null)) return
		close()
	}
	const onEscape = (event: KeyboardEvent) => {
		if (!wrapper.isConnected) {
			document.removeEventListener('click', onDocumentClick, true)
			window.removeEventListener('keydown', onEscape, true)
			return
		}
		if (event.key !== 'Escape' || !open) return
		event.stopPropagation()
		close()
		trigger.focus()
	}
	document.addEventListener('click', onDocumentClick, true)
	window.addEventListener('keydown', onEscape, true)
	return wrapper
}

/** Dispatch an item to its head control by explicit `control` id. */
export function renderHeadItem(context: HeadContext): HTMLElement | null {
	const control = (context.item as { control?: string }).control
	switch (control) {
		case 'button':
			return renderButton(context)
		case 'toggle':
			return renderToggle(context)
		case 'select':
			return renderSelect(context)
		case 'segmented':
			return renderSegmented(context)
		case 'slider':
		case 'drawerSlider':
			return renderSlider(context)
		case 'stepper':
			return renderStepper(context)
		case 'stars':
			return renderStars(context)
		case 'status':
			return renderStatus(context)
		case 'theme':
			return renderTheme(context)
		case 'commandBox':
			return renderCommandBox(context)
		case 'drawer':
			return renderDrawer(context as HeadContext)
		default:
			return null
	}
}

/** Surface for a docking region (`top`/`bottom` → horizontal). */
export function surfaceForRegion(region: PaletteRegion | undefined): SurfaceContext {
	return { axis: axisForRegion(region), region }
}

// ── Disconnected preview core ─────────────────────────────────────────────
// The console add panel renders a functioning-but-disconnected preview of
// the draft tool: real choices/options from the point definitions, but a
// local selected value seeded from the live store. Preview interactions
// never write `core.values` or `core.run` — they mutate the preview core
// below, which re-renders the preview node in place.

/** Fixed preview surface (mirrors `controlFor` in `add-item.ts`). */
export const PREVIEW_SURFACE: SurfaceContext = { axis: 'horizontal', region: 'top' }

/** Minimal `PaletteCore` surface the head renderers read (`boundOf` + `run`/`values`/`can`). */
export type PreviewCore = {
	readonly values: {
		get(id: string): unknown
		set(id: string, value: never): void
		subscribe(id: string, listener: (value: unknown) => void): () => void
		asObject(): Record<string, unknown>
	}
	readonly points: readonly AnyPoint[]
	getDefinition(id: string): AnyPoint | undefined
	resolveBags(uses: readonly string[] | undefined): readonly (ValuesBag | undefined)[]
	readValue(id: string): unknown
	writeValue(id: string, value: unknown): void
	evaluateCan(id: string): boolean
	subscribeDefinitions(listener: (pointId: string) => void): () => void
	run(runnable: Runnable): void
	readonly keys: import('@palettable/core').KeyBindings
}

/**
 * Build a preview core over one draft item: reads resolve the point
 * definition + bags from the live core (real options/icons/`can`), while
 * the *selected value* comes from a local override map seeded from the
 * live store. Writes (`run` / `values.set`) apply to the local map and
 * notify local subscribers — the live store is never touched.
 */
export function createPreviewCore(
	live: PaletteCore,
	draft: ToolbarItem,
	seed: Readonly<Record<string, unknown>>
): { core: PreviewCore; setLocal: (id: string, value: unknown) => void } {
	const overrides = new Map<string, unknown>(Object.entries(seed))
	const listeners = new Map<string, Set<(value: unknown) => void>>()
	const pointId = (() => {
		try {
			const id = canonicalItemPoint(draft)
			return id === '' ? undefined : id
		} catch {
			return undefined
		}
	})()
	const point = pointId !== undefined ? live.getDefinition(pointId) : undefined
	const bags = live.resolveBags(point?.uses)
	const emit = (id: string): void => {
		const value = overrides.get(id)
		for (const listener of [...(listeners.get(id) ?? [])]) listener(value)
	}
	const setLocal = (id: string, value: unknown): void => {
		if (Object.is(overrides.get(id), value)) return
		overrides.set(id, value)
		emit(id)
	}
	const values = {
		get(id: string): unknown {
			if (overrides.has(id)) return overrides.get(id)
			return liveValue(live, live.getDefinition(id))
		},
		asObject(): Record<string, unknown> {
			return Object.fromEntries(overrides)
		},
		set(id: string, value: never): void {
			setLocal(id, value)
		},
		subscribe(id: string, listener: (value: unknown) => void): () => void {
			let set = listeners.get(id)
			if (!set) {
				set = new Set()
				listeners.set(id, set)
			}
			set.add(listener)
			return () => {
				set.delete(listener)
				if (set.size === 0) listeners.delete(id)
			}
		},
	}
	const core: PreviewCore = {
		values,
		points: live.points,
		getDefinition: (id: string) => live.getDefinition(id),
		resolveBags: (_uses) => bags,
		readValue: (id: string) => values.get(id),
		writeValue: (id: string, value: unknown) => {
			setLocal(id, value)
		},
		evaluateCan: (id: string) => {
			try {
				return live.evaluateCan(id)
			} catch {
				return true
			}
		},
		subscribeDefinitions: (_listener: (pointId: string) => void) => () => {},
		run: (runnable: Runnable) => {
			applyPreviewSpec(live, values.get, setLocal, runnable)
		},
		keys: { ...(live.keys ?? {}) },
	}
	return { core, setLocal }
}

/**
 * Apply a head-emitted runnable to the preview-local map (never the
 * live store): `set` writes (boolean/number tokens coerce like the core),
 * `toggle` flips a boolean, `inc`/`dec` step within `min`/`max`, bare
 * actions are absorbed as no-ops (a disconnected preview runs no side
 * effects).
 */
function applyPreviewSpec(
	live: PaletteCore,
	getLocal: (id: string) => unknown,
	setLocal: (id: string, value: unknown) => void,
	runnable: Runnable
): void {
	if (runnable.kind === 'set') {
		const id = runnable.point
		const raw = runnable.value
		const def = live.getDefinition(id) as AnyValuedPoint | undefined
		if (def === undefined || !isValuedPoint(def)) return
		if (def.type === 'boolean') {
			if (typeof raw === 'boolean') {
				setLocal(id, raw)
				return
			}
			if (typeof raw !== 'string') return
			const token = raw.toLowerCase()
			if (token === '1' || token === 'true') setLocal(id, true)
			else if (token === '0' || token === 'false') setLocal(id, false)
			return
		}
		if (def.type === 'number') {
			if (typeof raw === 'number') {
				if (Number.isFinite(raw)) setLocal(id, raw)
				return
			}
			if (typeof raw !== 'string' || raw.trim() === '') return
			const value = Number(raw)
			if (Number.isFinite(value)) setLocal(id, value)
			return
		}
		setLocal(id, raw)
		return
	}
	if (runnable.kind === 'toggle') {
		const id = runnable.point
		const current = getLocal(id)
		if (typeof current === 'boolean') setLocal(id, !current)
		return
	}
	if (runnable.kind === 'inc' || runnable.kind === 'dec') {
		const id = runnable.point
		const delta = runnable.kind === 'inc' ? Math.abs(runnable.delta) : -Math.abs(runnable.delta)
		const def = live.getDefinition(id) as AnyValuedPoint | undefined
		if (def === undefined || !isValuedPoint(def) || def.type !== 'number') return
		const constraints = (def.constraints ?? {}) as {
			readonly min?: number
			readonly max?: number
		}
		const current = getLocal(id)
		if (typeof current !== 'number' || !Number.isFinite(current)) return
		const next = current + delta
		const clamped =
			constraints.max !== undefined && next > constraints.max
				? constraints.max
				: constraints.min !== undefined && next < constraints.min
					? constraints.min
					: next
		setLocal(id, clamped)
		return
	}
	// Bare action: absorbed — a disconnected preview runs no side effects.
}
