/**
 * `@palettable/vanilla` — slide measuring (adapter-owned DOM projection).
 *
 * `toolbarSlideBounds` / `toolbarGrabOffset` need DOM metrics
 * (`getBoundingClientRect`), so they live here — never in core. Core owns
 * the arithmetic (`clampSlideDelta`) + the release commit (`commitSlide`);
 * the adapter owns measuring + the per-frame `transform` write.
 */

import { clampSlideDelta as clampSlideDeltaCore } from '@palettable/core'

export type SlideDirection = 'horizontal' | 'vertical'

export type SlideBounds = {
	readonly start: number
	readonly available: number
}

/**
 * Pixel bounds for sliding a toolbar along its track. The toolbar's
 * `.toolbar-track-slot` parent sits between the leading gap
 * (`space[slot]`) and trailing gap (`space[slot + 1]`) elements; their
 * edges are fixed during the slide, so the free span is the trailing-gap
 * end minus the leading-gap start minus the toolbar span.
 */
export function toolbarSlideBounds(
	toolbarElement: HTMLElement,
	direction: SlideDirection
): SlideBounds | undefined {
	const slot = toolbarElement.parentElement
	const before = slot?.previousElementSibling
	const after = slot?.nextElementSibling
	if (!(before instanceof HTMLElement) || !(after instanceof HTMLElement)) return undefined
	const horizontal = direction === 'horizontal'
	const start = horizontal
		? before.getBoundingClientRect().left
		: before.getBoundingClientRect().top
	const end = horizontal
		? after.getBoundingClientRect().right
		: after.getBoundingClientRect().bottom
	const rect = toolbarElement.getBoundingClientRect()
	const available = end - start - (horizontal ? rect.width : rect.height)
	return available > 0 ? { start, available } : undefined
}

/**
 * Clamp the pointer to the slide's free span and return the shift to apply
 * (relative to the toolbar's resting position). `bounds.start` is the
 * *leading gap's* edge; `offset0` is the toolbar's resting offset inside
 * that span, so the result is a `transform`-ready shift from resting.
 *
 * Single-copy rule (Phase 4): this is the core arithmetic
 * (`clampSlideDelta` in `@palettable/core`), not a fork — both the rAF
 * `transform` write and the release commit derive from it, so the visual
 * position and the committed `space` can never disagree.
 *
 * @deprecated Phase 7 — import `clampSlideDelta` from `@palettable/core`; do not add new callers.
 */
export function clampSlideDelta(
	bounds: SlideBounds,
	offset0: number,
	pointer: number,
	grabOffset: number
): number {
	return clampSlideDeltaCore(
		{
			axis: 'horizontal',
			start: bounds.start,
			available: bounds.available,
			resting: offset0,
			grab: grabOffset,
		},
		pointer
	)
}

/**
 * Grab offset of the cursor *within* the toolbar, in pixels. Captured once
 * on pointerdown so the cursor stays at the same point on the toolbar
 * (natural grab). The caller passes the button's live node (never the
 * guard — it bleeds 3px past the button via `inset: -3px`).
 */
export function toolbarGrabOffset(options: {
	toolbarElement: HTMLElement
	clientX: number
	clientY: number
	direction: SlideDirection
}): number {
	const rect = options.toolbarElement.getBoundingClientRect()
	const horizontal = options.direction === 'horizontal'
	return (horizontal ? options.clientX : options.clientY) - (horizontal ? rect.left : rect.top)
}

/**
 * Intra-button grab: the mousedown point within the dragged button, in
 * pixels. A restructure extraction promotes the button into a fresh
 * singleton toolbar — adding this to the button's fresh offset inside its
 * new toolbar keeps the pointer glued to the same point on the icon
 * (the extraction grab). Falls back to the toolbar middle when the button
 * is unmeasurable (mirrors svelte `recenter`).
 */
export function extractionGrabOffset(options: {
	toolbarElement: HTMLElement
	buttonElement: HTMLElement | undefined
	buttonGrab: { readonly x: number; readonly y: number } | undefined
	direction: SlideDirection
}): number {
	const horizontal = options.direction === 'horizontal'
	const rect = options.toolbarElement.getBoundingClientRect()
	const middle = (horizontal ? rect.width : rect.height) / 2
	const fallback = middle > 0 ? middle : 0
	const button = options.buttonElement
	const grab = options.buttonGrab
	if (button === undefined || grab === undefined) return fallback
	if (typeof button.getBoundingClientRect !== 'function') return fallback
	const buttonRect = button.getBoundingClientRect()
	const buttonEdge = horizontal ? buttonRect.left : buttonRect.top
	const toolbarEdge = horizontal ? rect.left : rect.top
	const offset = buttonEdge - toolbarEdge + (horizontal ? grab.x : grab.y)
	const size = horizontal ? rect.width : rect.height
	if (!(offset >= 0 && offset <= size)) return fallback
	return offset
}
