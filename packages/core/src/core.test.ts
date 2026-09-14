import { describe, expect, it, vi } from 'vitest'
import { PaletteCore } from './core.js'
import { PaletteError } from './errors.js'
import type { AnyPoint } from './points.js'

function points(): AnyPoint[] {
	return [
		{ id: 'theme', label: 'Theme', type: 'string', defaultValue: 'light' },
		{
			id: 'fontSize',
			label: 'Font size',
			type: 'number',
			defaultValue: 14,
			constraints: { step: 2 },
		},
		{ id: 'flag', label: 'Flag', type: 'boolean', defaultValue: false },
		{
			id: 'mode',
			label: 'Mode',
			type: 'enum',
			defaultValue: 'a',
			constraints: { options: [{ value: 'a' }, { value: 'b' }] },
		},
		{ id: 'save', label: 'Save', type: 'action', run: vi.fn() },
	]
}

describe('PaletteCore construction', () => {
	it('rejects duplicate point ids', () => {
		expect(
			() =>
				new PaletteCore([
					{ id: 'a', label: 'A', type: 'string', defaultValue: 'x' },
					{ id: 'a', label: 'A2', type: 'string', defaultValue: 'y' },
				])
		).toThrow('duplicate point id "a"')
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
							kind: 'stash',
							stashedValue: 0,
						},
					],
				})
		).toThrow('unknown source point "missing"')
	})

	it('builds a default layout from point ids and copies keys', () => {
		const keys = { 'Ctrl+S': 'save' }
		const core = new PaletteCore(points(), { keys })
		expect(core.points.map((point) => point.id)).toEqual([
			'theme',
			'fontSize',
			'flag',
			'mode',
			'save',
		])
		expect(core.layout.getSnapshot().borders.top[0]?.toolbar).toHaveLength(5)
		expect(core.keys).toEqual(keys)
		expect(core.keys).not.toBe(keys)
	})

	it('points and virtualPoints return cached arrays, invalidated on mutation', () => {
		const core = new PaletteCore(points())
		expect(core.points).toBe(core.points)
		expect(core.virtualPoints).toEqual([])
		core.defineVirtual({
			id: 'pause',
			label: 'Pause',
			source: 'fontSize',
			kind: 'stash',
			stashedValue: 0,
		})
		expect(core.virtualPoints.map((virtual) => virtual.id)).toEqual(['pause'])
		core.removeVirtual('pause')
		expect(core.virtualPoints).toEqual([])
	})

	it('getDefinition strips spec suffixes; getVirtual matches virtuals', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{
					id: 'pause',
					label: 'Pause',
					source: 'fontSize',
					kind: 'stash',
					stashedValue: 0,
				},
			],
		})
		expect(core.getDefinition('theme=dark')?.id).toBe('theme')
		expect(core.getDefinition('missing')).toBeUndefined()
		expect(core.getVirtual('pause')?.id).toBe('pause')
		expect(core.getVirtual('missing')).toBeUndefined()
	})

	it('resolveTargetVirtual returns registered virtuals and validates inline specs', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{ id: 'pause', label: 'Pause', source: 'fontSize', kind: 'stash', stashedValue: 0 },
			],
		})
		expect(core.resolveTargetVirtual('pause')?.id).toBe('pause')
		expect(core.resolveTargetVirtual('theme')).toBeUndefined()
		expect(
			core.resolveTargetVirtual({
				id: 'inlinePause',
				label: 'Inline pause',
				source: 'fontSize',
				kind: 'stash',
				stashedValue: 0,
			})?.id
		).toBe('inlinePause')
		expect(() =>
			core.resolveTargetVirtual({
				id: 'bad',
				label: 'Bad',
				source: 'missing',
				kind: 'stash',
				stashedValue: 0,
			})
		).toThrow('unknown source point "missing"')
	})
})

