/**
 * `@palettable/vue` — drop-zone highlight as a class-toggle pass (no rebuild).
 *
 * Same contract as the vanilla adapter's `highlight.ts`: highlight arrives
 * as per-gap `DragEvent`s from the core session; this module only clears
 * paint (`clearGapClasses`) on drag end / editing flip. The class
 * vocabulary (`highlighted` / `hovered`) is owned by core
 * (`dropZoneHighlightClasses`); this module owns the DOM traversal.
 * Framework-agnostic DOM helper — Vue components call it on teardown,
 * reactivity re-applies live paint from session events.
 */
import { dropZoneHighlightClasses } from '@palettable/core'

export { dropZoneHighlightClasses }

/** Drop every `highlighted` / `hovered` class under `root` (editing off, drag end). */
export function clearGapClasses(root: HTMLElement): void {
	const selector = dropZoneHighlightClasses.map((name) => `.toolbar-drop-zone.${name}`).join(', ')
	for (const node of root.querySelectorAll(selector)) {
		if (node instanceof HTMLElement) node.classList.remove(...dropZoneHighlightClasses)
	}
}
