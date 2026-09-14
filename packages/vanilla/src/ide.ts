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
 * Movement was stripped for a restart — no drag sessions run; guards only
 * inspect (`pointerdown` selects for the configurator).
 */

import {
	type AddItemSource,
	type AnyPoint,
	actualTrackSpaceAt,
	axisForRegion,
	type ConsoleStore,
	configuration,
	configuratorEditorCleanup,
	editorChoicesFor,
	filterCommandEntries,
	isActionPoint,
	isValuedPoint,
	type PaletteCore,
	type PaletteRegion,
	paletteAddItemEntries,
	paletteCommandEntries,
	paletteDerivedVariants,
	parsePointSpec,
	validateSerializedLayout,
} from '@palettable/core'
import { renderHeadItem, surfaceForRegion } from './head.js'
import { createVanillaKeys, isEditableTarget } from './keys.js'

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

	let inspecting: InspectingPath | undefined
	let consoleQuery = ''
	let disposed = false

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
		toolbar: readonly import('@palettable/core').ToolbarItem[],
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
			| { readonly container: 'parking'; readonly toolbarIndex: number }
	): HTMLElement {
		const bar = el('div', 'toolbar')
		bar.dataset.paletteId = paletteId
		if (editing) bar.dataset.editing = 'true'
		bar.dataset.container = containerKind
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
				onInspect: () => {
					inspecting = path
					refresh()
				},
				renderToolbar: (childToolbar, childAxis, childRegion) =>
					renderToolbarElement(childToolbar as never, childAxis, childRegion, editing, 'border', {
						container: 'border',
						region: childRegion,
						trackIndex: 0,
						slotIndex: 0,
					}),
			})
			if (rendered) content.append(rendered)
			wrapper.append(content)
			if (editing) {
				const guard = el('div', 'toolbar-item-guard')
				guard.dataset.paletteId = paletteId
				guard.setAttribute('aria-hidden', 'true')
				guard.addEventListener('pointerdown', () => {
					inspecting = path
					refresh()
				})
				wrapper.append(guard)
			}
			bar.append(wrapper)
			appendSpace(itemIndex + 1)
		})
		void axis
		return bar
	}

	function renderBorder(host: HTMLElement, region: PaletteRegion, editing: boolean): void {
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
					renderToolbarElement(slot.toolbar, direction, region, editing, 'border', {
						container: 'border',
						region,
						trackIndex,
						slotIndex,
					})
				)
				trackEl.append(slotEl)
				trackSpace(slotIndex + 1)
			})
			borderEl.append(trackEl)
			if (!inverse) stackSpace(trackIndex + 1)
		})
		if (inverse) stackSpace(0)
		host.append(borderEl)
	}

	function renderParking(host: HTMLElement, editing: boolean): void {
		host.textContent = ''
		const live = core.layout.getLayout()
		const stack = el('div', 'palette-parking palette-horizontal stack-vertical')
		stack.dataset.paletteId = paletteId
		stack.dataset.container = 'parking'
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
			if (editing) {
				const remove = document.createElement('button')
				remove.type = 'button'
				remove.className = 'palette-parking-remove'
				remove.setAttribute('aria-label', 'Delete toolbar')
				remove.title = 'Delete toolbar'
				remove.addEventListener('click', (event) => {
					event.stopPropagation()
					const liveLayout = core.layout.getLayout()
					liveLayout.parking.splice(index, 1)
					core.layout.setLayout(liveLayout)
					refresh()
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
	}

	function closeConsole(): void {
		consoleStore.close()
		inspecting = undefined
		consoleQuery = ''
		refresh()
	}

	function renderConsole(): void {
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

		if (isEditing) {
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
		consoleHost.append(overlay)
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

	function patchLive(
		path: InspectingPath,
		patch: (item: import('@palettable/core').ToolbarItem) => void
	): void {
		const live = core.layout.getLayout()
		const toolbar =
			path.container === 'parking'
				? live.parking[path.toolbarIndex]
				: live.borders[path.region][path.trackIndex]?.[path.slotIndex]?.toolbar
		const item = toolbar?.[path.itemIndex]
		if (!item || !toolbar) return
		patch(item)
		core.layout.setLayout(live)
		refresh()
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
			const live = core.layout.getLayout()
			if (path.container === 'parking') {
				live.parking[path.toolbarIndex]?.splice(path.itemIndex, 1)
				if (live.parking[path.toolbarIndex]?.length === 0) live.parking.splice(path.toolbarIndex, 1)
			} else {
				const track = live.borders[path.region][path.trackIndex]
				const toolbar = track?.[path.slotIndex]?.toolbar
				toolbar?.splice(path.itemIndex, 1)
				if (toolbar?.length === 0 && track) {
					track.splice(path.slotIndex, 1)
					if (track.length === 0) live.borders[path.region].splice(path.trackIndex, 1)
				}
			}
			core.layout.setLayout(live)
			inspecting = undefined
			refresh()
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

	function refresh(): void {
		if (disposed) return
		const editing = computeEditing()
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
	const valuesUnsub = core.values.subscribe(() => refresh())
	const layoutUnsub = core.subscribeLayout(() => refresh())
	const consoleUnsub = consoleStore.subscribe(() => {
		consoleQuery = ''
		refresh()
	})

	refresh()

	return {
		refresh,
		dispose() {
			disposed = true
			valuesUnsub()
			layoutUnsub()
			consoleUnsub()
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
