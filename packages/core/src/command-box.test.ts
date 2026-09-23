import { describe, expect, it } from 'vitest'
import {
	availableEntryKeywords,
	type CommandBoxEntry,
	enumValueKeywords,
	filterCommandEntries,
	paletteAddItemEntries,
	paletteCommandEntries,
	paletteDerivedVariants,
	paletteEnumSubsetValues,
	parseCommandInput,
	suggestCommandKeywords,
	tokenizeQuery,
	trimLastToken,
} from './command-box.js'
import type { AnyPoint } from './points.js'

function points(): AnyPoint[] {
	return [
		{
			id: 'notifications',
			label: 'Notifications',
			type: 'boolean',
			keywords: ['alerts'],
		},
		{
			id: 'theme',
			label: 'Theme',
			type: 'enum',
			constraints: {
				options: [
					{ value: 'light', label: 'Light', keywords: ['day'] },
					{ value: 'dark', label: 'Dark', keywords: ['night'] },
				],
			},
		},
		{
			id: 'fontSize',
			label: 'Font Size',
			type: 'number',
			constraints: { min: 10, max: 20, step: 1 },
		},
		{ id: 'reset', label: 'Reset Defaults', type: 'action', run: () => {} },
	]
}

describe('paletteCommandEntries', () => {
	it('derives run/setter/toggle/step entries with shortcut metas', () => {
		const entries = paletteCommandEntries(points(), {
			keys: {
				R: { kind: 'action', point: 'reset' },
				T: { kind: 'set', point: 'theme', value: 'light' },
				'+': { kind: 'inc', point: 'fontSize', delta: 1 },
			},
			values: { theme: 'dark', notifications: true },
		})
		expect(entries.find((entry) => entry.id === 'reset:action')?.label).toBe('Reset Defaults')
		expect(entries.find((entry) => entry.id === 'theme:set:"light"')?.label).toBe(
			'Set Theme to Light'
		)
		expect(entries.find((entry) => entry.id === 'theme:set:"light"')?.meta).toBe('T')
		expect(entries.find((entry) => entry.id === 'fontSize:inc:1')?.label).toBe(
			'Increase Font Size'
		)
		expect(entries.find((entry) => entry.id === 'notifications:toggle')?.label).toBe(
			'Toggle Notifications'
		)
		expect(entries.find((entry) => entry.id === 'notifications:set:false')?.label).toBe(
			'Disable Notifications'
		)
		expect(entries.find((entry) => entry.id === 'theme:set:"light"')?.keywords).toContain('day')
		// `run` is a runnable object, never a closure (SSR-safe).
		expect(entries.find((entry) => entry.id === 'reset:action')?.run).toEqual({
			kind: 'action',
			point: 'reset',
		})
	})

	it('disables the current value; unknown values stay enabled', () => {
		const entries = paletteCommandEntries(points(), { values: { theme: 'dark' } })
		expect(entries.find((entry) => entry.id === 'theme:set:"dark"')?.can).toBe(false)
		expect(entries.find((entry) => entry.id === 'theme:set:"light"')?.can).toBe(true)
		const noValues = paletteCommandEntries(points())
		expect(noValues.find((entry) => entry.id === 'theme:set:"dark"')?.can).toBe(true)
	})

	it('uses execute phrasing in run mode and preset labels in catalog mode', () => {
		const runEntries = paletteCommandEntries(points())
		const catalog = paletteCommandEntries(points(), {}, { mode: 'catalog' })
		expect(runEntries.find((entry) => entry.id === 'theme:set:"light"')?.label).toBe(
			'Set Theme to Light'
		)
		expect(catalog.find((entry) => entry.id === 'theme:catalog-enum')?.label).toBe('Theme')
		expect(catalog.find((entry) => entry.id === 'notifications:set:true')?.label).toBe(
			'Notifications → On (preset)'
		)
	})

	it('carries uses for render-time filtering', () => {
		const withUses: AnyPoint[] = [
			{ id: 'bold', label: 'Bold', type: 'boolean', uses: ['activeFile'] },
		]
		const entries = paletteCommandEntries(withUses)
		expect(entries[0]?.uses).toEqual(['activeFile'])
	})

	it('bounds-checks step entries when values context is present', () => {
		const atMin = paletteCommandEntries(points(), { values: { fontSize: 10 } })
		expect(atMin.find((entry) => entry.id === 'fontSize:dec:1')?.can).toBe(false)
		expect(atMin.find((entry) => entry.id === 'fontSize:inc:1')?.can).toBe(true)
		const atMax = paletteCommandEntries(points(), { values: { fontSize: 20 } })
		expect(atMax.find((entry) => entry.id === 'fontSize:inc:1')?.can).toBe(false)
		expect(atMax.find((entry) => entry.id === 'fontSize:dec:1')?.can).toBe(true)
		// No values context = enabled (adapters refine via `can`).
		const noValues = paletteCommandEntries(points())
		expect(noValues.find((entry) => entry.id === 'fontSize:inc:1')?.can).toBe(true)
		expect(noValues.find((entry) => entry.id === 'fontSize:dec:1')?.can).toBe(true)
	})
})

