import { describe, expect, it } from 'vitest'
import type { AnyPoint } from './points.js'
import {
	assertValidVirtual,
	computeStashTransition,
	type EnumFromDefinition,
	isEnumFromPoint,
	isStashPoint,
	matchEnumOption,
	readEnumFrom,
	resolveEnumSourceValue,
	resolveVirtualSource,
	type StashDefinition,
} from './virtual.js'

const gameSpeed: AnyPoint = { id: 'gameSpeed', label: 'Speed', type: 'number' }
const theme: AnyPoint = {
	id: 'theme',
	label: 'Theme',
	type: 'enum',
	constraints: { options: [{ value: 'light' }, { value: 'dark' }] },
}
const save: AnyPoint = { id: 'save', label: 'Save', type: 'action', run: () => {} }

const definitions = new Map<string, AnyPoint>([
	[gameSpeed.id, gameSpeed],
	[theme.id, theme],
	[save.id, save],
])

const enumVirtual: EnumFromDefinition<number> = {
	id: 'speedPreset',
	label: 'Speed preset',
	source: 'gameSpeed',
	kind: 'enum-from',
	options: [
		{ key: 'slow', value: 0.5 },
		{ key: 'normal', value: 1 },
	],
}

describe('isEnumFromPoint / isStashPoint', () => {
	it('narrows by kind and is null-safe', () => {
		const stash: StashDefinition<number> = {
			id: 'pause',
			label: 'Pause',
			source: 'gameSpeed',
			kind: 'stash',
			stashedValue: 0,
		}
		expect(isEnumFromPoint(enumVirtual)).toBe(true)
		expect(isEnumFromPoint(stash)).toBe(false)
		expect(isEnumFromPoint(null)).toBe(false)
		expect(isEnumFromPoint(undefined)).toBe(false)
		expect(isStashPoint(stash)).toBe(true)
		expect(isStashPoint(enumVirtual)).toBe(false)
		expect(isStashPoint(null)).toBe(false)
		expect(isStashPoint(undefined)).toBe(false)
	})
})

describe('assertValidVirtual', () => {
	it('accepts a well-formed virtual', () => {
		expect(() =>
			assertValidVirtual(enumVirtual, definitions, new Set(['gameSpeed', 'theme', 'save']))
		).not.toThrow()
	})

	it('rejects id collisions', () => {
		expect(() =>
			assertValidVirtual({ ...enumVirtual, id: 'gameSpeed' }, definitions, new Set(['gameSpeed']))
		).toThrow('duplicate point id "gameSpeed"')
	})

	it('rejects unknown and action sources', () => {
		expect(() =>
			assertValidVirtual({ ...enumVirtual, source: 'missing' }, definitions, new Set(['gameSpeed']))
		).toThrow('unknown source point "missing"')
		expect(() =>
			assertValidVirtual({ ...enumVirtual, source: 'save' }, definitions, new Set(['save']))
		).toThrow('source "save" is an action')
	})

	it('rejects self-sourcing virtuals', () => {
		expect(() =>
			assertValidVirtual(
				{ ...enumVirtual, id: 'loop', source: 'loop' },
				new Map([...definitions, ['loop', definitions.get('gameSpeed')!]]),
				new Set(['gameSpeed'])
			)
		).toThrow('source cannot be itself')
	})

	it('rejects empty or duplicate enum-from options', () => {
		expect(() =>
			assertValidVirtual({ ...enumVirtual, options: [] }, definitions, new Set())
		).toThrow('needs at least one option')
		expect(() =>
			assertValidVirtual(
				{
					...enumVirtual,
					options: [
						{ key: 'slow', value: 0.5 },
						{ key: 'slow', value: 1 },
					],
				},
				definitions,
				new Set()
			)
		).toThrow('duplicate option key "slow"')
	})
})

describe('matchEnumOption / readEnumFrom / resolveEnumSourceValue', () => {
	it('matches with Object.is semantics and first-option-wins', () => {
		const doubled: EnumFromDefinition<number> = {
			...enumVirtual,
			options: [
				{ key: 'first', value: 1 },
				{ key: 'second', value: 1 },
			],
		}
		expect(matchEnumOption(enumVirtual, 1)?.key).toBe('normal')
		expect(matchEnumOption(doubled, 1)?.key).toBe('first')
		expect(matchEnumOption(enumVirtual, 999)).toBeUndefined()
		// NaN matches via Object.is, never via ===.
		const nanVirtual: EnumFromDefinition<number> = {
			...enumVirtual,
			options: [{ key: 'nan', value: Number.NaN }],
		}
		expect(matchEnumOption(nanVirtual, Number.NaN)?.key).toBe('nan')
	})

	it('reads keys and resolves source values', () => {
		expect(readEnumFrom(enumVirtual, 0.5)).toBe('slow')
		expect(readEnumFrom(enumVirtual, 999)).toBeUndefined()
		expect(resolveEnumSourceValue(enumVirtual, 'slow')).toBe(0.5)
		expect(() => resolveEnumSourceValue(enumVirtual, 'missing')).toThrow('unknown option "missing"')
	})
})

describe('computeStashTransition', () => {
	it('pushes the current value aside when not at the stashed value', () => {
		expect(computeStashTransition(1, 0, { has: false }, 1)).toEqual({
			next: 0,
			asideAfter: { has: true, value: 1 },
		})
	})

	it('pops the aside value when at the stashed value', () => {
		expect(computeStashTransition(0, 0, { has: true, value: 2 }, 1)).toEqual({
			next: 2,
			asideAfter: { has: false },
		})
	})

	it('writes fallbackValue when at the stashed value with no aside', () => {
		expect(computeStashTransition(0, 0, { has: false }, 1)).toEqual({
			next: 1,
			asideAfter: { has: false },
		})
	})

	it('stays skeleton (undefined) when fallbackValue is omitted', () => {
		expect(computeStashTransition(0, 0, { has: false }, undefined)).toEqual({
			next: undefined,
			asideAfter: { has: false },
		})
	})

	it('uses Object.is so NaN stashes correctly', () => {
		// NaN Object.is-matches NaN: at the stashed value with no aside → fallbackValue.
		expect(computeStashTransition(Number.NaN, Number.NaN, { has: false }, 0)).toEqual({
			next: 0,
			asideAfter: { has: false },
		})
		// -0 does NOT Object.is-match +0: pushes aside instead of popping.
		expect(computeStashTransition(0, -0, { has: false }, 1)).toEqual({
			next: -0,
			asideAfter: { has: true, value: 0 },
		})
	})
})

describe('resolveVirtualSource', () => {
	it('returns the valued source definition', () => {
		expect(resolveVirtualSource(enumVirtual, definitions).id).toBe('gameSpeed')
	})

	it('throws on unknown or action sources', () => {
		expect(() => resolveVirtualSource({ ...enumVirtual, source: 'missing' }, definitions)).toThrow(
			'unknown source point "missing"'
		)
		expect(() => resolveVirtualSource({ ...enumVirtual, source: 'save' }, definitions)).toThrow(
			'unknown source point "save"'
		)
	})
})
