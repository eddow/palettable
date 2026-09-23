import { describe, expect, it, vi } from 'vitest'
import { PaletteCore } from './core.js'
import { PaletteError } from './errors.js'
import type { AnyPoint } from './points.js'

const DEFAULTS = { theme: 'light', fontSize: 14, flag: false, mode: 'a' } as const

function points(): AnyPoint[] {
	return [
		{ id: 'theme', label: 'Theme', type: 'string' },
		{
			id: 'fontSize',
			label: 'Font size',
			type: 'number',
			constraints: { step: 2 },
		},
		{ id: 'flag', label: 'Flag', type: 'boolean' },
		{
			id: 'mode',
			label: 'Mode',
			type: 'enum',
			constraints: { options: [{ value: 'a' }, { value: 'b' }] },
		},
		{ id: 'save', label: 'Save', type: 'action', run: vi.fn() },
	]
}

/** Hydrate a core with consumer-owned defaults (the data-owning pattern). */
function hydrated(options: ConstructorParameters<typeof PaletteCore>[1] = {}): PaletteCore {
	return new PaletteCore(points(), {
		...options,
		initialValues: { ...DEFAULTS, ...(options.initialValues ?? {}) },
	})
}

describe('PaletteCore construction', () => {
	it('rejects duplicate point ids', () => {
		expect(
			() =>
				new PaletteCore([
					{ id: 'a', label: 'A', type: 'string' },
					{ id: 'a', label: 'A2', type: 'string' },
				])
		).toThrow('duplicate point id "a"')
	})

	it('starts empty without initialValues (absent = skeleton)', () => {
		const core = new PaletteCore(points())
		expect(core.values.get('theme')).toBeUndefined()
		expect(core.values.has('theme')).toBe(false)
	})

	it('rejects invalid virtuals up front', () => {
		expect(
			() =>
				new PaletteCore(points(), {
					virtuals: [
						{
							id: 'bad',
							label: 'Bad',
							source: 'missing',
							kind: 'enum-from',
							options: [{ key: 'x', value: 0 }],
						},
					],
				})
		).toThrow('unknown source point "missing"')
	})

	it('builds a default layout from point ids and copies keys', () => {
		const keys = { 'Ctrl+S': { kind: 'action', point: 'save' } as const }
		const core = new PaletteCore(points(), { keys })
		expect(core.points.map((point) => point.id)).toEqual([
			'theme',
			'fontSize',
			'flag',
			'mode',
			'save',
		])
		expect(core.layout.getSnapshot().borders.top[0]?.[0]?.toolbar).toHaveLength(5)
		expect(core.keys).toEqual(keys)
		expect(core.keys).not.toBe(keys)
	})

	it('points and virtualPoints return cached arrays, invalidated on mutation', () => {
		const core = new PaletteCore(points())
		expect(core.points).toBe(core.points)
		expect(core.virtualPoints).toEqual([])
		core.defineVirtual({
			id: 'sizePreset',
			label: 'Size preset',
			source: 'fontSize',
			kind: 'enum-from',
			options: [{ key: 'small', value: 12 }],
		})
		expect(core.virtualPoints.map((virtual) => virtual.id)).toEqual(['sizePreset'])
		core.removeVirtual('sizePreset')
		expect(core.virtualPoints).toEqual([])
	})

	it('getDefinition looks up plain ids; getVirtual matches virtuals', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{
					id: 'sizePreset',
					label: 'Size preset',
					source: 'fontSize',
					kind: 'enum-from',
					options: [{ key: 'small', value: 12 }],
				},
			],
		})
		expect(core.getDefinition('theme')?.id).toBe('theme')
		expect(core.getDefinition('flag')?.id).toBe('flag')
		expect(core.getDefinition('fontSize')?.id).toBe('fontSize')
		// No spec-suffix stripping: runnable points are plain ids.
		expect(core.getDefinition('theme=dark')).toBeUndefined()
		expect(core.getDefinition('missing')).toBeUndefined()
		expect(core.getVirtual('sizePreset')?.id).toBe('sizePreset')
		expect(core.getVirtual('missing')).toBeUndefined()
	})

	it('resolveTargetVirtual returns registered virtuals and validates inline specs', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{
					id: 'sizePreset',
					label: 'Size preset',
					source: 'fontSize',
					kind: 'enum-from',
					options: [{ key: 'small', value: 12 }],
				},
			],
		})
		expect(core.resolveTargetVirtual('sizePreset')?.id).toBe('sizePreset')
		expect(core.resolveTargetVirtual('theme')).toBeUndefined()
		expect(
			core.resolveTargetVirtual({
				id: 'inlinePreset',
				label: 'Inline preset',
				source: 'fontSize',
				kind: 'enum-from',
				options: [{ key: 'small', value: 12 }],
			})?.id
		).toBe('inlinePreset')
		expect(() =>
			core.resolveTargetVirtual({
				id: 'bad',
				label: 'Bad',
				source: 'missing',
				kind: 'enum-from',
				options: [{ key: 'x', value: 0 }],
			})
		).toThrow('unknown source point "missing"')
	})
})