describe('defineVirtual / removeVirtual', () => {
	it('defines and removes virtuals; redefining a stash clears its aside slot', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{ id: 'pause', label: 'Pause', source: 'fontSize', kind: 'stash', stashedValue: 0 },
			],
		})
		core.runStash('pause')
		expect(core.values.get('fontSize')).toBe(0)
		core.defineVirtual({
			id: 'pause',
			label: 'Pause',
			source: 'theme',
			kind: 'stash',
			stashedValue: 'muted',
		})
		expect(core.getVirtual('pause')?.source).toBe('theme')
		// Aside slot was cleared: popping now restores the theme default.
		core.runStash('pause')
		core.runStash('pause')
		expect(core.values.get('theme')).toBe('light')

		core.removeVirtual('pause')
		expect(core.getVirtual('pause')).toBeUndefined()
		expect(() => core.runStash('pause')).toThrow('unknown virtual "pause"')
	})

	it('validates new virtuals against existing ids', () => {
		const core = new PaletteCore(points())
		expect(() =>
			core.defineVirtual({
				id: 'sizePreset',
				label: 'Clash',
				source: 'theme',
				kind: 'stash',
				stashedValue: 'x',
			})
		).not.toThrow()
		expect(() =>
			core.defineVirtual({
				id: 'theme',
				label: 'Clash',
				source: 'fontSize',
				kind: 'stash',
				stashedValue: 0,
			})
		).toThrow('duplicate point id "theme"')
		expect(() =>
			core.defineVirtual({
				id: 'bad',
				label: 'Bad',
				source: 'missing',
				kind: 'stash',
				stashedValue: 0,
			})
		).toThrow('unknown source point "missing"')
	})
})

describe('values (raw store)', () => {
	it('exposes the raw value store without re-implementing reads/writes', () => {
		const core = new PaletteCore(points())
		expect(core.values.get('theme')).toBe('light')
		core.values.set('theme', 'dark')
		expect(core.values.get('theme')).toBe('dark')
	})

	it('does not resolve virtuals (raw store is virtual-unaware)', () => {
		const core = new PaletteCore(points(), {
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

	it('resetAll restores every point and clears stash asides', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{ id: 'pause', label: 'Pause', source: 'fontSize', kind: 'stash', stashedValue: 0 },
			],
		})
		core.values.set('theme', 'dark')
		core.runStash('pause')
		core.resetAll()
		expect(core.values.get('theme')).toBe('light')
		expect(core.values.get('fontSize')).toBe(14)
		// Aside cleared: stashing again pushes the default aside.
		core.runStash('pause')
		core.runStash('pause')
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
		core.run('save')
		expect(calls).toBe(1)
	})

	it('rejects running a valued point bare or an unknown point (sync throw)', () => {
		const core = new PaletteCore(points())
		expect(() => core.run('theme')).toThrow('run: point "theme" is not an action')
		expect(() => core.run('missing')).toThrow('run: unknown point "missing"')
	})

	it('applies boolean / number / string setters with coercion', () => {
		const core = new PaletteCore(points())
		core.run('flag=true')
		expect(core.values.get('flag')).toBe(true)
		core.run('flag=0')
		expect(core.values.get('flag')).toBe(false)
		core.run('fontSize=42')
		expect(core.values.get('fontSize')).toBe(42)
		core.run('theme=dark')
		expect(core.values.get('theme')).toBe('dark')
		expect(() => core.run('flag=maybe')).toThrow('Invalid palette value')
		expect(() => core.run('fontSize=abc')).toThrow('Invalid palette value')
	})

	it('rejects blank and non-finite number setters (valueReader parity)', () => {
		const core = new PaletteCore(points())
		expect(() => core.run('fontSize=')).toThrow('Invalid palette value')
		expect(() => core.run('fontSize=Infinity')).toThrow('Invalid palette value')
		expect(() => core.run('fontSize=NaN')).toThrow('Invalid palette value')
	})

	it('rejects setters on actions', () => {
		const core = new PaletteCore(points())
		expect(() => core.run('save=x')).toThrow('run: point "save" is an action')
	})

	it('applies number inc/dec actions with the configured step', () => {
		const core = new PaletteCore(points())
		core.run('fontSize:inc')
		expect(core.values.get('fontSize')).toBe(16)
		core.run('fontSize:dec')
		expect(core.values.get('fontSize')).toBe(14)
		expect(() => core.run('fontSize:bogus')).toThrow('run: unknown action "fontSize:bogus"')
		expect(() => core.run('theme:inc')).toThrow('run: unknown action "theme:inc"')
	})

	it('defaults the step to 1 without constraints', () => {
		const core = new PaletteCore([{ id: 'n', label: 'N', type: 'number', defaultValue: 0 }])
		core.run('n:inc')
		expect(core.values.get('n')).toBe(1)
	})

	it('runs enum-from virtuals: bare re-writes the current key, setters map keys', () => {
		const core = new PaletteCore(points(), {
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
		core.run('sizePreset=small')
		expect(core.values.get('fontSize')).toBe(12)
		core.run('sizePreset')
		expect(core.values.get('fontSize')).toBe(12)
		expect(() => core.run('sizePreset=bogus')).toThrow('unknown option "bogus"')
		expect(() => core.run('sizePreset:inc')).toThrow('virtual "sizePreset" supports no actions')
	})

	it('rejects bare enum-from runs with no matching option', () => {
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
		expect(() => core.run('sizePreset')).toThrow(
			'virtual "sizePreset" has no option for the current value'
		)
	})

	it('runs stash virtuals and rejects suffixed stash specs', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{ id: 'pause', label: 'Pause', source: 'fontSize', kind: 'stash', stashedValue: 0 },
			],
		})
		core.run('pause')
		expect(core.values.get('fontSize')).toBe(0)
		core.run('pause')
		expect(core.values.get('fontSize')).toBe(14)
		expect(() => core.run('pause=x')).toThrow('stash "pause" takes no suffix')
	})
})

