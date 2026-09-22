import { describe, expect, it } from 'vitest'
import { type EditorRegistry, editorChoicesFor, familyOfPoint } from './editors.js'
import type { AnyPoint } from './points.js'

const booleanPoint: AnyPoint = {
	id: 'flag',
	label: 'Flag',
	type: 'boolean',
}
const actionPoint: AnyPoint = { id: 'save', label: 'Save', type: 'action', run: () => {} }

const registry: EditorRegistry = {
	boolean: {
		toggle: { id: 'toggle', label: 'Toggle', families: ['boolean'] },
		press: {
			id: 'press',
			label: 'Press',
			families: ['boolean'],
			supportedAxes: 'horizontal',
		},
		hidden: { id: 'hidden', label: 'Hidden', families: ['boolean'], hidden: true },
	},
	item: {
		status: { id: 'status', label: 'Status', families: ['item'] },
	},
}

describe('familyOfPoint', () => {
	it('returns action for actions, else the type id', () => {
		expect(familyOfPoint(actionPoint)).toBe('action')
		expect(familyOfPoint(booleanPoint)).toBe('boolean')
	})
})

describe('editorChoicesFor', () => {
	it('lists visible variants for the point family', () => {
		const choices = editorChoicesFor(
			booleanPoint,
			{ axis: 'horizontal' },
			registry,
			undefined,
			undefined
		)
		expect(choices.map((choice) => choice.id)).toEqual(['toggle', 'press'])
		// No current/default: first variant wins.
		expect(choices.find((choice) => choice.selected)?.id).toBe('toggle')
	})

	it('filters by supportedAxes unless the surface is both', () => {
		const vertical = editorChoicesFor(
			booleanPoint,
			{ axis: 'vertical' },
			registry,
			undefined,
			undefined
		)
		expect(vertical.map((choice) => choice.id)).toEqual(['toggle'])

		const both = editorChoicesFor(booleanPoint, { axis: 'both' }, registry, undefined, undefined)
		expect(both.map((choice) => choice.id)).toEqual(['toggle', 'press'])
	})

	it('treats a both capability as universal', () => {
		const bothCap: EditorRegistry = {
			boolean: {
				universal: {
					id: 'universal',
					label: 'Universal',
					families: ['boolean'],
					supportedAxes: 'both',
				},
			},
		}
		const choices = editorChoicesFor(
			booleanPoint,
			{ axis: 'vertical' },
			bothCap,
			undefined,
			undefined
		)
		expect(choices.map((choice) => choice.id)).toEqual(['universal'])
	})

	it('prefers currentEditor, then defaults, then the first variant', () => {
		const current = editorChoicesFor(
			booleanPoint,
			{ axis: 'horizontal' },
			registry,
			{ boolean: 'toggle' },
			'press'
		)
		expect(current.find((choice) => choice.selected)?.id).toBe('press')

		const fallback = editorChoicesFor(
			booleanPoint,
			{ axis: 'horizontal' },
			registry,
			{ boolean: 'press' },
			undefined
		)
		expect(fallback.find((choice) => choice.selected)?.id).toBe('press')
	})

	it('uses the item family for nothing-point tools', () => {
		const choices = editorChoicesFor(
			undefined,
			{ axis: 'horizontal' },
			registry,
			undefined,
			undefined
		)
		expect(choices).toEqual([{ id: 'status', label: 'Status', selected: true }])
	})

	it('restricts nothing-points to their 1:1 editors subset', () => {
		const full: EditorRegistry = {
			item: {
				status: { id: 'status', label: 'Status', families: ['item'] },
				theme: { id: 'theme', label: 'Theme', families: ['item'] },
			},
		}
		const themePoint: AnyPoint = {
			id: 'theme',
			label: 'Theme',
			type: 'nothing',
			editors: ['theme'],
		}
		const choices = editorChoicesFor(themePoint, { axis: 'horizontal' }, full, undefined, undefined)
		expect(choices.map((choice) => choice.id)).toEqual(['theme'])
		// Omitted `editors` = whole item family (legacy).
		const legacy: AnyPoint = { id: 'legacy', label: 'Legacy', type: 'nothing' }
		expect(
			editorChoicesFor(legacy, { axis: 'horizontal' }, full, undefined, undefined).map(
				(choice) => choice.id
			)
		).toEqual(['status', 'theme'])
	})

	it('returns an empty list without a registry entry', () => {
		expect(
			editorChoicesFor(booleanPoint, { axis: 'horizontal' }, undefined, undefined, undefined)
		).toEqual([])
		expect(
			editorChoicesFor(actionPoint, { axis: 'horizontal' }, registry, undefined, undefined)
		).toEqual([])
	})
})