describe('defineVirtual / removeVirtual', () => {
	it('defines and removes virtuals', () => {
		const core = hydrated({
			virtuals: [
				{
					id: 'sizePreset',
					label: 'Size preset',
					source: 'fontSize',
					kind: 'enum-from',
					options: [{ key: 'small', value: 12 }],
				},
			],
		})
		core.run({ kind: 'set', point: 'sizePreset', value: 'small' })
		expect(core.values.get('fontSize')).toBe(12)
		core.defineVirtual({
			id: 'sizePreset',
			label: 'Size preset',
			source: 'fontSize',
			kind: 'enum-from',
			options: [{ key: 'normal', value: 14 }],
		})
		expect(core.getVirtual('sizePreset')?.source).toBe('fontSize')
		core.run({ kind: 'set', point: 'sizePreset', value: 'normal' })
		expect(core.values.get('fontSize')).toBe(14)

		core.removeVirtual('sizePreset')
		expect(core.getVirtual('sizePreset')).toBeUndefined()
		expect(() => core.run({ kind: 'set', point: 'sizePreset', value: 'normal' })).toThrow(
			'run: unknown point "sizePreset"'
		)
	})

	it('validates new virtuals against existing ids', () => {
		const core = new PaletteCore(points())
		expect(() =>
			core.defineVirtual({
				id: 'sizePreset',
				label: 'Preset',
				source: 'theme',
				kind: 'enum-from',
				options: [{ key: 'x', value: 'light' }],
			})
		).not.toThrow()
		expect(() =>
			core.defineVirtual({
				id: 'theme',
				label: 'Clash',
				source: 'fontSize',
				kind: 'enum-from',
				options: [{ key: 'x', value: 0 }],
			})
		).toThrow('duplicate point id "theme"')
		expect(() =>
			core.defineVirtual({
				id: 'bad',
				label: 'Bad',
				source: 'missing',
				kind: 'enum-from',
				options: [{ key: 'x', value: 0 }],
			})
		).toThrow('unknown source point "missing"')
	})

	it('emits definition notifications on virtual (re)definition + removal', () => {
		const core = new PaletteCore(points())
		const seen: string[] = []
		const stop = core.subscribeDefinitions((id) => seen.push(id))
		core.defineVirtual({
			id: 'sizePreset',
			label: 'Size preset',
			source: 'fontSize',
			kind: 'enum-from',
			options: [{ key: 'small', value: 12 }],
		})
		core.removeVirtual('sizePreset')
		stop()
		core.defineVirtual({
			id: 'late',
			label: 'Late',
			source: 'fontSize',
			kind: 'enum-from',
			options: [{ key: 'small', value: 12 }],
		})
		expect(seen).toEqual(['sizePreset', 'sizePreset'])
	})
})

describe('defineEnumOptions', () => {
	it('replaces the option list, invalidates the cache, and notifies', () => {
		const core = new PaletteCore(points())
		const before = core.points
		const seen: string[] = []
		core.subscribeDefinitions((id) => seen.push(id))
		core.defineEnumOptions('mode', [{ value: 'c' }, { value: 'd', label: 'Dee' }])
		expect(core.points).not.toBe(before)
		expect(core.getDefinition('mode')).toMatchObject({
			constraints: { options: [{ value: 'c' }, { value: 'd', label: 'Dee' }] },
		})
		expect(seen).toEqual(['mode'])
	})

	it('validates ids, families, emptiness, and duplicates', () => {
		const core = new PaletteCore(points())
		expect(() => core.defineEnumOptions('missing', [{ value: 'a' }])).toThrow(
			'defineEnumOptions: unknown point "missing"'
		)
		expect(() => core.defineEnumOptions('theme', [{ value: 'a' }])).toThrow(
			'defineEnumOptions: point "theme" is not an enum'
		)
		expect(() => core.defineEnumOptions('mode', [])).toThrow(
			'defineEnumOptions: point "mode" needs at least one option'
		)
		expect(() => core.defineEnumOptions('mode', [{ value: 'a' }, { value: 'a' }])).toThrow(
			'duplicate option value "a"'
		)
	})
})

