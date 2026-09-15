/**
 * `@palettable/vanilla` — `syncGapClasses` / `clearGapClasses` probe.
 *
 * Asserts the highlight pass only touches changed gap indices (class
 * toggles, no rebuild) and that clearing drops every paint class.
 */
import { describe, expect, it } from 'vitest'
import { clearGapClasses, syncGapClasses } from './highlight.js'

function gapHost(count: number): HTMLElement {
	const root = document.createElement('div')
	for (let index = 0; index < count; index += 1) {
		const gap = document.createElement('div')
		gap.className = 'toolbar-stack-space toolbar-drop-zone'
		gap.dataset.stackIndex = String(index)
		root.append(gap)
	}
	document.body.append(root)
	return root
}

describe('syncGapClasses', () => {
	it('paints only the decided gaps and diffs on re-sync', () => {
		const root = gapHost(3)
		const gaps = [...root.querySelectorAll('[data-stack-index]')]
		syncGapClasses(root, { highlighted: new Set([0, 1]), hovered: 1 }, 'stackIndex')
		expect(gaps[0]?.classList.contains('highlighted')).toBe(true)
		expect(gaps[1]?.classList.contains('highlighted')).toBe(true)
		expect(gaps[1]?.classList.contains('hovered')).toBe(true)
		expect(gaps[2]?.classList.contains('highlighted')).toBe(false)
		// Re-sync with the same decision: classes stay, nodes keep identity.
		syncGapClasses(root, { highlighted: new Set([0, 1]), hovered: 1 }, 'stackIndex')
		expect(root.querySelectorAll('[data-stack-index]')[0]).toBe(gaps[0])
		// Narrow to one gap: only the changed indices flip.
		syncGapClasses(root, { highlighted: new Set([2]), hovered: undefined }, 'stackIndex')
		expect(gaps[0]?.classList.contains('highlighted')).toBe(false)
		expect(gaps[1]?.classList.contains('highlighted')).toBe(false)
		expect(gaps[1]?.classList.contains('hovered')).toBe(false)
		expect(gaps[2]?.classList.contains('highlighted')).toBe(true)
		root.remove()
	})

	it('clearGapClasses drops every paint class', () => {
		const root = gapHost(2)
		syncGapClasses(root, { highlighted: new Set([0, 1]), hovered: 0 }, 'stackIndex')
		clearGapClasses(root)
		for (const gap of root.querySelectorAll('[data-stack-index]')) {
			expect(gap.classList.contains('highlighted')).toBe(false)
			expect(gap.classList.contains('hovered')).toBe(false)
		}
		root.remove()
	})
})
