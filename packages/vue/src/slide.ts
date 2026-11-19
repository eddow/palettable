/**
 * `@palettable/vue` — slide measuring (adapter-owned DOM projection).
 *
 * Same contract as the vanilla adapter's `slide.ts`: core owns the
 * axis-projected arithmetic (`toolbarSlideBounds`,
 * `toolbarGrabOffset`, `extractionGrabOffset`, `clampSlideDelta`) +
 * the release commit (`commitSlide`); this module owns measuring
 * (`getBoundingClientRect`) + the per-frame `transform` write.
 */

import {
	type AxisRect,
	extractionGrabOffset as coreExtractionGrabOffset,
	toolbarGrabOffset as coreToolbarGrabOffset,
	toolbarSlideBounds as coreToolbarSlideBounds,
	type SlideBounds,
	type SlideDirection,
} from '@palettable/core'

export type { AxisRect, SlideBounds, SlideDirection }
export { coreToolbarSlideBounds as toolbarSlideBoundsFromSpan }

/**
 * Pixel bounds for sliding a toolbar along its track. The toolbar's
 * slot sits between the leading and trailing gap elements; their live
 * edges bound the free span (see core `toolbarSlideBounds`).
 */
export function toolbarSlideBounds(
	toolbarElement: HTMLElement,
	direction: SlideDirection
): SlideBounds | undefined {
	const slot = toolbarElement.parentElement
	const before = slot?.previousElementSibling
	const after = slot?.nextElementSibling
	if (!(before instanceof HTMLElement) || !(after instanceof HTMLElement)) return undefined
	return coreToolbarSlideBounds(
		{
			before: before.getBoundingClientRect(),
			after: after.getBoundingClientRect(),
			toolbar: toolbarElement.getBoundingClientRect(),
		},
		direction
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
	return coreToolbarGrabOffset({
		toolbar: options.toolbarElement.getBoundingClientRect(),
		clientX: options.clientX,
		clientY: options.clientY,
		direction: options.direction,
	})
}

/**
 * Intra-button grab: the mousedown point within the dragged button, in
 * pixels. A restructure extraction promotes the button into a fresh
 * singleton toolbar — adding this to the button's fresh offset inside its
 * new toolbar keeps the pointer glued to the same point on the icon
 * (the extraction grab). Falls back to the toolbar middle when the button
 * is unmeasurable.
 */
export function extractionGrabOffset(options: {
	toolbarElement: HTMLElement
	buttonElement: HTMLElement | undefined
	buttonGrab: { readonly x: number; readonly y: number } | undefined
	direction: SlideDirection
}): number {
	const button = options.buttonElement
	return coreExtractionGrabOffset({
		toolbar: options.toolbarElement.getBoundingClientRect(),
		button: button === undefined ? undefined : button.getBoundingClientRect(),
		buttonGrab: options.buttonGrab,
		direction: options.direction,
	})
}
