import { describe, expect, it } from 'vitest'
import { canonicalPointId, parsePointSpec } from './specs.js'

describe('parsePointSpec', () => {
	it('parses a bare point id', () => {
		expect(parsePointSpec('theme')).toEqual({ kind: 'point', pointId: 'theme' })
	})

	it('parses `=` setter specs', () => {
		expect(parsePointSpec('theme=dark')).toEqual({
			kind: 'setter',
			pointId: 'theme',
			value: 'dark',
		})
	})

	it('parses legacy `|` setter specs', () => {
		expect(parsePointSpec('theme|dark')).toEqual({
			kind: 'setter',
			pointId: 'theme',
			value: 'dark',
		})
	})

	it('keeps everything after the first setter separator as the value', () => {
		expect(parsePointSpec('a=b=c')).toEqual({ kind: 'setter', pointId: 'a', value: 'b=c' })
	})

	it('parses action specs', () => {
		expect(parsePointSpec('fontSize:inc')).toEqual({
			kind: 'action',
			pointId: 'fontSize',
			action: 'inc',
		})
	})

	it('keeps everything after the first colon as the action', () => {
		expect(parsePointSpec('a:b:c')).toEqual({ kind: 'action', pointId: 'a', action: 'b:c' })
	})

	it('prefers the setter form when both separators are present', () => {
		expect(parsePointSpec('a=b:c')).toEqual({ kind: 'setter', pointId: 'a', value: 'b:c' })
	})
})

describe('canonicalPointId', () => {
	it('strips setter and action suffixes', () => {
		expect(canonicalPointId('theme')).toBe('theme')
		expect(canonicalPointId('theme=dark')).toBe('theme')
		expect(canonicalPointId('theme|dark')).toBe('theme')
		expect(canonicalPointId('fontSize:inc')).toBe('fontSize')
	})
})
