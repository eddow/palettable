import { describe, expect, it } from 'vitest'
import { PaletteError } from './errors.js'
import {
	createHeadlessKeys,
	findKeystrokesFor,
	findKeystrokesForTarget,
	type KeyBindings,
	keystrokeFromEventLike,
	normalizeKeystroke,
} from './keys.js'

describe('findKeystrokesFor', () => {
	const bindings: KeyBindings = {
		'Ctrl+S': { kind: 'action', point: 'save' },
		'Ctrl+Shift+S': { kind: 'action', point: 'save' },
		'Ctrl+T': { kind: 'set', point: 'theme', value: 'dark' },
		'Ctrl+I': { kind: 'inc', point: 'fontSize', delta: 1 },
		'Ctrl+X': { kind: 'action', point: 'other' },
	}

	it('finds every keystroke bound to a point id', () => {
		expect(findKeystrokesFor(bindings, 'save')).toEqual(['Ctrl+S', 'Ctrl+Shift+S'])
	})

	it('matches setter, toggle and step runnables by their point id', () => {
		expect(findKeystrokesFor(bindings, 'theme')).toEqual(['Ctrl+T'])
		expect(findKeystrokesFor(bindings, 'fontSize')).toEqual(['Ctrl+I'])
		expect(findKeystrokesFor({ 'Ctrl+N': { kind: 'toggle', point: 'flag' } }, 'flag')).toEqual([
			'Ctrl+N',
		])
	})

	it('returns an empty array when nothing is bound', () => {
		expect(findKeystrokesFor(bindings, 'missing')).toEqual([])
		expect(findKeystrokesFor({}, 'save')).toEqual([])
	})

	it('does not prefix-match point ids', () => {
		expect(findKeystrokesFor({ 'Ctrl+A': { kind: 'action', point: 'saveGame' } }, 'save')).toEqual(
			[]
		)
	})
})

describe('findKeystrokesForTarget', () => {
	const bindings: KeyBindings = {
		'Ctrl+P': { kind: 'set', point: 'speedPreset', value: 'slow' },
		'Ctrl+T': { kind: 'set', point: 'theme', value: 'dark' },
	}

	it('matches runnables by their point', () => {
		expect(
			findKeystrokesForTarget(bindings, { kind: 'set', point: 'speedPreset', value: 'slow' })
		).toEqual(['Ctrl+P'])
		expect(
			findKeystrokesForTarget(bindings, { kind: 'set', point: 'theme', value: 'dark' })
		).toEqual(['Ctrl+T'])
	})

	it('matches inline virtual definitions by their own id', () => {
		expect(
			findKeystrokesForTarget(bindings, {
				id: 'speedPreset',
				label: 'Speed preset',
				source: 'gameSpeed',
				kind: 'enum-from',
				options: [{ key: 'slow', value: 0.5 }],
			})
		).toEqual(['Ctrl+P'])
	})
})

describe('PaletteError', () => {
	it('carries the PaletteError name', () => {
		const error = new PaletteError('boom')
		expect(error).toBeInstanceOf(Error)
		expect(error.name).toBe('PaletteError')
		expect(error.message).toBe('boom')
	})
})

describe('normalizeKeystroke (single adapter-shared copy)', () => {
	it('orders modifiers and normalizes aliases', () => {
		expect(normalizeKeystroke('shift+ctrl+s')).toBe('Ctrl+Shift+S')
		expect(normalizeKeystroke('cmd+s')).toBe('Meta+S')
		expect(normalizeKeystroke('escape')).toBe('Esc')
		expect(normalizeKeystroke(' space ')).toBe('Space')
	})

	it('keeps the Plus key through normalization (separator collision)', () => {
		expect(normalizeKeystroke('+')).toBe('+')
		expect(normalizeKeystroke('plus')).toBe('+')
		expect(normalizeKeystroke('Shift++')).toBe('+')
		expect(normalizeKeystroke('Shift+=')).toBe('+')
		expect(normalizeKeystroke('-')).toBe('-')
	})

	it('derives headless keystrokes and resolves headless registries', () => {
		expect(keystrokeFromEventLike({ key: 's', ctrlKey: true })).toBe('Ctrl+S')
		expect(keystrokeFromEventLike({ key: '+', shiftKey: true })).toBe('+')
		expect(keystrokeFromEventLike({ key: 'A', shiftKey: true })).toBe('Shift+A')
		const keys = createHeadlessKeys({
			'`': { kind: 'action', point: 'console' },
			'ctrl+s': { kind: 'action', point: 'saveGame' },
		})
		expect(keys.resolveKeystroke('Ctrl+S')).toEqual({ kind: 'action', point: 'saveGame' })
		expect(keys.findByTool('console')).toEqual(['`'])
	})
})
