/**
 * `@palettable/vanilla` — default head editors (plain-DOM renderers).
 *
 * Each editor renders one toolbar item into an `HTMLElement` from a core
 * presenter view-model (button/toggle/select/segmented/slider/stepper/stars/
 * status/commandBox/drawer). Presentation only: all reads go through core
 * presenters, all writes through `core.run(spec)` / `core.values.set`.
 * Mirrors the svelte default head (`head/editors/*.svelte`) + the demo
 * overrides (`DemoSlider` value badge, `StarsEditor` rating row).
 */

import {
	type AnyPoint,
	axisForRegion,
	buttonPresenter,
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
	togglePresenter,
} from '@palettable/core'

import {
	commandBoxShellTemplate,
	commandEmptyTemplate,
	commandResultRowTemplate,
	drawerPopupShellTemplate,
	drawerTriggerShellTemplate,
	elementFromHtml,
	subElementFromHtml,
} from './templates.js'

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

function el(tag: string, className: string): HTMLElement {
	return elementFromHtml(`<${tag} class="${className}"></${tag}>`)
}

function iconSpan(icon: string | undefined): HTMLElement | null {
	if (icon === undefined) return null
	const span = elementFromHtml(`<span class="palette-default-icon"></span>`)
	span.textContent = icon
	return span
}

function toneClass(tone: 'neutral' | 'accent'): string {
	return `palette-default-tone-${tone}`
}

function boundOf(
	core: PaletteCore,
	pointId: string | undefined
): {
	point: AnyPoint | undefined
	value: unknown
	bags: readonly (import('@palettable/core').ValuesBag | undefined)[]
} {
	const point = pointId !== undefined ? core.getDefinition(pointId) : undefined
	const bags = core.resolveBags(point?.uses)
	const rootValue =
		point !== undefined && isValuedPoint(point) ? core.values.get(point.id) : undefined
	// Dual-source precedence (context-display): first non-root used bag holding
	// this point id wins, else the root value. Absent bag / absent key → root.
	let value: unknown = rootValue
	if (point !== undefined && isValuedPoint(point)) {
		for (const bag of bags) {
			if (bag === undefined) continue
			if (bag === (core.values as unknown as typeof bag)) continue
			const selected: unknown = bag.get(point.id as never)
			if (selected !== undefined) {
				value = selected
				break
			}
		}
	}
	return { point, value, bags }
}

function toolOf(item: ToolbarItem): string | undefined {
	const tool = (item as { tool?: unknown }).tool
	return typeof tool === 'string' ? tool : undefined
}

function pointIdOf(item: ToolbarItem): string | undefined {
	const spec = toolOf(item)
	if (spec === undefined) return undefined
	const cut = spec.search(/[=|:]/)
	return cut < 0 ? spec : spec.slice(0, cut)
}

/** Render a `button` (action) item. */
export function renderButton(context: HeadContext): HTMLElement {
	const { core, item } = context
	const spec = toolOf(item) ?? ''
	const { point, bags } = boundOf(core, pointIdOf(item))
	const can = point !== undefined && isActionPoint(point) ? core.evaluateCan(point.id) : true
	const view = buttonPresenter(item, { point, value: undefined, bags }, spec, can)
	const button = document.createElement('button')
	button.type = 'button'
	button.className = `palette-default-tool ${toneClass(view.tone)}`
	button.disabled = !view.can
	button.title = view.title
	const icon = iconSpan(view.icon)
	if (icon) button.append(icon)
	const label = el('span', '')
	label.textContent = view.label
	button.append(label)
	button.addEventListener('click', () => core.run(view.run))
	return button
}

