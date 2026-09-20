/**
 * `@palettable/vanilla` — `clearGapClasses` probe.
 *
 * Highlight arrives as per-gap `DragEvent`s; this asserts clearing drops
 * every paint class.
 */
import { describe, expect, it } from 'vitest'
import { clearGapClasses } from './highlight.js'

function gapHost(count: number): HTMLElement {
	const root = document.createElement('div')
	for (let index = 0; index < count; index += 1) {
		const gap = document.createElement('div')
		gap.className = 'toolbar-stack-space toolbar-drop-zone highlighted'
		if (index === 0) gap.classList.add('hovered')
		gap.dataset.stackIndex = String(index)
		root.append(gap)
	}
	document.body.append(root)
	return root
}

describe('clearGapClasses', () => {
	it('clearGapClasses drops every paint class', () => {
		const root = gapHost(2)
		clearGapClasses(root)
		for (const gap of root.querySelectorAll('[data-stack-index]')) {
			expect(gap.classList.contains('highlighted')).toBe(false)
			expect(gap.classList.contains('hovered')).toBe(false)
		}
		root.remove()
	})
})