describe('canRunAction', () => {
	it('bounds-checks inc/dec against min/max', () => {
		const core = new PaletteCore([
			{
				id: 'n',
				label: 'N',
				type: 'number',
				defaultValue: 0,
				constraints: { min: 0, max: 10, step: 2 },
			},
		])
		expect(core.canRunAction('n', 'inc')).toBe(true)
		expect(core.canRunAction('n', 'dec')).toBe(false) // at min
		core.run('n:inc')
		core.run('n:inc')
		core.run('n:inc')
		core.run('n:inc')
		core.run('n:inc') // 0 → 10
		expect(core.values.get('n')).toBe(10)
		expect(core.canRunAction('n', 'inc')).toBe(false) // at max
		expect(core.canRunAction('n', 'dec')).toBe(true)
	})

	it('treats missing bounds as unlimited', () => {
		const core = new PaletteCore([{ id: 'n', label: 'N', type: 'number', defaultValue: 0 }])
		expect(core.canRunAction('n', 'inc')).toBe(true)
		expect(core.canRunAction('n', 'dec')).toBe(true)
	})

	it('throws on unknown points/actions', () => {
		const core = new PaletteCore(points())
		expect(() => core.canRunAction('missing', 'inc')).toThrow('Unknown palette point "missing"')
		expect(() => core.canRunAction('fontSize', 'bogus')).toThrow(
			'run: unknown action "fontSize:bogus"'
		)
		expect(() => core.canRunAction('save', 'inc')).toThrow('Palette point "save" is an action')
	})
})

describe('runStash', () => {
	it('toggles push-aside / pop-back / restore-default', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{ id: 'pause', label: 'Pause', source: 'fontSize', kind: 'stash', stashedValue: 0 },
			],
		})
		core.runStash('pause')
		expect(core.values.get('fontSize')).toBe(0)
		core.runStash('pause')
		expect(core.values.get('fontSize')).toBe(14)
		// At the stashed value with no aside → default.
		core.values.set('fontSize', 0)
		core.runStash('pause')
		expect(core.values.get('fontSize')).toBe(14)
	})

	it('rejects unknown and non-stash virtuals', () => {
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
		expect(() => core.runStash('missing')).toThrow('runStash: unknown virtual "missing"')
		expect(() => core.runStash('sizePreset')).toThrow(
			'runStash: virtual "sizePreset" is not a stash'
		)
	})
})

describe('subscriptions / dispose', () => {
	it('exposes value subscriptions through the raw store', () => {
		const core = new PaletteCore(points())
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
			{ tool: 'extra' }
		)
		expect(listener).toHaveBeenCalledTimes(1)
		expect(listener.mock.calls[0]?.[0].version).toBe(1)
	})

	it('dispose drops value and layout listeners', () => {
		const core = new PaletteCore(points())
		const valueListener = vi.fn()
		const layoutListener = vi.fn()
		core.values.subscribe(valueListener)
		core.subscribeLayout(layoutListener)
		core.dispose()
		core.values.set('theme', 'dark')
		core.layout.insertItem(
			{ container: 'border', region: 'top', trackIndex: 0, toolbarIndex: 0, itemIndex: 0 },
			{ tool: 'extra' }
		)
		expect(valueListener).not.toHaveBeenCalled()
		expect(layoutListener).not.toHaveBeenCalled()
	})

	it('throws PaletteError instances (catchable as such)', () => {
		const core = new PaletteCore(points())
		try {
			core.run('missing')
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(PaletteError)
		}
	})
})
