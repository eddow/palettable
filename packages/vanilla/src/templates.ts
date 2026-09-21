/**
 * `@palettable/vanilla` — static HTML templates for structural shells.
 *
 * Every static DOM chunk lives here as an escaped multiline HTML string.
 * Callers parse them with `elementFromHtml` / `sel` and attach only data
 * bindings + event listeners afterwards — no `document.createElement`
 * chains for static structure, no `innerHTML` with unescaped data.
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

/** Parse one HTML string into its root plus the queried sub-elements, in order. */
export function sel(html: string, ...queries: string[]): HTMLElement[] {
	const root = elementFromHtml(html)
	return [root, ...queries.map((query) => root.querySelector(query) as HTMLElement)]
}

/** Parse one HTML string into its first element child. */
export function elementFromHtml(html: string): HTMLElement {
	const template = document.createElement('template')
	template.innerHTML = html.trim()
	const node = template.content.firstElementChild
	if (!(node instanceof HTMLElement)) throw new Error('template produced no element')
	return node
}

/** Generic element builder (tag + class only — data/listeners stay with the caller). */
export function el(tag: string, className: string): HTMLElement {
	return elementFromHtml(`<${tag} class="${className}"></${tag}>`)
}

/** Icon glyph span (`null` when the view carries no icon). */
export function iconSpan(icon: string | undefined): HTMLElement | null {
	if (icon === undefined) return null
	const span = elementFromHtml(`<span class="palette-default-icon"></span>`)
	span.textContent = icon
	return span
}

// ── Head editor shells ────────────────────────────────────────────────────
// Live: `head.ts` renderers parse these, then attach data + listeners.

export function buttonShellTemplate(options: {
	tone: 'neutral' | 'accent'
	compact?: boolean
	pressed?: boolean
}): string {
	const pressed =
		options.pressed === undefined
			? ' aria-pressed="mixed"'
			: ` aria-pressed="${options.pressed ? 'true' : 'false'}"`
	return (
		`<button type="button" class="palette-default-tool${options.compact === true ? ' palette-default-tool-compact' : ''} palette-default-tone-${options.tone}${options.pressed === true ? ' is-selected' : ''}"` +
		`${pressed}>` +
		`<span class="palette-default-icon" hidden=""></span>` +
		`<span class="palette-default-choice"></span></button>`
	)
}

export function selectShellTemplate(options: {
	tone: 'neutral' | 'accent'
	direction: 'horizontal' | 'vertical'
	region: string
	iconOnly: boolean
}): string {
	return (
		`<div class="palette-default-select palette-default-tone-${options.tone} palette-default-layout-${options.direction} palette-default-region-${options.region}">` +
		`<button type="button" class="palette-default-select-trigger" aria-haspopup="listbox" aria-expanded="false">` +
		`<span class="palette-default-select-value${options.iconOnly ? ' is-icon-only' : ''}">` +
		`<span class="palette-default-icon palette-default-tool-icon" hidden=""></span>` +
		`<span class="palette-default-icon palette-default-value-icon" hidden=""></span>` +
		(options.direction === 'horizontal' ? `<span class="palette-default-choice"></span>` : '') +
		`</span>` +
		(options.direction === 'vertical' ? `<span class="palette-default-choice"></span>` : '') +
		`</button>` +
		`<div class="palette-default-select-list" role="listbox" hidden=""></div></div>`
	)
}

export function selectOptionShellTemplate(options: {
	value: string
	selected: boolean
	can: boolean
}): string {
	return (
		`<button type="button" class="palette-default-select-option${options.selected ? ' is-selected' : ''}" role="option"` +
		` aria-selected="${options.selected ? 'true' : 'false'}" data-value="${escapeHtml(options.value)}"` +
		`${options.can ? '' : ' disabled=""'}>` +
		`<span class="palette-default-choice-icon" hidden=""></span>` +
		`<span class="palette-default-choice"></span></button>`
	)
}

export function segmentedShellTemplate(options: {
	tone: 'neutral' | 'accent'
	direction: 'horizontal' | 'vertical'
	region: string
}): string {
	return `<div class="palette-default-segmented palette-default-tone-${options.tone} palette-default-layout-${options.direction} palette-default-region-${options.region}"></div>`
}

export function segmentedOptionShellTemplate(options: {
	value: string
	selected: boolean
	can: boolean
}): string {
	return (
		`<button type="button" class="palette-default-tool palette-default-tool-compact${options.selected ? ' is-selected' : ''}"` +
		`${options.selected || !options.can ? ' disabled=""' : ''} data-value="${escapeHtml(options.value)}">` +
		`<span class="palette-default-choice-icon" hidden=""></span>` +
		`<span class="palette-default-choice" hidden=""></span></button>`
	)
}

export function sliderShellTemplate(options: {
	variant: 'inline' | 'drawer'
	tone: 'neutral' | 'accent'
	direction: 'horizontal' | 'vertical'
	region: string | undefined
	rangeAxis: string
	iconOnly: boolean
}): string {
	const region = options.region ?? 'top'
	const readout = `<span class="palette-default-slider-value${options.iconOnly ? ' is-icon-only' : ''}"><span class="palette-default-icon" hidden=""></span></span>`
	return (
		`<label class="palette-default-slider palette-default-slider-${options.variant} palette-default-tone-${options.tone} palette-default-layout-${options.direction} palette-default-region-${region} palette-default-range-${options.rangeAxis}">` +
		(options.variant === 'drawer'
			? `<span class="palette-default-slider-trigger">${readout}</span>`
			: readout) +
		`<span class="palette-default-slider-track"><input type="range"></span></label>`
	)
}

