/**
 * `@palettable/vanilla` — static HTML templates for structural shells.
 *
 * Implements `plans/html.md` (Phase 1 + Step 2): the most static DOM in
 * `ide.ts` / `head.ts` (IDE skeleton, border/track/toolbar/item shells,
 * console overlay shell, drawer popup shell, command result rows) lives
 * here as escaped HTML strings. Callers parse them with `elementFromHtml`
 * and attach only data bindings + event listeners afterwards — no object
 * building for static structure, no `innerHTML` with unescaped data.
 *
 * Rules:
 * - Every interpolated string goes through `escapeHtml` (attribute or
 *   text). Numbers/booleans are formatted by the caller.
 * - Templates carry the exact classes / datasets / roles / testids the
 *   e2e suite asserts. Do not rename without updating `tests/e2e/`.
 * - Templates build structure only: no listeners, no presenter reads, no
 *   `NodeRegistry` writes. The caller owns all of that.
 */

/** Escape text/attribute interpolation for `innerHTML`-built shells. */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/** Parse one HTML string into its first element child. */
export function elementFromHtml(html: string): HTMLElement {
	const template = document.createElement('template')
	template.innerHTML = html.trim()
	const node = template.content.firstElementChild
	if (!(node instanceof HTMLElement)) throw new Error('template produced no element')
	return node
}

export function subElementFromHtml(html: string, ...queries: string[]): HTMLElement[] {
	const el = elementFromHtml(html)
	return [el, ...(queries.map((query) => el.querySelector(query)) as HTMLElement[])]
}

/** Parse one HTML string into all top-level elements. */
export function elementsFromHtml(html: string): HTMLElement[] {
	const template = document.createElement('template')
	template.innerHTML = html.trim()
	return [...template.content.children].filter(
		(child): child is HTMLElement => child instanceof HTMLElement
	)
}

// ── IDE skeleton ────────────────────────────────────────────────────────────
// Mirrors `ide.ts` container setup exactly: layout-transparent hosts
// (`display: contents`, so borders are direct flex participants) referenced
// by closure, never by selector + `palette-ide-middle` / `palette-ide-center`
// classes, with the console host last inside the center so the overlay
// never steals the work-zone's position. Returns seven top-level nodes in
// order: top, middle, bottom — the middle holds left, center, right, and
// the caller appends the console host into the center.

export function ideSkeletonTemplate(): string {
	return (
		`<div style="display: contents"></div>` +
		`<div class="palette-ide-middle">` +
		`<div style="display: contents"></div>` +
		`<div class="palette-ide-center"></div>` +
		`<div style="display: contents"></div>` +
		`</div>` +
		`<div style="display: contents"></div>` +
		`<div></div>`
	)
}

// ── Border / track / toolbar / item shells ──────────────────────────────────

export function borderShellTemplate(options: {
	paletteId: string
	region: string
	direction: 'horizontal' | 'vertical'
	editing: boolean
}): string {
	const directionClass =
		options.direction === 'horizontal'
			? 'palette-horizontal stack-vertical'
			: 'palette-vertical stack-horizontal'
	const editing = options.editing ? ' data-editing="true"' : ''
	return (
		`<div class="toolbar-border ${directionClass}" data-palette-id="${escapeHtml(options.paletteId)}"` +
		` data-region="${escapeHtml(options.region)}"${editing}></div>`
	)
}

export function trackShellTemplate(trackIndex: number, paletteId: string): string {
	return (
		`<div class="toolbar-track" data-track-index="${trackIndex}"` +
		` data-palette-id="${escapeHtml(paletteId)}"></div>`
	)
}

export function trackSlotShellTemplate(slotIndex: number): string {
	return `<div class="toolbar-track-slot" data-toolbar-slot-index="${slotIndex}"></div>`
}

export function stackSpaceTemplate(stackIndex: number, paletteId: string): string {
	return (
		`<div class="toolbar-stack-space toolbar-drop-zone" data-palette-id="${escapeHtml(paletteId)}"` +
		` data-stack-index="${stackIndex}"></div>`
	)
}

export function trackSpaceTemplate(trackSpaceIndex: number, paletteId: string): string {
	return (
		`<div class="toolbar-track-space toolbar-drop-zone" data-palette-id="${escapeHtml(paletteId)}"` +
		` data-track-space-index="${trackSpaceIndex}"></div>`
	)
}

export function itemSpaceTemplate(itemSpaceIndex: number, paletteId: string): string {
	return (
		`<div class="toolbar-item-space toolbar-drop-zone" data-palette-id="${escapeHtml(paletteId)}"` +
		` data-item-space-index="${itemSpaceIndex}"></div>`
	)
}

export function toolbarShellTemplate(options: {
	paletteId: string
	container: 'border' | 'parking'
	editing: boolean
}): string {
	const editing = options.editing ? ' data-editing="true"' : ''
	return (
		`<div class="toolbar" data-palette-id="${escapeHtml(options.paletteId)}"` +
		` data-container="${options.container}"${editing}></div>`
	)
}

