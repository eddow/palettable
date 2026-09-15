/**
 * `@palettable/vanilla` — drop-zone highlight as a class-toggle pass (no rebuild).
 *
 * The core decides *which* gaps paint (`borderStackHighlight` /
 * `parkingGapHighlight` / `itemSpaceHighlight` — pure, no DOM); this module
 * applies the decision to the existing gap nodes. Each sync diffs against
 * the previous decision per root element and only touches changed indices,
 * so `pointermove` never re-renders and never touches `active` / `hovered` /
 * `committed` reactively — it just flips `highlighted` / `hovered` classes.
 */

import type { GapHighlight } from '@palettable/core'

type PrevDecision = {
	readonly highlighted: ReadonlySet<number>
	readonly hovered: number | undefined
}

const prevByRoot = new WeakMap<HTMLElement, PrevDecision>()

/**
 * Toggle `highlighted` / `hovered` on the gap nodes inside `root` whose
 * `data-*` index attribute is `attr` (e.g. `stackIndex`,
 * `parkingGapIndex`, `itemSpaceIndex`). Only changed indices are touched;
 * the previous decision is remembered per `root` (a rebuilt root starts
 * fresh, which is exactly what a structural sync wants).
 */
export function syncGapClasses(
	root: HTMLElement,
	highlight: GapHighlight,
	attr: 'stackIndex' | 'parkingGapIndex' | 'itemSpaceIndex'
): void {
	const prev = prevByRoot.get(root) ?? { highlighted: new Set<number>(), hovered: undefined }
	// `dataset.stackIndex` reads `data-stack-index`: the selector needs the
	// kebab-case attribute name, not the camelCase dataset key.
	const selector =
		attr === 'stackIndex'
			? 'stack-index'
			: attr === 'parkingGapIndex'
				? 'parking-gap-index'
				: 'item-space-index'
	const gaps = root.querySelectorAll(`[data-${selector}]`)
	for (const node of gaps) {
		if (!(node instanceof HTMLElement)) continue
		const raw = node.dataset[attr]
		const index = raw !== undefined ? Number(raw) : NaN
		if (!Number.isInteger(index)) continue
		const shouldHighlight = highlight.highlighted.has(index)
		const wasHighlight = prev.highlighted.has(index)
		if (shouldHighlight !== wasHighlight) node.classList.toggle('highlighted', shouldHighlight)
		const shouldHover = highlight.hovered === index
		const wasHover = prev.hovered === index
		if (shouldHover !== wasHover) node.classList.toggle('hovered', shouldHover)
	}
	prevByRoot.set(root, {
		highlighted: new Set(highlight.highlighted),
		hovered: highlight.hovered,
	})
}

/** Drop every `highlighted` / `hovered` class under `root` (editing off, drag end). */
export function clearGapClasses(root: HTMLElement): void {
	for (const node of root.querySelectorAll(
		'.toolbar-drop-zone.highlighted, .toolbar-drop-zone.hovered'
	)) {
		if (node instanceof HTMLElement) node.classList.remove('highlighted', 'hovered')
	}
	prevByRoot.delete(root)
}