/** Render a `toggle` (boolean) item. Skeleton (`pressed === undefined`) renders unpressed + `aria-pressed="mixed"`. */
export function renderToggle(context: HeadContext): HTMLElement {
	const { core, item } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = togglePresenter(item, { point, value, bags })
	const button = document.createElement('button')
	button.type = 'button'
	button.className = `palette-default-tool palette-default-tool-compact ${toneClass(view.tone)}${view.pressed ? ' is-selected' : ''}`
	button.title = view.title
	const icon = iconSpan(view.icon)
	if (icon) button.append(icon)
	button.setAttribute(
		'aria-pressed',
		view.pressed === undefined ? 'mixed' : view.pressed ? 'true' : 'false'
	)
	button.addEventListener('click', () => core.run(view.toggle))
	return button
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
	const box = el(
		'div',
		`palette-default-select ${toneClass(view.tone)} palette-default-layout-${view.direction} palette-default-region-${view.region ?? 'top'}`
	)
	box.title = view.title
	const trigger = document.createElement('button')
	trigger.type = 'button'
	trigger.className = 'palette-default-select-trigger'
	trigger.setAttribute('aria-haspopup', 'listbox')
	trigger.setAttribute('aria-expanded', 'false')
	const chip = el(
		'span',
		`palette-default-select-value${closedLabel === undefined ? ' is-icon-only' : ''}`
	)
	// Tool icon first (when declared), then the value icon — icon+value, like
	// numerics. The icons are tagged so in-place sync can tell them apart.
	if (view.toolIcon !== undefined) {
		const toolIcon = el('span', 'palette-default-icon palette-default-tool-icon')
		toolIcon.textContent = view.toolIcon
		chip.append(toolIcon)
	}
	const icon = iconSpan(view.icon)
	if (icon) {
		icon.classList.add('palette-default-value-icon')
		chip.append(icon)
	}
	// Vertical: the closed label is a direct child of the trigger, sibling of
	// the icon chip — the segmented overlay pattern (`button > icon + label`).
	// Horizontal keeps the label inside the chip (inline icon + text).
	if (closedLabel !== undefined) {
		const text = el('span', 'palette-default-choice')
		text.textContent = closedLabel
		if (view.direction === 'vertical') {
			trigger.append(chip, text)
		} else {
			chip.append(text)
			trigger.append(chip)
		}
	} else {
		trigger.append(chip)
	}
	const list = el('div', 'palette-default-select-list')
	list.setAttribute('role', 'listbox')
	list.hidden = true
	for (const option of view.listOptions) {
		const row = document.createElement('button')
		row.type = 'button'
		row.className = `palette-default-select-option${view.value === option.value ? ' is-selected' : ''}`
		row.setAttribute('role', 'option')
		row.setAttribute('aria-selected', view.value === option.value ? 'true' : 'false')
		row.disabled = !option.can
		// `data-value` is the stable identity for in-place updates (same as
		// segmented): rows always render full text, so matching on rendered
		// text is not reliable.
		row.dataset.value = option.value
		if (option.icon !== undefined) {
			const rowIcon = el('span', 'palette-default-choice-icon')
			rowIcon.textContent = option.icon
			row.append(rowIcon)
		}
		const rowText = el('span', 'palette-default-choice')
		rowText.textContent = option.label
		row.append(rowText)
		row.addEventListener('click', (event) => {
			event.stopPropagation()
			void core.run(view.select(option.value))
			closeList()
		})
		list.append(row)
	}
	const closeList = (): void => {
		list.hidden = true
		trigger.setAttribute('aria-expanded', 'false')
	}
	trigger.addEventListener('click', (event) => {
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
		trigger.setAttribute('aria-expanded', open ? 'true' : 'false')
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
	trigger.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !list.hidden) {
			event.stopPropagation()
			closeList()
			trigger.focus()
		}
	})
	box.append(trigger, list)
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
	const group = el(
		'div',
		`palette-default-segmented ${toneClass(view.tone)} palette-default-layout-${view.direction} palette-default-region-${view.region ?? 'top'}`
	)
	group.title = view.title
	for (const option of view.options) {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = `palette-default-tool palette-default-tool-compact${view.value === option.value ? ' is-selected' : ''}`
		button.disabled = !option.can || view.value === option.value
		button.title = option.text
		// `data-value` is the stable identity for in-place updates: the label
		// node is split (icon + text) and may be hidden per axis, so matching
		// on rendered text is no longer reliable.
		button.dataset.value = option.value
		if (option.icon !== undefined) {
			const icon = el('span', 'palette-default-choice-icon')
			icon.textContent = option.icon
			button.append(icon)
		}
		// `showText: false` hides the label (icon-only on both axes); an
		// option with no icon keeps its label as a fallback so the button
		// is never empty.
		if (view.showText && option.label !== undefined) {
			const text = el('span', 'palette-default-choice')
			text.textContent = option.label
			button.append(text)
		} else if (!view.showText && option.icon === undefined) {
			const text = el('span', 'palette-default-choice')
			text.textContent = option.label ?? option.value
			button.append(text)
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
	const label = document.createElement('label')
	label.className = [
		'palette-default-slider',
		`palette-default-slider-${view.variant}`,
		toneClass(view.tone),
		`palette-default-layout-${view.direction}`,
		`palette-default-region-${view.region}`,
		`palette-default-range-${view.rangeAxis}`,
	]
		.filter(Boolean)
		.join(' ')
	label.title = view.title
	// The readout mirrors the stepper readout exactly: the icon nests inside
	// the value chip (icon + text), so both read as one bordered chip. A
	// drawer trigger wraps that chip so the two read as one rounded button,
	// with the revealed range as the second segment of the group. With
	// `showValue: false` the chip keeps the icon only (no text node). The
	// range itself always sits inside a `slider-track` pill half: the readout
	// (or trigger) is the first half, the track the second — visible chrome,
	// outer corners rounded, input filling 100% of it.
	const icon = iconSpan(view.icon)
	const readout = el('span', `palette-default-slider-value${view.showValue ? '' : ' is-icon-only'}`)
	if (icon) readout.append(icon)
	if (view.showValue) readout.append(document.createTextNode(view.text))
	if (view.variant === 'drawer') {
		const trigger = el('span', 'palette-default-slider-trigger')
		trigger.append(readout)
		label.append(trigger)
	} else {
		label.append(readout)
	}
	const track = el('span', 'palette-default-slider-track')
	const input = document.createElement('input')
	input.type = 'range'
	input.min = String(view.min)
	input.max = String(view.max)
	input.step = String(view.step)
	input.value = String(view.value ?? view.min)
	input.setAttribute('aria-label', view.title)
	input.addEventListener('input', () => {
		core.values.set((point?.id ?? '') as never, Number(input.value) as never)
	})
	track.append(input)
	label.append(track)
	return label
}

/** Render a `stepper` (number ±) item. */
export function renderStepper(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = sliderPresenter(item, { point, value, bags }, surface)
	const group = el(
		'div',
		`palette-default-stepper ${toneClass(view.tone)} palette-default-layout-${view.direction}`
	)
	group.title = view.title
	const minus = document.createElement('button')
	minus.type = 'button'
	minus.className = 'palette-default-tool palette-default-tool-compact'
	minus.disabled = view.value === undefined || view.value - view.step < view.min
	minus.textContent = '−'
	minus.addEventListener('click', () => {
		if (view.value === undefined) return
		core.values.set((point?.id ?? '') as never, Math.max(view.min, view.value - view.step) as never)
	})
	const readout = el('span', 'palette-default-stepper-value')
	const icon = iconSpan(view.icon)
	if (icon) readout.append(icon)
	readout.append(document.createTextNode(String(view.value)))
	const plus = document.createElement('button')
	plus.type = 'button'
	plus.className = 'palette-default-tool palette-default-tool-compact'
	plus.disabled = view.value === undefined || view.value + view.step > view.max
	plus.textContent = '+'
	plus.addEventListener('click', () => {
		if (view.value === undefined) return
		core.values.set((point?.id ?? '') as never, Math.min(view.max, view.value + view.step) as never)
	})
	group.append(minus, readout, plus)
	return group
}

/** Render a `stars` (number rating) item — demo extension the head lacks. */
export function renderStars(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = sliderPresenter(item, { point, value, bags }, surface)
	const group = el(
		'div',
		`palette-default-stars ${toneClass(view.tone)} palette-default-layout-${view.direction}`
	)
	group.title = view.title
	const icon = iconSpan(view.icon)
	if (icon) group.append(icon)
	const row = el('span', `palette-default-stars-row palette-default-layout-${view.direction}`)
	row.setAttribute('role', 'radiogroup')
	for (let index = 1; index <= view.max; index += 1) {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = `palette-default-arrow${view.value !== undefined && index <= view.value ? ' is-selected' : ''}`
		button.setAttribute('role', 'radio')
		button.setAttribute('aria-checked', index === view.value ? 'true' : 'false')
		button.title = `${view.title} ${index}`
		button.textContent = view.value !== undefined && index <= view.value ? '▶' : '▷'
		button.addEventListener('click', () => {
			core.values.set((point?.id ?? '') as never, index as never)
		})
		row.append(button)
	}
	group.append(row)
	return group
}

/** Render a `status` (pointless readout) item. */
export function renderStatus(context: HeadContext): HTMLElement {
	const view = statusPresenter(context.item)
	const span = el('span', `palette-default-status ${toneClass(view.tone)}`)
	span.title = view.title
	const icon = iconSpan(view.icon)
	if (icon) span.append(icon)
	const value = el('span', 'palette-default-status-value')
	value.textContent = view.value
	span.append(value)
	return span
}

/** Render a `commandBox` (toolbar combobox) item. Runs commands inline.
 * Horizontal: full input + popover inline. Vertical: icon-only trigger whose
 * shell/popover are CSS overlays (no portal), so the toolbar width is fixed. */
export function renderCommandBox(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const meta = (item as { config?: Record<string, unknown> }).config ?? {}
	const [box, input, popover, results, openButton, text] = subElementFromHtml(
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

/** Render a `drawer` trigger item. The popup mounts into `document.body`. */
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
	let overlay: HTMLElement | null = null
	let popup: HTMLElement | null = null
	const close = () => {
		overlay?.remove()
		overlay = null
		popup = null
		trigger.setAttribute('aria-expanded', 'false')
		if (chevron) chevron.textContent = '▸'
		context.onCloseDrawer?.(trigger)
	}
	const reposition = () => {
		if (!popup) return
		const rect = trigger.getBoundingClientRect()
		const offset = 6
		popup.style.left = `${(surface.axis === 'vertical' ? rect.right : rect.left) + offset}px`
		popup.style.top = `${(surface.axis === 'vertical' ? rect.top : rect.bottom) + offset}px`
	}
	trigger.addEventListener('click', () => {
		if (overlay) {
			close()
			return
		}
		overlay = elementFromHtml(drawerPopupShellTemplate(childAxis))
		popup = overlay.querySelector('.palettable-drawer__popup')
		if (!(popup instanceof HTMLElement)) throw new Error('drawer popup shell missing node')
		reposition()
		// Drawer content is one track (several toolbars in line along the
		// child axis); render it like a border track with gaps.
		const track: Track = isDrawerItem(item) ? item.toolbar : []
		const inner =
			context.renderToolbar?.(track, childAxis, childRegion) ?? document.createElement('div')
		popup.append(inner)
		overlay.addEventListener('click', close)
		popup.addEventListener('click', (event) => event.stopPropagation())
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			close()
			trigger.focus()
		}
		window.addEventListener('keydown', onKey, { once: true })
		document.body.append(overlay)
		if (surface.axis === 'horizontal' || surface.axis === 'vertical') {
			context.onOpenDrawer?.(trigger, popup, surface.axis)
		}
		trigger.setAttribute('aria-expanded', 'true')
		if (chevron) chevron.textContent = '▾'
	})
	return trigger
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
