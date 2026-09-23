import { describe, expect, it } from 'vitest'
import {
	actionableEntries,
	addableEntries,
	bindableEntries,
	filterCommandEntries,
} from './index.js'
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
		{ id: 'status', label: 'Status', type: 'nothing', controls: ['status'] },
	]
}

describe('actionableEntries', () => {
	it('mirrors paletteCommandEntries run rows with kind/point/value', () => {
		const entries = actionableEntries(points(), {
			keys: {
				R: { kind: 'action', point: 'reset' },
				T: { kind: 'set', point: 'theme', value: 'light' },
				'+': { kind: 'inc', point: 'fontSize', delta: 1 },
			},
			values: { theme: 'dark', notifications: true },
		})
		expect(entries.find((entry) => entry.id === 'reset:action')).toMatchObject({
			kind: 'action',
			point: 'reset',
			run: { kind: 'action', point: 'reset' },
			needsParam: false,
		})
		expect(entries.find((entry) => entry.id === 'theme:set:"light"')).toMatchObject({
			kind: 'set',
			point: 'theme',
			value: 'light',
			run: { kind: 'set', point: 'theme', value: 'light' },
			meta: 'T',
		})
		expect(entries.find((entry) => entry.id === 'fontSize:inc:1')).toMatchObject({
			kind: 'inc',
			point: 'fontSize',
			delta: 1,
			run: { kind: 'inc', point: 'fontSize', delta: 1 },
		})
		expect(entries.find((entry) => entry.id === 'notifications:toggle')).toMatchObject({
			kind: 'toggle',
			point: 'notifications',
			run: { kind: 'toggle', point: 'notifications' },
		})
		expect(entries.find((entry) => entry.id === 'notifications:set:false')).toMatchObject({
			kind: 'set',
			point: 'notifications',
			value: false,
		})
		// Nothing-points carry no runnable row.
		expect(entries.some((entry) => entry.point === 'status')).toBe(false)
	})

	it('disables the current value and bounds-checks steps', () => {
		const entries = actionableEntries(points(), { values: { theme: 'dark', fontSize: 10 } })
		expect(entries.find((entry) => entry.id === 'theme:set:"dark"')?.can).toBe(false)
		expect(entries.find((entry) => entry.id === 'theme:set:"light"')?.can).toBe(true)
		expect(entries.find((entry) => entry.id === 'fontSize:dec:1')?.can).toBe(false)
		expect(entries.find((entry) => entry.id === 'fontSize:inc:1')?.can).toBe(true)
	})

	it('carries uses for render-time filtering', () => {
		const withUses: AnyPoint[] = [
			{ id: 'bold', label: 'Bold', type: 'boolean', uses: ['activeFile'] },
		]
		expect(actionableEntries(withUses)[0]?.uses).toEqual(['activeFile'])
	})

	it('filters through the shared scorer', () => {
		const entries = actionableEntries(points())
		expect(filterCommandEntries(entries, { free: 'dark' }).map((entry) => entry.id)).toEqual([
			'theme:set:"dark"',
		])
	})
})

describe('addableEntries', () => {
	it('lists valued + action + nothing points, skipping can/uses', () => {
		const entries = addableEntries(points(), { itemControls: ['commandBox'] })
		expect(entries.some((entry) => entry.id === 'tool:fontSize')).toBe(true)
		expect(entries.some((entry) => entry.id === 'tool:theme')).toBe(true)
		// Actions are addable (Save-button case) — the legacy builder skipped them.
		const reset = entries.find((entry) => entry.id === 'tool:reset')
		expect(reset?.activity).toBe('action')
		expect(entries.find((entry) => entry.id === 'tool:status')?.activity).toBe('nothing')
		expect(entries.find((entry) => entry.id === 'item:commandBox')?.activity).toBe('item')
		for (const entry of entries) {
			expect(entry).not.toHaveProperty('can')
			expect(entry).not.toHaveProperty('uses')
		}
	})

	it('skips controls claimed 1:1 by a nothing-point', () => {
		const entries = addableEntries(points(), { itemControls: ['status', 'drawer'] })
		expect(entries.some((entry) => entry.id === 'item:status')).toBe(false)
		expect(entries.some((entry) => entry.id === 'item:drawer')).toBe(true)
	})

	it('filters through the shared scorer', () => {
		const entries = addableEntries(points())
		expect(filterCommandEntries(entries, { free: 'reset' }).map((entry) => entry.id)).toEqual([
			'tool:reset',
		])
	})
})

describe('bindableEntries', () => {
	it('lists actions directly bindable', () => {
		const entries = bindableEntries(points())
		expect(entries.find((entry) => entry.id === 'reset:action')).toMatchObject({
			kind: 'action',
			point: 'reset',
			needsParam: false,
			run: { kind: 'action', point: 'reset' },
		})
	})

	it('offers generic parametric identities plus concrete shortcuts', () => {
		const entries = bindableEntries(points())
		// Generic set identities: param present-but-undefined → prompt.
		const themeGeneric = entries.find((entry) => entry.id === 'theme=?')
		expect(themeGeneric).toMatchObject({ kind: 'set', point: 'theme', needsParam: true })
		expect(themeGeneric).toHaveProperty('value', undefined)
		expect(themeGeneric?.run).toBeUndefined()
		// Concrete per-value shortcuts bind with no prompt.
		expect(entries.find((entry) => entry.id === 'theme:set:"dark"')).toMatchObject({
			kind: 'set',
			point: 'theme',
			value: 'dark',
			needsParam: false,
			run: { kind: 'set', point: 'theme', value: 'dark' },
		})
		// Boolean: generic + toggle + on/off.
		expect(entries.find((entry) => entry.id === 'notifications=?')?.needsParam).toBe(true)
		expect(entries.find((entry) => entry.id === 'notifications:toggle')).toMatchObject({
			kind: 'toggle',
			needsParam: false,
			run: { kind: 'toggle', point: 'notifications' },
		})
		expect(entries.find((entry) => entry.id === 'notifications:set:true')).toMatchObject({
			kind: 'set',
			value: true,
			needsParam: false,
		})
		// Number: generic set + parametric steps with default delta prefilled.
		expect(entries.find((entry) => entry.id === 'fontSize=?')?.needsParam).toBe(true)
		expect(entries.find((entry) => entry.id === 'fontSize+=?')).toMatchObject({
			kind: 'inc',
			delta: 1,
			needsParam: true,
		})
		expect(entries.find((entry) => entry.id === 'fontSize-=?')).toMatchObject({
			kind: 'dec',
			delta: -1,
			needsParam: true,
		})
	})

	it('excludes nothing-points and carries no can/uses', () => {
		const entries = bindableEntries(points())
		expect(entries.some((entry) => entry.point === 'status')).toBe(false)
		for (const entry of entries) {
			expect(entry).not.toHaveProperty('can')
			expect(entry).not.toHaveProperty('uses')
		}
	})

	it('uses on/off keyword families without unset', () => {
		const entries = bindableEntries(points())
		const on = entries.find((entry) => entry.id === 'notifications:set:true')
		expect(on?.keywords).toContain('enable')
		expect(on?.keywords).not.toContain('unset')
		const off = entries.find((entry) => entry.id === 'notifications:set:false')
		expect(off?.keywords).toContain('disable')
		expect(off?.keywords).not.toContain('unset')
	})
})
