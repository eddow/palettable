import { describe, expect, it } from 'vitest'
import {
	createVanillaKeys,
	isEditableTarget,
	keystrokeFromEvent,
	normalizeKeystroke,
} from './keys.js'

function event(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
	return {
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		...init,
	} as KeyboardEvent
}

describe('normalizeKeystroke', () => {
	it('orders modifiers and normalizes aliases', () => {
		expect(normalizeKeystroke('shift+ctrl+s')).toBe('Ctrl+Shift+S')
		expect(normalizeKeystroke('cmd+s')).toBe('Meta+S')
		expect(normalizeKeystroke('escape')).toBe('Esc')
		expect(normalizeKeystroke(' space ')).toBe('Space')
		expect(normalizeKeystroke('`')).toBe('`')
	})
})

describe('keystrokeFromEvent / createVanillaKeys', () => {
	it('derives keystrokes from events and resolves bindings', () => {
		const keys = createVanillaKeys({ '`': 'console', 'ctrl+s': 'saveGame' })
		expect(keys.resolve(event({ key: '`' }))).toBe('console')
		expect(keys.resolve(event({ key: 's', ctrlKey: true }))).toBe('saveGame')
		expect(keys.findByTool('console')).toEqual(['`'])
		expect(keystrokeFromEvent(event({ key: 'n' }))).toBe('N')
	})
})

describe('isEditableTarget', () => {
	it('detects inputs and content-editables', () => {
		const input = document.createElement('input')
		expect(isEditableTarget(input)).toBe(true)
		expect(isEditableTarget(document.createElement('div'))).toBe(false)
		expect(isEditableTarget(null)).toBe(false)
	})
})