export function toolbarItemShellTemplate(options: {
	itemIndex: number
	tool?: string
	editor?: string
	inspected?: boolean
	editing?: boolean
}): string {
	const tool = options.tool !== undefined ? ` data-tool="${escapeHtml(options.tool)}"` : ''
	const editor = options.editor !== undefined ? ` data-editor="${escapeHtml(options.editor)}"` : ''
	const inspected = options.inspected === true ? ' data-inspected="true"' : ''
	const inert = options.editing === true ? ' inert=""' : ''
	return (
		`<div class="toolbar-item" data-item-index="${options.itemIndex}"${tool}${editor}${inspected}>` +
		`<div class="toolbar-item-content"${inert}></div>` +
		(options.editing === true ? `<div class="toolbar-item-guard" aria-hidden="true"></div>` : '') +
		`</div>`
	)
}

export function toolbarItemGuardTemplate(paletteId: string): string {
	return (
		`<div class="toolbar-item-guard" data-palette-id="${escapeHtml(paletteId)}"` +
		` aria-hidden="true"></div>`
	)
}

// ── Parking shells ──────────────────────────────────────────────────────────

export function parkingStackTemplate(paletteId: string): string {
	return (
		`<div class="palette-parking palette-horizontal stack-vertical"` +
		` data-palette-id="${escapeHtml(paletteId)}" data-container="parking"></div>`
	)
}

export function parkingGapTemplate(gapIndex: number, paletteId: string): string {
	return (
		`<div class="toolbar-stack-space toolbar-drop-zone" data-palette-id="${escapeHtml(paletteId)}"` +
		` data-parking-gap-index="${gapIndex}"></div>`
	)
}

export function parkingRowTemplate(rowIndex: number): string {
	return `<div class="palette-parking-row" data-parking-row-index="${rowIndex}"></div>`
}

export function parkingRemoveTemplate(): string {
	return (
		`<button type="button" class="palette-parking-remove" aria-label="Delete toolbar"` +
		` title="Delete toolbar"><span class="palette-parking-remove-icon"` +
		` aria-hidden="true">🗑</span></button>`
	)
}

// ── Console overlay shell (Phase 1) ─────────────────────────────────────────
// Static skeleton only: overlay + panel + close + top + bottom/main/box/
// shell/tokens/input(+mode toggle) + popover/results. The caller fills the
// parking host, binds the input listeners, and renders results + details.

export function consoleOverlayShellTemplate(options: {
	placeholder: string
	query: string
	canToggle: boolean
	isEditing: boolean
}): string {
	const toggle = options.canToggle
		? `<button type="button" class="palette-default-command-mode" data-testid="console-mode-toggle"` +
			` aria-pressed="${options.isEditing ? 'true' : 'false'}"` +
			` aria-label="${options.isEditing ? 'Done editing' : 'Edit toolbars'}"` +
			` title="${options.isEditing ? 'Done editing' : 'Edit toolbars'}">` +
			`${options.isEditing ? '✓' : '✎'}</button>`
		: ''
	return (
		`<div class="palette-default-command-overlay" data-testid="console-overlay"` +
		` role="dialog" aria-label="Palette console" tabindex="-1">` +
		`<div class="palette-default-command-panel" role="presentation">` +
		`<button type="button" class="palette-default-command-close"` +
		` aria-label="Close console">×</button>` +
		`<div class="palette-default-command-top"></div>` +
		`<div class="palette-default-command-bottom">` +
		`<div class="palette-default-command-main">` +
		`<div class="palette-default-command-box is-expanded">` +
		`<div class="palette-default-command-shell" title="Console command box">` +
		`<span class="palette-default-icon">⌘</span>` +
		`<div class="palette-default-command-tokens">` +
		`<input class="palette-default-command-input" data-testid="console-input"` +
		` placeholder="${escapeHtml(options.placeholder)}" value="${escapeHtml(options.query)}">` +
		`${toggle}</div></div>` +
		`<div class="palette-default-command-popover">` +
		`<div class="palette-default-command-results" data-testid="console-results"></div>` +
		`</div></div></div></div></div></div>`
	)
}

export function commandResultRowTemplate(options: {
	label: string
	meta: string
	icon?: string
	disabled?: boolean
}): string {
	const icon =
		options.icon !== undefined
			? `<span class="palette-default-icon">${escapeHtml(options.icon)}</span>`
			: ''
	const disabled = options.disabled === true ? ' disabled=""' : ''
	return (
		`<button type="button" class="palette-default-command-result"${disabled}>` +
		`<span class="palette-default-command-result-copy">` +
		`<span class="palette-default-command-result-label">${icon}${escapeHtml(options.label)}</span>` +
		`<span class="palette-default-command-result-meta">${escapeHtml(options.meta)}</span>` +
		`</span></button>`
	)
}