export function stepperShellTemplate(options: {
	tone: 'neutral' | 'accent'
	direction: 'horizontal' | 'vertical'
}): string {
	return (
		`<div class="palette-default-stepper palette-default-tone-${options.tone} palette-default-layout-${options.direction}">` +
		`<button type="button" class="palette-default-tool palette-default-tool-compact">−</button>` +
		`<span class="palette-default-stepper-value"><span class="palette-default-icon" hidden=""></span></span>` +
		`<button type="button" class="palette-default-tool palette-default-tool-compact">+</button></div>`
	)
}

export function starsShellTemplate(options: {
	tone: 'neutral' | 'accent'
	direction: 'horizontal' | 'vertical'
	max: number
}): string {
	let buttons = ''
	for (let index = 1; index <= options.max; index += 1) {
		buttons += `<button type="button" class="palette-default-arrow" role="radio" aria-checked="false">▷</button>`
	}
	return (
		`<div class="palette-default-stars palette-default-tone-${options.tone} palette-default-layout-${options.direction}">` +
		`<span class="palette-default-icon" hidden=""></span>` +
		`<span class="palette-default-stars-row palette-default-layout-${options.direction}" role="radiogroup">${buttons}</span></div>`
	)
}

export function statusShellTemplate(tone: 'neutral' | 'accent'): string {
	return (
		`<span class="palette-default-status palette-default-tone-${tone}">` +
		`<span class="palette-default-icon" hidden=""></span>` +
		`<span class="palette-default-status-value"></span></span>`
	)
}

// ── Command result rows ─────────────────────────────────────────────────────
// Live: `head.ts` command-box `refresh()` builds rows from these.

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

// ── Drawer shells ───────────────────────────────────────────────────────────
// Hierarchical drawer: trigger + popup are siblings in a `.palettable-drawer`
// wrapper (child of the tool node). The caller renders the child track into
// the popup and toggles `hidden` — no body portal, no JS repositioning.
// The popup side comes from `from-{region}` on the wrapper (CSS only).

export function drawerTriggerShellTemplate(options: {
	label: string
	hint?: string
	tone: 'neutral' | 'accent'
	icon?: string
	axis?: 'horizontal' | 'vertical'
	region?: string
}): string {
	const accessible = options.label !== '' ? options.label : (options.hint ?? 'More')
	const title = options.label !== '' ? options.label : (options.hint ?? 'More')
	const layout = options.axis !== undefined ? ` palette-default-layout-${options.axis}` : ''
	const region = options.region !== undefined ? ` palette-default-region-${options.region}` : ''
	const icon =
		options.icon !== undefined
			? `<span class="palette-default-icon">${escapeHtml(options.icon)}</span>`
			: ''
	// The label is never rendered as visible text (icon-only trigger on every
	// axis); it survives as the accessible name + tooltip instead.
	return (
		`<button type="button" class="palette-default-tool palette-default-tone-${options.tone}` +
		` palettable-drawer__trigger${layout}${region}" aria-label="${escapeHtml(accessible)}"` +
		` aria-expanded="false" aria-haspopup="true" title="${escapeHtml(title)}">` +
		`${icon}` +
		`<span class="palette-default-drawer-chevron" aria-hidden="true">▸</span></button>`
	)
}

export function drawerPopupShellTemplate(childAxis: 'horizontal' | 'vertical'): string {
	return (
		`<div class="palettable-drawer__popup is-${childAxis}" data-placement="center"` +
		` role="dialog" tabindex="-1" hidden=""></div>`
	)
}

// ── Command-box shell ───────────────────────────────────────────────────────

/**
 * Command-box shell. The input is revealed on hover/focus only; at rest the
 * shell shows the point icon plus the current text while non-empty (so a
 * populated command box stays readable while collapsed), and icon-only while
 * empty — no redundant hint readout, the input's own placeholder covers that.
 * Vertical boxes size to the perpendicular var and open their overlay like a
 * drawer over the IDE (CSS-only, no portal).
 */
export function commandBoxShellTemplate(options: {
	hint: string
	icon: string
	axis?: 'horizontal' | 'vertical'
	region?: string
}): string {
	const axis = options.axis ?? 'horizontal'
	const layout = `palette-default-layout-${axis}`
	const region = options.region !== undefined ? ` palette-default-region-${options.region}` : ''
	return (
		`<div class="palette-default-command-box is-floating ${layout}${region}"` +
		` data-has-text="false" data-testid="command-box-combobox">` +
		`<div class="palette-default-command-shell" title="${escapeHtml(options.hint)}">` +
		`<span class="palette-default-command-icon palette-default-icon">` +
		`${escapeHtml(options.icon)}</span>` +
		`<div class="palette-default-command-tokens">` +
		`<span class="palette-default-command-text is-hint" aria-hidden="true">` +
		`${escapeHtml(options.hint)}</span>` +
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
