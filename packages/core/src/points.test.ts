import { describe, expect, it } from 'vitest'
import {
	type ActionPoint,
	type AnyPoint,
	isActionPoint,
	isValuedPoint,
	type StringPoint,
} from './points.js'

const action = (overrides: Partial<ActionPoint> = {}): ActionPoint => ({
	id: 'save',
	label: 'Save',
	type: 'action',
	run: () => {},
	...overrides,
})

const valued = (overrides: Partial<StringPoint> = {}): StringPoint => ({
	id: 'theme',
	label: 'Theme',
	type: 'string',
	defaultValue: 'light',
	...overrides,
})

describe('isActionPoint', () => {
	it('narrows runnable points', () => {
		expect(isActionPoint(action())).toBe(true)
		expect(isActionPoint(valued())).toBe(false)
	})

	it('is null-safe', () => {
		expect(isActionPoint(null)).toBe(false)
		expect(isActionPoint(undefined)).toBe(false)
	})

	it('rejects action-typed points without a run function', () => {
		expect(isActionPoint({ id: 'x', label: 'X', type: 'action' } as AnyPoint)).toBe(false)
	})
})

describe('isValuedPoint', () => {
	it('narrows valued points', () => {
		expect(isValuedPoint(valued())).toBe(true)
		expect(isValuedPoint(action())).toBe(false)
	})

	it('is null-safe', () => {
		expect(isValuedPoint(null)).toBe(false)
		expect(isValuedPoint(undefined)).toBe(false)
	})

	it('accepts every non-action type carrying a default', () => {
		for (const type of ['boolean', 'number', 'string', 'enum'] as const) {
			expect(isValuedPoint({ id: 'p', label: 'P', type, defaultValue: 0 } as AnyPoint)).toBe(true)
		}
	})
})
