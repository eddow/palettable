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
	selectPresenter,
	sliderPresenter,
	statusPresenter,
	type ToolbarItem,
	type Track,
	togglePresenter,
} from '@palettable/core'

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

/** Render a `toggle` (boolean) item. */
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
	button.setAttribute('aria-pressed', view.pressed ? 'true' : 'false')
	button.addEventListener('click', () => core.run(view.toggle))
	return button
}

/** Render a `select` (enum dropdown) item. */
export function renderSelect(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = selectPresenter(item, { point, value, bags }, surface)
	const label = document.createElement('label')
	label.className = `palette-default-select ${toneClass(view.tone)}`
	label.title = view.title
	const icon = iconSpan(view.icon)
	if (icon) label.append(icon)
	const select = document.createElement('select')
	for (const option of view.options) {
		const node = document.createElement('option')
		node.value = option.value
		node.textContent = option.text
		if (!option.can) node.disabled = true
		select.append(node)
	}
	select.value = view.value
	select.addEventListener('change', () => core.run(view.select(select.value)))
	label.append(select)
	return label
}

/** Render a `segmented` (enum joined-buttons) item. */
export function renderSegmented(context: HeadContext): HTMLElement {
	const { core, item, surface } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = selectPresenter(item, { point, value, bags }, surface)
	const group = el(
		'div',
		`palette-default-segmented ${toneClass(view.tone)} palette-default-layout-${view.direction}`
	)
	group.title = view.title
	for (const option of view.options) {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = `palette-default-tool palette-default-tool-compact${view.value === option.value ? ' is-selected' : ''}`
		button.disabled = !option.can || view.value === option.value
		button.title = option.text
		const text = el('span', 'palette-default-choice')
		text.textContent = option.text
		button.append(text)
		button.addEventListener('click', () => core.run(view.select(option.value)))
		group.append(button)
	}
	return group
}

