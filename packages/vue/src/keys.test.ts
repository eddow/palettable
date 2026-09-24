import { describe, expect, it } from 'vitest'
import { createVueKeys, isEditableTarget, keystrokeFromEvent, normalizeKeystroke } from './keys.js'

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

	it('keeps the Plus key through normalization (separator collision)', () => {
		// A naive `split('+')` erases `'+'` → `''`, silently unbinding `inc`
		// shortcuts while `dec` (`'-'`) keeps working.
		expect(normalizeKeystroke('+')).toBe('+')
		expect(normalizeKeystroke('plus')).toBe('+')
		expect(normalizeKeystroke('Shift++')).toBe('+')
		expect(normalizeKeystroke('Shift+=')).toBe('+')
		expect(normalizeKeystroke('-')).toBe('-')
	})
})

describe('keystrokeFromEvent / createVueKeys', () => {
	it('derives keystrokes from events and resolves bindings', () => {
		const keys = createVueKeys({
			'`': { kind: 'action', point: 'console' },
			'ctrl+s': { kind: 'action', point: 'saveGame' },
		})
		expect(keys.resolve(event({ key: '`' }))).toEqual({ kind: 'action', point: 'console' })
		expect(keys.resolve(event({ key: 's', ctrlKey: true }))).toEqual({
			kind: 'action',
			point: 'saveGame',
		})
		expect(keys.findByTool('console')).toEqual(['`'])
		expect(keystrokeFromEvent(event({ key: 'n' }))).toBe('N')
	})

	it('resolves Plus bindings from both Shift+= and numpad presses', () => {
		const keys = createVueKeys({
			'+': { kind: 'inc', point: 'gameSpeed', delta: 0.5 },
			'-': { kind: 'dec', point: 'gameSpeed', delta: 0.5 },
		})
		// US layout: `+` is `Shift+=` → `key: '+'` with `shiftKey: true`.
		expect(keys.resolve(event({ key: '+', shiftKey: true }))).toEqual({
			kind: 'inc',
			point: 'gameSpeed',
			delta: 0.5,
		})
		// Numpad `+`: `key: '+'` with no modifiers.
		expect(keys.resolve(event({ key: '+' }))).toEqual({
			kind: 'inc',
			point: 'gameSpeed',
			delta: 0.5,
		})
		expect(keys.resolve(event({ key: '-' }))).toEqual({
			kind: 'dec',
			point: 'gameSpeed',
			delta: 0.5,
		})
	})

	it('keeps Shift on letters but drops it on symbols', () => {
		expect(keystrokeFromEvent(event({ key: 'A', shiftKey: true }))).toBe('Shift+A')
		// US layout: `+` arrives as `key: '+'` with `shiftKey: true`.
		expect(keystrokeFromEvent(event({ key: '+', shiftKey: true }))).toBe('+')
	})

	it('isEditableTarget swallows text inputs only', () => {
		const input = document.createElement('input')
		const button = document.createElement('button')
		expect(isEditableTarget(input)).toBe(true)
		expect(isEditableTarget(button)).toBe(false)
		expect(isEditableTarget(null)).toBe(false)
	})
})
