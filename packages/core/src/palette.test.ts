import { describe, expect, it, vi } from 'vitest'
import { PaletteCore } from './core.js'
import { PaletteError, PaletteWriteError } from './errors.js'
import {
	type ActionRunners,
	fromServerDescriptor,
	readSetterValue,
	toServerDescriptor,
	validateInitialValues,
} from './palette.js'
import type { AnyPoint } from './points.js'
import { PaletteStateStore } from './store.js'

function points(): AnyPoint[] {
	return [
		{ id: 'theme', label: 'Theme', type: 'string', defaultValue: 'light' },
		{ id: 'fontSize', label: 'Font size', type: 'number', defaultValue: 14 },
		{ id: 'flag', label: 'Flag', type: 'boolean', defaultValue: false },
		{ id: 'save', label: 'Save', type: 'action', run: () => {} },
	]
}

describe('PaletteStateStore.setTree', () => {
	it('applies all pairs before notifying (no interleaved write+notify)', () => {
		const state = new PaletteStateStore(points())
		const seen: Array<readonly [string, string | undefined]> = []
		state.subscribe((id) => {
			// Both writes must have landed before the first listener runs.
			seen.push([id, state.get('fontSize') as string | undefined] as const)
		})
		const changed = state.setTree({ theme: 'dark', fontSize: 20 })
		expect(changed).toEqual(['theme', 'fontSize'])
		expect(state.get('theme')).toBe('dark')
		expect(state.get('fontSize')).toBe(20)
		// First notify already sees the second write.
		expect(seen[0]?.[1]).toBe(20)
	})

	it('skips Object.is-equal pairs and returns only changed keys', () => {
		const state = new PaletteStateStore(points())
		const global = vi.fn()
		state.subscribe(global)
		const changed = state.setTree({ theme: 'light', fontSize: 20 })
		expect(changed).toEqual(['fontSize'])
		expect(global).toHaveBeenCalledTimes(1)
		expect(global).toHaveBeenCalledWith('fontSize', 20)
	})

	it('returns [] and notifies nothing when nothing changed', () => {
		const state = new PaletteStateStore(points())
		const global = vi.fn()
		const keyed = vi.fn()
		state.subscribe(global)
		state.subscribe('theme', keyed)
		expect(state.setTree({ theme: 'light' })).toEqual([])
		expect(global).not.toHaveBeenCalled()
		expect(keyed).not.toHaveBeenCalled()
	})

	it('notifies per-key listeners only for their changed key', () => {
		const state = new PaletteStateStore(points())
		const themeListener = vi.fn()
		const sizeListener = vi.fn()
		state.subscribe('theme', themeListener)
		state.subscribe('fontSize', sizeListener)
		state.setTree({ theme: 'dark' })
		expect(themeListener).toHaveBeenCalledWith('dark')
		expect(sizeListener).not.toHaveBeenCalled()
	})
})

describe('PaletteCore initialValues / setMany', () => {
	it('applies initialValues after defaults with zero construction notifications', () => {
		const global = vi.fn()
		const core = new PaletteCore(points(), {
			initialValues: { theme: 'dark', fontSize: 20 },
		})
		expect(core.values.get('theme')).toBe('dark')
		expect(core.values.get('fontSize')).toBe(20)
		// Listeners attach after construction — nothing could have fired.
		core.values.subscribe(global)
		expect(global).not.toHaveBeenCalled()
	})

	it('throws on unknown ids and action ids', () => {
		expect(() => new PaletteCore(points(), { initialValues: { missing: 1 } })).toThrow(
			'initialValues: unknown point "missing"'
		)
		expect(() => new PaletteCore(points(), { initialValues: { save: 1 } })).toThrow(
			'initialValues: point "save" is not valued'
		)
	})

	it('setMany validates and batches (single flush, changed keys returned)', () => {
		const core = new PaletteCore(points())
		const calls: string[] = []
		core.values.subscribe((id) => {
			calls.push(id)
		})
		const changed = core.setMany({ theme: 'dark', fontSize: 20 })
		expect(changed).toEqual(['theme', 'fontSize'])
		expect(calls).toEqual(['theme', 'fontSize'])
		expect(() => core.setMany({ missing: 1 })).toThrow('initialValues: unknown point "missing"')
		expect(() => core.setMany({ save: 1 })).toThrow('initialValues: point "save" is not valued')
	})
})