/** Render a `slider` (number range) item. `showValue` forces the demo value badge. */
export function renderSlider(context: HeadContext, showValue = false): HTMLElement {
	const { core, item, surface } = context
	const { point, value, bags } = boundOf(core, pointIdOf(item))
	const view = sliderPresenter(item, { point, value, bags }, surface)
	const label = document.createElement('label')
	label.className = [
		'palette-default-slider',
		showValue ? 'palette-default-slider-badged' : '',
		toneClass(view.tone),
		`palette-default-layout-${view.direction}`,
		`palette-default-region-${view.region}`,
	]
		.filter(Boolean)
		.join(' ')
	label.title = view.title
	const icon = iconSpan(view.icon)
	if (icon) label.append(icon)
	const input = document.createElement('input')
	input.type = 'range'
	input.min = String(view.min)
	input.max = String(view.max)
	input.step = String(view.step)
	input.value = String(view.value)
	input.addEventListener('input', () => {
		core.values.set((point?.id ?? '') as never, Number(input.value) as never)
	})
	label.append(input)
	if (showValue) {
		const badge = el('span', 'palette-default-slider-badge')
		badge.textContent = String(view.value)
		label.append(badge)
	}
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
	minus.disabled = view.value - view.step < view.min
	minus.textContent = '−'
	minus.addEventListener('click', () => {
		core.values.set((point?.id ?? '') as never, Math.max(view.min, view.value - view.step) as never)
	})
	const readout = el('span', 'palette-default-stepper-value')
	const icon = iconSpan(view.icon)
	if (icon) readout.append(icon)
	readout.append(document.createTextNode(String(view.value)))
	const plus = document.createElement('button')
	plus.type = 'button'
	plus.className = 'palette-default-tool palette-default-tool-compact'
	plus.disabled = view.value + view.step > view.max
	plus.textContent = '+'
	plus.addEventListener('click', () => {
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
		button.className = `palette-default-arrow${index <= view.value ? ' is-selected' : ''}`
		button.setAttribute('role', 'radio')
		button.setAttribute('aria-checked', index === view.value ? 'true' : 'false')
		button.title = `${view.title} ${index}`
		button.textContent = index <= view.value ? '▶' : '▷'
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

/** Render a `commandBox` (toolbar combobox) item. Runs commands inline. */
export function renderCommandBox(context: HeadContext): HTMLElement {
	const { core, item } = context
	const meta = (item as { config?: Record<string, unknown> }).config ?? {}
	const box = el('div', 'palette-default-command-box is-floating')
	box.dataset.testid = 'command-box-combobox'
	const shell = el('div', 'palette-default-command-shell')
	shell.title = typeof meta.hint === 'string' ? meta.hint : 'Search and run a command'
	const icon = iconSpan(typeof meta.icon === 'string' ? meta.icon : '⌘')
	if (icon) shell.append(icon)
	const tokens = el('div', 'palette-default-command-tokens')
	const input = document.createElement('input')
	input.className = 'palette-default-command-input'
	input.dataset.testid = 'command-box-input'
	input.placeholder = 'Command…'
	input.value = ''
	const popover = el('div', 'palette-default-command-popover')
	popover.hidden = true
	const results = el('div', 'palette-default-command-results')
	results.dataset.testid = 'command-box-results'
	popover.append(results)
	const openButton = document.createElement('button')
	openButton.type = 'button'
	openButton.className = 'palette-default-command-open'
	openButton.dataset.testid = 'command-box-open-editor'
	openButton.setAttribute('aria-label', 'Edit toolbars')
	openButton.title = 'Edit toolbars'
	openButton.textContent = '✎'
	openButton.addEventListener('mousedown', (event) => event.preventDefault())
	openButton.addEventListener('click', () => {
		context.onOpenConsole?.('edit')
		input.blur()
	})
	tokens.append(input, openButton)
	shell.append(tokens)
	box.append(shell, popover)

	const refresh = () => {
		const query = input.value
		const all = paletteCommandEntries(core.points, {
			keys: core.keys,
			values: core.values.asObject(),
		})
		const entries = filterCommandEntries(all, { free: query })
		results.textContent = ''
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
				popover.hidden = true
				input.blur()
			})
			const copy = el('span', 'palette-default-command-result-copy')
			const label = el('span', 'palette-default-command-result-label')
			if (typeof entry.icon === 'string') {
				const entryIcon = iconSpan(entry.icon)
				if (entryIcon) label.append(entryIcon)
			}
			label.append(document.createTextNode(entry.label))
			const resultMeta = el('span', 'palette-default-command-result-meta')
			resultMeta.textContent = entry.meta
			copy.append(label, resultMeta)
			row.append(copy)
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
	const trigger = document.createElement('button')
	trigger.type = 'button'
	trigger.className = `palette-default-tool ${toneClass(tone)} palettable-drawer__trigger`
	trigger.setAttribute('aria-label', label || hint || 'More')
	trigger.setAttribute('aria-expanded', 'false')
	trigger.setAttribute('aria-haspopup', 'true')
	trigger.title = hint ?? label
	// Svelte parity: the label renders inside a `<span>` (the e2e drawer test
	// clicks `getByRole('button', { name: 'More' })` — the accessible name
	// must be exactly the label, with the chevron hidden from it).
	const icon = iconSpan(typeof config.icon === 'string' ? config.icon : undefined)
	if (icon) trigger.append(icon)
	if (label) {
		const labelSpan = el('span', '')
		labelSpan.textContent = label
		trigger.append(labelSpan)
	}
	const chevron = el('span', 'palette-default-drawer-chevron')
	chevron.setAttribute('aria-hidden', 'true')
	chevron.textContent = '▸'
	trigger.append(chevron)

	const childAxis = surface.axis === 'vertical' ? 'horizontal' : 'vertical'
	const childRegion: PaletteRegion = childAxis === 'vertical' ? 'left' : 'top'
	let overlay: HTMLElement | null = null
	let popup: HTMLElement | null = null
	const close = () => {
		overlay?.remove()
		overlay = null
		popup = null
		trigger.setAttribute('aria-expanded', 'false')
		chevron.textContent = '▸'
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
		overlay = el('div', 'palettable-drawer__overlay')
		overlay.setAttribute('role', 'presentation')
		popup = el('div', `palettable-drawer__popup is-${childAxis}`)
		popup.dataset.placement = 'center'
		popup.setAttribute('role', 'dialog')
		popup.tabIndex = -1
		reposition()
		// Drawer content is one track (several toolbars in line along the
		// child axis); render it like a border track with gaps.
		const track: Track = isDrawerItem(item) ? item.toolbar : []
		const inner =
			context.renderToolbar?.(track, childAxis, childRegion) ?? document.createElement('div')
		popup.append(inner)
		overlay.append(popup)
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
		chevron.textContent = '▾'
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
			return renderSlider(
				context,
				(context.item as { config?: Record<string, unknown> }).config?.demoSlider === true
			)
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
