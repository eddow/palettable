/**
 * `@palettable/vanilla` — slide math home (adapter-owned).
 *
 * `clampSlideDelta` + `toolbarSlideBounds` need DOM metrics
 * (`getBoundingClientRect`), so they live here — never in core. Core owns
 * the commit (`resizeToolbar`); the adapter owns measuring + the per-frame
 * `transform` write. The single-copy rule holds: both the rAF `transform`
 * write and the release commit use `clampSlideDelta`, so the visual
 * position and the committed `space` can never disagree.
 */

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
 * @deprecated Phase 4 — the arithmetic moves to core; do not add new callers.
 */
export function clampSlideDelta(
	bounds: SlideBounds,
	offset0: number,
	pointer: number,
	grabOffset: number
): number {
	const raw = pointer - grabOffset - bounds.start
	const clamped = Math.min(Math.max(raw, 0), bounds.available)
	return clamped - offset0
}

/**
 * Grab offset of the cursor *within* the toolbar, in pixels. Captured once
 * on pointerdown so the cursor stays at the same point on the toolbar
 * (natural grab).
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
