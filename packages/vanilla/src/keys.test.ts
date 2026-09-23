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

describe('keystrokeFromEvent / createVanillaKeys', () => {
	it('derives keystrokes from events and resolves bindings', () => {
		const keys = createVanillaKeys({
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
		const keys = createVanillaKeys({
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
		// Shift-letter bindings stay distinct.
		const letters = createVanillaKeys({
			A: { kind: 'action', point: 'x' },
			'Shift+A': { kind: 'action', point: 'y' },
		})
		expect(letters.resolve(event({ key: 'a' }))).toEqual({ kind: 'action', point: 'x' })
		expect(letters.resolve(event({ key: 'A', shiftKey: true }))).toEqual({
			kind: 'action',
			point: 'y',
		})
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
