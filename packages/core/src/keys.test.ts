import { describe, expect, it } from 'vitest'
import { PaletteError } from './errors.js'
import { findKeystrokesFor, type KeyBindings } from './keys.js'

describe('findKeystrokesFor', () => {
	const bindings: KeyBindings = {
		'Ctrl+S': 'save',
		'Ctrl+Shift+S': 'save',
		'Ctrl+T': 'theme=dark',
		'Ctrl+I': 'fontSize:inc',
		'Ctrl+X': 'other',
	}

	it('finds every keystroke bound to a point id', () => {
		expect(findKeystrokesFor(bindings, 'save')).toEqual(['Ctrl+S', 'Ctrl+Shift+S'])
	})

	it('matches setter and action specs by their canonical point id', () => {
		expect(findKeystrokesFor(bindings, 'theme')).toEqual(['Ctrl+T'])
		expect(findKeystrokesFor(bindings, 'fontSize')).toEqual(['Ctrl+I'])
	})

	it('returns an empty array when nothing is bound', () => {
		expect(findKeystrokesFor(bindings, 'missing')).toEqual([])
		expect(findKeystrokesFor({}, 'save')).toEqual([])
	})

	it('does not prefix-match point ids', () => {
		expect(findKeystrokesFor({ 'Ctrl+A': 'saveGame' }, 'save')).toEqual([])
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