describe('values (raw store)', () => {
	it('exposes the raw value store without re-implementing reads/writes', () => {
		const core = hydrated()
		expect(core.values.get('theme')).toBe('light')
		core.values.set('theme', 'dark')
		expect(core.values.get('theme')).toBe('dark')
	})

	it('does not resolve virtuals (raw store is virtual-unaware)', () => {
		const core = hydrated({
			virtuals: [
				{
					id: 'sizePreset',
					label: 'Size preset',
					source: 'fontSize',
					kind: 'enum-from',
					options: [
						{ key: 'small', value: 12 },
						{ key: 'normal', value: 14 },
					],
				},
			],
		})
		expect(core.values.get('sizePreset')).toBeUndefined()
		expect(core.values.get('fontSize')).toBe(14)
	})

	it('consumer setMany round-trips values then defaults (reset pattern)', () => {
		const core = hydrated()
		core.values.set('theme', 'dark')
		core.run({ kind: 'set', point: 'fontSize', value: 0 })
		expect(core.values.get('fontSize')).toBe(0)
		// Consumer reset = setMany(defaults) (core.resetAll is deleted).
		core.setMany({ ...DEFAULTS })
		expect(core.values.get('theme')).toBe('light')
		expect(core.values.get('fontSize')).toBe(14)
	})
})

describe('run', () => {
	it('runs action points synchronously (returned promise is not awaited)', () => {
		let calls = 0
		const core = new PaletteCore([
			{
				id: 'save',
				label: 'Save',
				type: 'action',
				run: () => {
					calls += 1
				},
			},
		])
		core.run({ kind: 'action', point: 'save' })
		expect(calls).toBe(1)
	})

	it('rejects running a valued point bare or an unknown point (sync throw)', () => {
		const core = hydrated()
		expect(() => core.run({ kind: 'action', point: 'theme' })).toThrow(
			'run: point "theme" is not an action'
		)
		expect(() => core.run({ kind: 'action', point: 'missing' })).toThrow(
			'run: unknown point "missing"'
		)
	})

	it('throws on setters against absent (skeleton) values', () => {
		const core = new PaletteCore(points())
		expect(() => core.run({ kind: 'set', point: 'theme', value: 'dark' })).toThrow(
			'no value for "theme"'
		)
		expect(() => core.run({ kind: 'inc', point: 'fontSize', delta: 2 })).toThrow(
			'no value for "fontSize"'
		)
		expect(() => core.run({ kind: 'toggle', point: 'flag' })).toThrow('no value for "flag"')
	})

	it('applies boolean / number / string setters with coercion', () => {
		const core = hydrated()
		core.run({ kind: 'set', point: 'flag', value: true })
		expect(core.values.get('flag')).toBe(true)
		core.run({ kind: 'set', point: 'flag', value: '0' })
		expect(core.values.get('flag')).toBe(false)
		core.run({ kind: 'set', point: 'fontSize', value: 42 })
		expect(core.values.get('fontSize')).toBe(42)
		core.run({ kind: 'set', point: 'theme', value: 'dark' })
		expect(core.values.get('theme')).toBe('dark')
		expect(() => core.run({ kind: 'set', point: 'flag', value: 'maybe' })).toThrow(
			'Invalid palette value'
		)
		expect(() => core.run({ kind: 'set', point: 'fontSize', value: 'abc' })).toThrow(
			'Invalid palette value'
		)
	})

	it('rejects blank and non-finite number setters (valueReader parity)', () => {
		const core = hydrated()
		expect(() => core.run({ kind: 'set', point: 'fontSize', value: '' })).toThrow(
			'Invalid palette value'
		)
		expect(() => core.run({ kind: 'set', point: 'fontSize', value: 'Infinity' })).toThrow(
			'Invalid palette value'
		)
		expect(() => core.run({ kind: 'set', point: 'fontSize', value: 'NaN' })).toThrow(
			'Invalid palette value'
		)
	})

	it('rejects setters on actions', () => {
		const core = hydrated()
		expect(() => core.run({ kind: 'set', point: 'save', value: 'x' })).toThrow(
			'run: point "save" is an action'
		)
	})

	it('toggles booleans (pure affectation)', () => {
		const core = hydrated()
		core.run({ kind: 'toggle', point: 'flag' })
		expect(core.values.get('flag')).toBe(true)
		core.run({ kind: 'toggle', point: 'flag' })
		expect(core.values.get('flag')).toBe(false)
		expect(() => core.run({ kind: 'toggle', point: 'theme' })).toThrow('is not a boolean')
		expect(() => core.run({ kind: 'toggle', point: 'save' })).toThrow('is an action')
	})

	it('applies number steps with explicit amounts', () => {
		const core = hydrated()
		core.run({ kind: 'inc', point: 'fontSize', delta: 2 })
		expect(core.values.get('fontSize')).toBe(16)
		core.run({ kind: 'dec', point: 'fontSize', delta: 2 })
		expect(core.values.get('fontSize')).toBe(14)
		core.run({ kind: 'inc', point: 'fontSize', delta: 0.5 })
		expect(core.values.get('fontSize')).toBe(14.5)
		expect(() => core.run({ kind: 'inc', point: 'theme', delta: 1 })).toThrow(
			'run: unknown step "theme"'
		)
		expect(() => core.run({ kind: 'inc', point: 'save', delta: 1 })).toThrow('is an action')
	})

	it('runs enum-from virtuals: bare re-writes the current key, setters map keys', () => {
		const core = hydrated({
			virtuals: [
				{
					id: 'sizePreset',
					label: 'Size preset',
					source: 'fontSize',
					kind: 'enum-from',
					options: [
						{ key: 'small', value: 12 },
						{ key: 'normal', value: 14 },
					],
				},
			],
		})
		core.run({ kind: 'set', point: 'sizePreset', value: 'small' })
		expect(core.values.get('fontSize')).toBe(12)
		core.run({ kind: 'action', point: 'sizePreset' })
		expect(core.values.get('fontSize')).toBe(12)
		expect(() => core.run({ kind: 'set', point: 'sizePreset', value: 'bogus' })).toThrow(
			'unknown option "bogus"'
		)
		expect(() => core.run({ kind: 'inc', point: 'sizePreset', delta: 1 })).toThrow(
			'virtual "sizePreset" supports only setters'
		)
	})

	it('rejects bare enum-from runs with no matching option', () => {
		const core = hydrated({
			virtuals: [
				{
					id: 'sizePreset',
					label: 'Size preset',
					source: 'fontSize',
					kind: 'enum-from',
					options: [{ key: 'small', value: 12 }],
				},
			],
		})
		expect(() => core.run({ kind: 'action', point: 'sizePreset' })).toThrow(
			'virtual "sizePreset" has no option for the current value'
		)
	})

	it('rejects suffixed virtual specs that are not setters', () => {
		const core = hydrated({
			virtuals: [
				{
					id: 'sizePreset',
					label: 'Size preset',
					source: 'fontSize',
					kind: 'enum-from',
					options: [{ key: 'small', value: 12 }],
				},
			],
		})
		expect(() => core.run({ kind: 'toggle', point: 'sizePreset' })).toThrow(
			'supports only setters'
		)
		expect(() => core.run({ kind: 'inc', point: 'sizePreset', delta: 1 })).toThrow(
			'supports only setters'
		)
	})
})