export function commandEmptyTemplate(text: string): string {
	return `<div class="palette-default-command-empty">${escapeHtml(text)}</div>`
}

export function detailsPanelShellTemplate(): string {
	return (
		`<div class="palette-default-panel palette-default-details-panel"` +
		` data-testid="console-details-panel"></div>`
	)
}

export function detailsTitleTemplate(title: string): string {
	return `<div class="palette-default-panel-title">${escapeHtml(title)}</div>`
}

export function configEmptyTemplate(text: string): string {
	return `<div class="palette-default-config-empty">${escapeHtml(text)}</div>`
}

export function configRowShellTemplate(key: string): string {
	return (
		`<div class="palette-default-config-row">` +
		`<div class="palette-default-config-key"><strong>${escapeHtml(key)}</strong></div>` +
		`<div class="palette-default-config-value"></div></div>`
	)
}

export function addPanelShellTemplate(options: { label: string; meta: string }): string {
	return (
		`<div class="palette-default-config-stack" data-testid="console-add-panel">` +
		`<div class="palette-default-config-header"><strong>${escapeHtml(options.label)}</strong>` +
		`<span>${escapeHtml(options.meta)}</span></div></div>`
	)
}

export function addVariantShellTemplate(options: {
	label: string
	meta: string
	icon?: string
	isSet?: boolean
	selected?: boolean
}): string {
	const icon =
		options.icon !== undefined
			? `<span class="palette-default-icon">${escapeHtml(options.icon)}</span>`
			: ''
	return (
		`<div class="palette-default-add-variant${options.isSet === true ? ' is-set' : ''}">` +
		`<button type="button" class="palette-default-config-header palette-default-add-variant-trigger` +
		`${options.selected === true ? ' is-selected' : ''}"` +
		` aria-pressed="${options.selected === true ? 'true' : 'false'}">` +
		`<strong>${icon}${escapeHtml(options.label)}</strong>` +
		`<span>${escapeHtml(options.meta)}</span></button></div>`
	)
}

export function addInsertTemplate(): string {
	return (
		`<button type="button" class="palette-default-add-insert"` +
		` data-testid="console-add-insert">Add to toolbar</button>`
	)
}

export function addInlineValueShellTemplate(): string {
	return `<div class="palette-default-add-inline-value"><strong>Value</strong></div>`
}

// ── Drawer popup shell (Step 2 / Phase E) ───────────────────────────────────
// Static trigger + overlay + popup skeleton. The caller renders the child
// track into the popup and owns open/close + repositioning.

export function drawerTriggerShellTemplate(options: {
	label: string
	hint?: string
	tone: 'neutral' | 'accent'
	icon?: string
}): string {
	const accessible = options.label !== '' ? options.label : (options.hint ?? 'More')
	const title = options.hint ?? options.label
	const icon =
		options.icon !== undefined
			? `<span class="palette-default-icon">${escapeHtml(options.icon)}</span>`
			: ''
	const label = options.label !== '' ? `<span>${escapeHtml(options.label)}</span>` : ''
	return (
		`<button type="button" class="palette-default-tool palette-default-tone-${options.tone}` +
		` palettable-drawer__trigger" aria-label="${escapeHtml(accessible)}"` +
		` aria-expanded="false" aria-haspopup="true" title="${escapeHtml(title)}">` +
		`${icon}${label}` +
		`<span class="palette-default-drawer-chevron" aria-hidden="true">▸</span></button>`
	)
}

export function drawerPopupShellTemplate(childAxis: 'horizontal' | 'vertical'): string {
	return (
		`<div class="palettable-drawer__overlay" role="presentation">` +
		`<div class="palettable-drawer__popup is-${childAxis}" data-placement="center"` +
		` role="dialog" tabindex="-1"></div></div>`
	)
}

// ── Command-box shell ───────────────────────────────────────────────────────

export function commandBoxShellTemplate(options: { hint: string; icon: string }): string {
	return (
		`<div class="palette-default-command-box is-floating" data-testid="command-box-combobox">` +
		`<div class="palette-default-command-shell" title="${escapeHtml(options.hint)}">` +
		`<span class="palette-default-icon">${escapeHtml(options.icon)}</span>` +
		`<div class="palette-default-command-tokens">` +
		`<input class="palette-default-command-input" data-testid="command-box-input"` +
		` placeholder="Command…" value="">` +
		`<button type="button" class="palette-default-command-open"` +
		` data-testid="command-box-open-editor" aria-label="Edit toolbars"` +
		` title="Edit toolbars">✎</button></div></div>` +
		`<div class="palette-default-command-popover" hidden="">` +
		`<div class="palette-default-command-results" data-testid="command-box-results"></div>` +
		`</div></div>`
	)
}
