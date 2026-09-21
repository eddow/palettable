/**
 * `@palettable/vanilla` — default head editors (plain-DOM renderers).
 *
 * Each editor renders one toolbar item into an `HTMLElement` from a core
 * presenter view-model (button/toggle/select/segmented/slider/stepper/stars/
 * status/theme/commandBox/drawer). Presentation only: all reads go through core
 * presenters, all writes through `core.run(spec)` / `core.values.set`.
 * Status/commandBox/drawer/theme tools bind nothing-points (1:1 — one tool,
 * one nothing-point whose `uses` names its context); display state comes
 * from the resolved bags, never from `core.values`.
 * Mirrors the svelte default head (`head/editors/*.svelte`) + the demo
 * overrides (`DemoSlider` value badge, `StarsEditor` rating row).
 */

import {
	type AnyPoint,
	axisForRegion,
	buttonPresenter,
	canonicalItemTool,
	filterCommandEntries,
	isActionPoint,
	isDrawerItem,
	isValuedPoint,
	type PaletteCore,
	type PaletteRegion,
	paletteCommandEntries,
	type SurfaceContext,
	selectClosedLabel,
	selectPresenter,
	sliderPresenter,
	statusPresenter,
	type ToolbarItem,
	type Track,
	themePresenter,
	togglePresenter,
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
	selectOptionShellTemplate,
	selectShellTemplate,
	sliderShellTemplate,
	starsShellTemplate,
	statusShellTemplate,
	stepperShellTemplate,
} from './templates.js'
import { applyThemeSetting } from './theme.js'

export type HeadContext = {
	readonly core: PaletteCore
	readonly item: ToolbarItem
	readonly surface: SurfaceContext
	readonly region?: PaletteRegion
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
}

/** Fill a shelled icon node: show + set glyph, or hide when absent. */
function fillIcon(node: HTMLElement | undefined, icon: string | undefined): void {
	if (node === undefined) return
	if (icon === undefined) {
		node.hidden = true
		return
	}
	node.hidden = false
	node.textContent = icon
}

