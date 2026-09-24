/**
 * `@palettable/vue` — drop-zone highlight as a class-toggle pass (no rebuild).
 *
 * Verbatim port of the vanilla adapter's `highlight.ts`: highlight arrives
 * as per-gap `DragEvent`s from the core session; this module only clears
 * paint (`clearGapClasses`) on drag end / editing flip. Framework-agnostic
 * DOM helper — Vue components call it on teardown, reactivity re-applies
 * live paint from session events.
 */

/** Drop every `highlighted` / `hovered` class under `root` (editing off, drag end). */
export function clearGapClasses(root: HTMLElement): void {
	for (const node of root.querySelectorAll(
		'.toolbar-drop-zone.highlighted, .toolbar-drop-zone.hovered'
	)) {
		if (node instanceof HTMLElement) node.classList.remove('highlighted', 'hovered')
	}
}
