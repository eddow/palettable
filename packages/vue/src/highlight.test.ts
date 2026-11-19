import { describe, expect, it } from 'vitest'
import { clearGapClasses, dropZoneHighlightClasses } from './highlight.js'

describe('clearGapClasses', () => {
	it('drops highlighted/hovered classes under the root', () => {
		const root = document.createElement('div')
		root.innerHTML =
			'<div class="toolbar-drop-zone highlighted"></div>' +
			'<div class="toolbar-drop-zone highlighted hovered"></div>' +
			'<div class="toolbar-drop-zone"></div>'
		clearGapClasses(root)
		expect(root.querySelectorAll('.highlighted').length).toBe(0)
		expect(root.querySelectorAll('.hovered').length).toBe(0)
		expect(root.querySelectorAll('.toolbar-drop-zone').length).toBe(3)
	})

	it('shares the highlight vocabulary with core (single source)', async () => {
		const core = await import('@palettable/core')
		expect(dropZoneHighlightClasses).toBe(core.dropZoneHighlightClasses)
	})
})