export function boundOf(
	core: PaletteCore,
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
 * (`ide.ts:updateToolNode`).
 */
export function liveValue(core: PaletteCore, point: AnyPoint | undefined): unknown {
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

function toolOf(item: ToolbarItem): string | undefined {
	const tool = (item as { tool?: unknown }).tool
	return typeof tool === 'string' ? tool : undefined
}

function pointIdOf(item: ToolbarItem): string | undefined {
	const spec = toolOf(item)
	if (spec === undefined) return undefined
	const id = canonicalItemTool(item)
	return id === '' ? undefined : id
}

/** Render a `button` (action) item. */
export function renderButton(context: HeadContext): HTMLElement {
	const { core, item } = context
	const spec = toolOf(item) ?? ''
	const { point, bags } = boundOf(core, pointIdOf(item))
	const can = point !== undefined && isActionPoint(point) ? core.evaluateCan(point.id) : true
	const view = buttonPresenter(item, { point, value: undefined, bags }, spec, can)
	const [button, icon, label] = sel(
		buttonShellTemplate({ tone: view.tone }),
		'.palette-default-icon',
		'.palette-default-choice'
	)
	const btn = button as HTMLButtonElement
	btn.disabled = !view.can
	btn.title = view.title
	fillIcon(icon, view.icon)
	label.textContent = view.label
	btn.addEventListener('click', () => core.run(view.run))
	return btn
}

/** Render a `toggle` (boolean) item. Skeleton (`pressed === undefined`) renders unpressed + `aria-pressed="mixed"`. */
export function renderToggle(context: HeadContext): HTMLElement {
	const { core, item } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = togglePresenter(item, { point, value, bags })
	const [button, icon] = sel(
		buttonShellTemplate({ tone: view.tone, compact: true, pressed: view.pressed }),
		'.palette-default-icon'
	)
	const btn = button as HTMLButtonElement
	btn.title = view.title
	fillIcon(icon, view.icon)
	btn.addEventListener('click', () => core.run(view.toggle))
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
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = selectPresenter(item, { point, value, bags }, surface)
	const closedLabel = selectClosedLabel(view)
	const [box, trigger, _chip, toolIcon, valueIcon, label] = sel(
		selectShellTemplate({
			tone: view.tone,
			direction: view.direction,
			region: view.region ?? 'top',
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
	// Tool icon first (when declared), then the value icon — icon+value, like
	// numerics. The icons are tagged so in-place sync can tell them apart.
	fillIcon(toolIcon, view.toolIcon)
	fillIcon(valueIcon, view.icon)
	if (closedLabel === undefined) label.remove()
	else label.textContent = closedLabel
	const list = box.querySelector('.palette-default-select-list') as HTMLElement
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
		fillIcon(rowIcon, option.icon)
		rowText.textContent = option.label
		row.addEventListener('click', (event) => {
			event.stopPropagation()
			void core.run(view.select(option.value))
			closeList()
		})
		list.append(row)
	}
	const closeList = (): void => {
		list.hidden = true
		triggerBtn.setAttribute('aria-expanded', 'false')
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
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = selectPresenter(item, { point, value, bags }, surface)
	const [group] = sel(
		segmentedShellTemplate({
			tone: view.tone,
			direction: view.direction,
			region: view.region ?? 'top',
		})
	)
	group.title = view.title
	for (const option of view.options) {
		const [button, icon, text] = sel(
			segmentedOptionShellTemplate({
				value: option.value,
				selected: view.value === option.value,
				can: option.can,
			}),
			'.palette-default-choice-icon',
			'.palette-default-choice'
		)
		button.title = option.text
		fillIcon(icon, option.icon)
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
		button.addEventListener('click', () => core.run(view.select(option.value)))
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
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = sliderPresenter(item, { point, value, bags }, surface)
	const [label, icon, input] = sel(
		sliderShellTemplate({
			variant: view.variant,
			tone: view.tone,
			direction: view.direction,
			region: view.region,
			rangeAxis: view.rangeAxis,
			iconOnly: !view.showValue,
		}),
		'.palette-default-slider-value > .palette-default-icon',
		'input[type="range"]'
	)
	label.title = view.title
	// The readout mirrors the stepper readout exactly: the icon nests inside
	// the value chip (icon + text), so both read as one bordered chip.
	fillIcon(icon, view.icon)
	if (view.showValue) label.querySelector('.palette-default-slider-value')?.append(view.text)
	const range = input as HTMLInputElement
	range.min = String(view.min)
	range.max = String(view.max)
	range.step = String(view.step)
	range.value = String(view.value ?? view.min)
	range.setAttribute('aria-label', view.title)
	range.addEventListener('input', () => {
		core.values.set((point?.id ?? '') as never, Number(range.value) as never)
	})
	return label
}

/** Render a `stepper` (number ±) item. */
export function renderStepper(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = sliderPresenter(item, { point, value, bags }, surface)
	const [group, minus, icon, readout, plus] = sel(
		stepperShellTemplate({ tone: view.tone, direction: view.direction }),
		'button:first-of-type',
		'.palette-default-stepper-value > .palette-default-icon',
		'.palette-default-stepper-value',
		'button:last-of-type'
	)
	group.title = view.title
	;(minus as HTMLButtonElement).disabled =
		view.value === undefined || view.value - view.step < view.min
	;(minus as HTMLButtonElement).addEventListener('click', () => {
		if (view.value === undefined) return
		core.values.set((point?.id ?? '') as never, Math.max(view.min, view.value - view.step) as never)
	})
	fillIcon(icon, view.icon)
	readout.append(String(view.value))
	;(plus as HTMLButtonElement).disabled =
		view.value === undefined || view.value + view.step > view.max
	;(plus as HTMLButtonElement).addEventListener('click', () => {
		if (view.value === undefined) return
		core.values.set((point?.id ?? '') as never, Math.min(view.max, view.value + view.step) as never)
	})
	return group
}

/** Render a `stars` (number rating) item — demo extension the head lacks. */
export function renderStars(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = sliderPresenter(item, { point, value, bags }, surface)
	const [group, icon] = sel(
		starsShellTemplate({ tone: view.tone, direction: view.direction, max: view.max }),
		':scope > .palette-default-icon'
	)
	group.title = view.title
	fillIcon(icon, view.icon)
	const buttons = [...group.querySelectorAll('.palette-default-arrow')] as HTMLButtonElement[]
	buttons.forEach((button, offset) => {
		const index = offset + 1
		const filled = view.value !== undefined && index <= view.value
		button.classList.toggle('is-selected', filled)
		button.setAttribute('aria-checked', index === view.value ? 'true' : 'false')
		button.title = `${view.title} ${index}`
		button.textContent = filled ? '▶' : '▷'
		button.addEventListener('click', () => {
			core.values.set((point?.id ?? '') as never, index as never)
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

/** Parse the `theme=<next>` cycle spec into its next value. */
function nextCycleValue(cycle: string): 'light' | 'dark' | 'system' {
	const next = cycle.split('=')[1]
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
	fillIcon(icon, view.valueIcon)
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
		fillIcon(icon, synced.valueIcon)
		btn.title = synced.title
	})
	return btn
}

/** Render a `status` tool bound to a nothing-point (read-only display from context bags). */
export function renderStatus(context: HeadContext): HTMLElement {
	const { core, item } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = statusPresenter(item, { point, value, bags })
	const [span, icon, valueNode] = sel(
		statusShellTemplate(view.tone),
		'.palette-default-icon',
		'.palette-default-status-value'
	)
	span.title = view.title
	fillIcon(icon, view.icon)
	valueNode.textContent = view.value
	if (!view.can) span.setAttribute('aria-disabled', 'true')
	return span
}

/** Render a `commandBox` (toolbar combobox) item. Runs commands inline.
 * Horizontal: full input + popover inline. Vertical: icon-only trigger whose
 * shell/popover are CSS overlays (no portal), so the toolbar width is fixed. */
export function renderCommandBox(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const meta = (item as { config?: Record<string, unknown> }).config ?? {}
	const [box, input, popover, results, openButton, text] = sel(
		commandBoxShellTemplate({
			hint: typeof meta.hint === 'string' ? meta.hint : 'Search and run a command',
			icon: typeof meta.icon === 'string' ? meta.icon : '⌘',
			axis: surface.axis === 'vertical' ? 'vertical' : 'horizontal',
			region: surface.region,
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
		const all = paletteCommandEntries(core.points, {
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
					icon: typeof entry.icon === 'string' ? entry.icon : undefined,
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
			const all = paletteCommandEntries(core.points, {
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
 * siblings in a `.palettable-drawer.from-{region}` wrapper (child of the
 * tool node). The popup toggles `hidden` — no body portal, no JS
 * repositioning; the side is CSS-only from the parent region
 * (center-seeking: left→right, right→left, top→down, bottom→up). */
export function renderDrawer(context: HeadContext): HTMLElement {
	const { item, surface } = context
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
			icon: typeof config.icon === 'string' ? config.icon : undefined,
			axis: surface.axis === 'vertical' ? 'vertical' : 'horizontal',
			region: surface.region,
		})
	)
	if (!(trigger instanceof HTMLButtonElement)) throw new Error('drawer trigger shell missing node')
	const chevron = trigger.querySelector('.palette-default-drawer-chevron')

	const childAxis = surface.axis === 'vertical' ? 'horizontal' : 'vertical'
	const childRegion: PaletteRegion = childAxis === 'vertical' ? 'left' : 'top'
	const parentRegion = context.region ?? surface.region ?? 'top'
	const wrapper = elementFromHtml(`<div class="palettable-drawer from-${parentRegion}"></div>`)
	const popup = elementFromHtml(drawerPopupShellTemplate(childAxis))
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
	const close = () => {
		if (!open) return
		open = false
		popup.hidden = true
		trigger.setAttribute('aria-expanded', 'false')
		if (chevron) chevron.textContent = '▸'
		context.onCloseDrawer?.(trigger)
	}
	const openPopup = () => {
		open = true
		popup.hidden = false
		trigger.setAttribute('aria-expanded', 'true')
		if (chevron) chevron.textContent = '▾'
		if (surface.axis === 'horizontal' || surface.axis === 'vertical') {
			context.onOpenDrawer?.(trigger, popup, surface.axis)
		}
	}
	trigger.addEventListener('click', () => {
		if (open) close()
		else openPopup()
	})
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

/** Dispatch an item to its head editor by explicit `editor` id. */
export function renderHeadItem(context: HeadContext): HTMLElement | null {
	const editor = (context.item as { editor?: string }).editor
	switch (editor) {
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