describe('can (runnable gate beside run)', () => {
	it('bounds-checks steps against min/max', () => {
		const core = new PaletteCore(
			[{ id: 'n', label: 'N', type: 'number', constraints: { min: 0, max: 10 } }],
			{
				initialValues: { n: 0 },
			}
		)
		expect(core.can({ kind: 'inc', point: 'n', delta: 2 })).toBe(true)
		expect(core.can({ kind: 'dec', point: 'n', delta: 2 })).toBe(false) // at min
		core.run({ kind: 'inc', point: 'n', delta: 2 })
		core.run({ kind: 'inc', point: 'n', delta: 2 })
		core.run({ kind: 'inc', point: 'n', delta: 2 })
		core.run({ kind: 'inc', point: 'n', delta: 2 })
		core.run({ kind: 'inc', point: 'n', delta: 2 }) // 0 → 10
		expect(core.values.get('n')).toBe(10)
		expect(core.can({ kind: 'inc', point: 'n', delta: 2 })).toBe(false) // at max
		expect(core.can({ kind: 'dec', point: 'n', delta: 2 })).toBe(true)
	})

	it('treats missing bounds as unlimited', () => {
		const core = new PaletteCore([{ id: 'n', label: 'N', type: 'number' }], {
			initialValues: { n: 0 },
		})
		expect(core.can({ kind: 'inc', point: 'n', delta: 1 })).toBe(true)
		expect(core.can({ kind: 'dec', point: 'n', delta: 1 })).toBe(true)
	})

	it('disables a step that would overshoot the bound', () => {
		const core = new PaletteCore(
			[{ id: 'n', label: 'N', type: 'number', constraints: { min: 0, max: 10 } }],
			{
				initialValues: { n: 8 },
			}
		)
		// 8 + 4 would overshoot 10 → disabled even though 8 < 10.
		expect(core.can({ kind: 'inc', point: 'n', delta: 4 })).toBe(false)
		expect(core.can({ kind: 'dec', point: 'n', delta: 4 })).toBe(true)
	})

	it('clamps run at the bounds instead of overshooting', () => {
		const core = new PaletteCore(
			[{ id: 'n', label: 'N', type: 'number', constraints: { min: 0, max: 10 } }],
			{
				initialValues: { n: 8 },
			}
		)
		core.run({ kind: 'inc', point: 'n', delta: 4 }) // 8 + 4 → clamped to 10, not 12
		expect(core.values.get('n')).toBe(10)
		core.run({ kind: 'dec', point: 'n', delta: 4 })
		expect(core.values.get('n')).toBe(6)
		core.setMany({ n: 1 })
		core.run({ kind: 'dec', point: 'n', delta: 4 }) // 1 - 4 → clamped to 0, not -3
		expect(core.values.get('n')).toBe(0)
	})

	it('never drives gameSpeed-style fractional bounds negative', () => {
		const core = new PaletteCore(
			[
				{
					id: 'gameSpeed',
					label: 'Speed',
					type: 'number',
					constraints: { min: 0.5, max: 5 },
				},
			],
			{
				initialValues: { gameSpeed: 0.5 },
			}
		)
		expect(core.can({ kind: 'dec', point: 'gameSpeed', delta: 0.5 })).toBe(false)
		core.run({ kind: 'dec', point: 'gameSpeed', delta: 0.5 }) // clamped backstop: stays at min
		expect(core.values.get('gameSpeed')).toBe(0.5)
	})

	it('throws on unknown points, non-numbers and absent values', () => {
		const core = hydrated()
		expect(() => core.can({ kind: 'inc', point: 'missing', delta: 1 })).toThrow(
			'Unknown palette point "missing"'
		)
		expect(() => core.can({ kind: 'inc', point: 'theme', delta: 1 })).toThrow(
			'run: unknown step "theme"'
		)
		expect(() => core.can({ kind: 'inc', point: 'save', delta: 1 })).toThrow(
			'Palette point "save" is an action'
		)
		const skeleton = new PaletteCore(points())
		// `can` is lenient on skeleton (returns false); `run` throws.
		expect(skeleton.can({ kind: 'inc', point: 'fontSize', delta: 1 })).toBe(false)
		expect(() => skeleton.run({ kind: 'inc', point: 'fontSize', delta: 1 })).toThrow(
			'no value for "fontSize"'
		)
	})
})