describe('ServerPointDescriptor round-trip', () => {
	it('toServerDescriptor strips run; JSON round-trip is stable', () => {
		const descriptors = toServerDescriptor(points())
		expect(descriptors.find((descriptor) => descriptor.id === 'save')).not.toHaveProperty('run')
		const roundTripped = JSON.parse(JSON.stringify(descriptors)) as typeof descriptors
		expect(roundTripped).toEqual(descriptors)
	})

	it('fromServerDescriptor rebinds run by action id', () => {
		const descriptors = toServerDescriptor(points())
		const run = vi.fn()
		const runners: ActionRunners = { save: run }
		const rebuilt = fromServerDescriptor(
			JSON.parse(JSON.stringify(descriptors)) as typeof descriptors,
			runners
		)
		const core = new PaletteCore(rebuilt)
		core.run('save')
		expect(run).toHaveBeenCalledTimes(1)
	})

	it('fromServerDescriptor throws on missing/unknown runners and duplicates', () => {
		const descriptors = toServerDescriptor(points())
		expect(() => fromServerDescriptor(descriptors)).toThrow(
			'fromServerDescriptor: missing runner for action "save"'
		)
		expect(() => fromServerDescriptor(descriptors, { save: () => {}, ghost: () => {} })).toThrow(
			'fromServerDescriptor: unknown action "ghost" in runners'
		)
		expect(() =>
			fromServerDescriptor([...descriptors, descriptors[0]!], { save: () => {} })
		).toThrow('fromServerDescriptor: duplicate point id "theme"')
	})

	it('validateInitialValues is order-preserving and strict', () => {
		const core = new PaletteCore(points())
		const definitions = new Map(core.points.map((point) => [point.id, point]))
		expect(
			validateInitialValues({ theme: 'dark', fontSize: 20 }, definitions).map(([id]) => id)
		).toEqual(['theme', 'fontSize'])
		expect(() => validateInitialValues({ missing: 1 }, definitions)).toThrow(
			'initialValues: unknown point "missing"'
		)
	})

	it('readSetterValue parses booleans/numbers, passes strings through', () => {
		const core = new PaletteCore(points())
		const theme = core.resolveEditablePoint('theme')
		const fontSize = core.resolveEditablePoint('fontSize')
		const flag = core.resolveEditablePoint('flag', 'boolean')
		expect(readSetterValue(theme, 'dark')).toBe('dark')
		expect(readSetterValue(fontSize, '42')).toBe(42)
		expect(readSetterValue(flag, 'TRUE')).toBe(true)
		expect(readSetterValue(flag, '0')).toBe(false)
		expect(readSetterValue(flag, 'false')).toBe(false)
		expect(() => readSetterValue(flag, 'maybe')).toThrow('expected a boolean')
		expect(() => readSetterValue(fontSize, 'abc')).toThrow('Invalid palette value "abc"')
		expect(() => readSetterValue(fontSize, '  ')).toThrow('Invalid palette value')
		expect(() => readSetterValue(fontSize, 'Infinity')).toThrow('Invalid palette value')
	})
})

describe('PaletteCore.resolveEditablePoint / readActionCan', () => {
	it('resolves valued points, rejects actions/unknown/family mismatch', () => {
		const core = new PaletteCore(points())
		expect(core.resolveEditablePoint('theme').id).toBe('theme')
		expect(core.resolveEditablePoint('theme=dark').id).toBe('theme')
		expect(() => core.resolveEditablePoint('missing')).toThrow('Unknown palette point "missing"')
		expect(() => core.resolveEditablePoint('save')).toThrow(
			'Palette point "save" does not support editing'
		)
		expect(() => core.resolveEditablePoint('theme', 'number')).toThrow(
			'Palette point "theme" is "string", expected "number"'
		)
	})

	it('readActionCan evaluates functional can without running', () => {
		const run = vi.fn()
		const core = new PaletteCore([
			{ id: 'save', label: 'Save', type: 'action', run, can: () => false },
		])
		expect(core.readActionCan('save')).toBe(false)
		expect(run).not.toHaveBeenCalled()
		expect(() => core.readActionCan('missing')).toThrow('Unknown palette point "missing"')
	})
})

describe('uses contract + write errors', () => {
	it('PointBase accepts uses without behaviour change', () => {
		const core = new PaletteCore([
			{ id: 'bold', label: 'Bold', type: 'boolean', defaultValue: false, uses: ['activeFile'] },
		])
		expect(core.getDefinition('bold')?.uses).toEqual(['activeFile'])
		expect(core.values.get('bold')).toBe(false)
	})

	it('PaletteWriteError extends PaletteError (catchable as such)', () => {
		const error = new PaletteWriteError('locked')
		expect(error).toBeInstanceOf(PaletteError)
		expect(error).toBeInstanceOf(PaletteWriteError)
		expect(error.name).toBe('PaletteWriteError')
	})
})