describe('paletteAddItemEntries / paletteDerivedVariants', () => {
	it('lists valued + action + nothing points by name (actions are addable)', () => {
		const entries = paletteAddItemEntries(points(), { itemControls: ['commandBox'] })
		expect(entries.some((entry) => entry.id === 'tool:fontSize')).toBe(true)
		expect(entries.some((entry) => entry.id === 'tool:theme')).toBe(true)
		// Actions flow through `addableEntries`, so a Save button can be added.
		expect(entries.some((entry) => entry.id === 'tool:reset')).toBe(true)
		expect(entries.find((entry) => entry.id === 'item:commandBox')?.meta).toBe(
			'Add control-only item'
		)
	})

	it('lists nothing-points as tool sources and skips claimed generic controls', () => {
		const withNothing: AnyPoint[] = [
			...points(),
			{ id: 'themeTool', label: 'Theme', type: 'nothing', controls: ['theme'] },
		]
		const entries = paletteAddItemEntries(withNothing, { itemControls: ['theme', 'status'] })
		expect(entries.some((entry) => entry.id === 'tool:themeTool')).toBe(true)
		// `theme` is claimed 1:1 by the nothing-point → no generic entry.
		expect(entries.some((entry) => entry.id === 'item:theme')).toBe(false)
		// `status` is unclaimed → generic fallback survives.
		expect(entries.some((entry) => entry.id === 'item:status')).toBe(true)
		const variants = paletteDerivedVariants(
			entries.find((entry) => entry.id === 'tool:themeTool')!,
			withNothing
		)
		expect(variants.map((variant) => variant.kind)).toEqual(['tool'])
		expect(variants[0]?.pointId).toBe('themeTool')
		expect(variants[0]?.control).toBe('theme')
	})

	it('expands sources into set variants carrying specs', () => {
		const entries = paletteAddItemEntries(points())
		const variants = paletteDerivedVariants(
			entries.find((entry) => entry.id === 'tool:fontSize')!,
			points()
		)
		expect(variants.map((variant) => variant.kind)).toEqual(['set'])
		expect(variants[0]?.spec).toBe('fontSize')
		expect(variants[0]?.valueType).toBe('number')
	})

	it('expands item sources into item variants', () => {
		const variants = paletteDerivedVariants(
			{
				id: 'item:commandBox',
				kind: 'item',
				control: 'commandBox',
				label: 'Command Box',
				meta: 'Add control-only item',
				keywords: [],
				activity: 'item',
			},
			points()
		)
		expect(variants[0]?.kind).toBe('item')
	})
})

describe('paletteEnumSubsetValues / enumValueKeywords', () => {
	it('matches explicit keywords and dot-separated names', () => {
		const values = paletteEnumSubsetValues({
			values: [
				{ value: 'layout.horizontal', label: 'Horizontal layout', keywords: ['row'] },
				{ value: 'layout.vertical', label: 'Vertical layout', keywords: ['column'] },
			],
			keywords: ['vertical'],
		})
		expect(values.map((entry) => entry.value)).toEqual(['layout.vertical'])
		expect(enumValueKeywords({ value: 'layout.horizontal', keywords: ['row'] })).toContain(
			'horizontal'
		)
	})

	it('returns all values without keywords', () => {
		const values = [
			{ value: 'a', label: 'A' },
			{ value: 'b', label: 'B' },
		]
		expect(paletteEnumSubsetValues({ values })).toEqual(values)
	})
})

describe('query model (tokenize/filter/rank/suggest/parse)', () => {
	const entries: CommandBoxEntry[] = [
		{
			id: 'theme-dark',
			label: 'Theme Dark',
			meta: '',
			keywords: ['theme', 'dark'],
			run: { kind: 'set', point: 'theme', value: 'dark' },
		},
		{
			id: 'mode-command',
			label: 'Mode Command',
			meta: '',
			keywords: ['mode', 'command'],
			run: { kind: 'action', point: 'mode' },
		},
	]

	it('tokenizes and trims the last token', () => {
		expect(tokenizeQuery('  a  b ')).toEqual(['a', 'b'])
		expect(trimLastToken('a b c')).toBe('a b')
	})

	it('filters by free text + keywords', () => {
		expect(
			filterCommandEntries(entries, { free: 'theme', keywords: ['dark'] }).map((entry) => entry.id)
		).toEqual(['theme-dark'])
	})

	it('excludes can:false entries and ranks exact > prefix > contains', () => {
		const ranked: CommandBoxEntry[] = [
			{ id: 'contains', label: 'Beta Alpha', meta: '', run: { kind: 'action', point: 'a' } },
			{ id: 'exact', label: 'Alpha', meta: '', run: { kind: 'action', point: 'b' } },
			{ id: 'prefix', label: 'Alpha Beta', meta: '', run: { kind: 'action', point: 'c' } },
			{
				id: 'off',
				label: 'Alpha Off',
				meta: '',
				can: false,
				run: { kind: 'action', point: 'd' },
			},
		]
		expect(filterCommandEntries(ranked, { free: 'alpha' }).map((entry) => entry.id)).toEqual([
			'exact',
			'prefix',
			'contains',
		])
	})

	it('suggests keywords completing the last word', () => {
		expect(suggestCommandKeywords(entries, 'da').map((suggestion) => suggestion.keyword)).toEqual([
			'dark',
		])
	})

	it('parses known keywords and free text', () => {
		expect(parseCommandInput('LIGHT accent light', ['light'])).toEqual({
			keywords: ['light'],
			text: 'accent',
		})
	})

	it('lists available keywords sorted and de-duplicated', () => {
		expect(availableEntryKeywords(entries)).toEqual(['command', 'dark', 'mode', 'theme'])
	})
})