describe('subscriptions / dispose', () => {
	it('exposes value subscriptions through the raw store', () => {
		const core = hydrated()
		const global = vi.fn()
		const keyed = vi.fn()
		core.values.subscribe(global)
		core.values.subscribe('theme', keyed)
		core.values.set('theme', 'dark')
		expect(global).toHaveBeenCalledWith('theme', 'dark')
		expect(keyed).toHaveBeenCalledWith('dark')
	})

	it('emits layout snapshots via subscribeLayout', () => {
		const core = new PaletteCore(points())
		const listener = vi.fn()
		core.subscribeLayout(listener)
		core.layout.insertItem(
			{ container: 'border', region: 'top', trackIndex: 0, toolbarIndex: 0, itemIndex: 0 },
			{ point: 'extra' }
		)
		expect(listener).toHaveBeenCalledTimes(1)
		expect(listener.mock.calls[0]?.[0].version).toBe(2)
	})

	it('dispose drops value and layout listeners', () => {
		const core = hydrated()
		const valueListener = vi.fn()
		const layoutListener = vi.fn()
		core.values.subscribe(valueListener)
		core.subscribeLayout(layoutListener)
		core.dispose()
		core.values.set('theme', 'dark')
		core.layout.insertItem(
			{ container: 'border', region: 'top', trackIndex: 0, toolbarIndex: 0, itemIndex: 0 },
			{ point: 'extra' }
		)
		expect(valueListener).not.toHaveBeenCalled()
		expect(layoutListener).not.toHaveBeenCalled()
	})

	it('throws PaletteError instances (catchable as such)', () => {
		const core = hydrated()
		try {
			core.run({ kind: 'action', point: 'missing' })
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(PaletteError)
		}
	})
})
