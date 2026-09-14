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

	it('points and virtualPoints return fresh arrays', () => {
		const core = new PaletteCore(points())
		expect(core.points).not.toBe(core.points)
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
		expect(core.getValue('fontSize')).toBe(0)
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
		expect(core.getValue('theme')).toBe('light')

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

describe('getValue / setValue / resetValue / resetAll', () => {
	it('reads and writes plain valued points', () => {
		const core = new PaletteCore(points())
		expect(core.getValue('theme')).toBe('light')
		core.setValue('theme', 'dark')
		expect(core.getValue('theme')).toBe('dark')
	})

	it('setValue rejects unknown points and actions', () => {
		const core = new PaletteCore(points())
		expect(() => core.setValue('missing', 'x' as never)).toThrow(
			'setValue: unknown point "missing"'
		)
		expect(() => core.setValue('save', undefined as never)).toThrow(
			'setValue: point "save" is an action'
		)
	})

	it('reads and writes through enum-from virtuals', () => {
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
		expect(core.getValue('sizePreset')).toBe('normal')
		core.setValue('sizePreset', 'small' as never)
		expect(core.getValue('fontSize')).toBe(12)
		expect(core.getValue('sizePreset')).toBe('small')
	})

	it('setValue rejects stash virtuals', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{ id: 'pause', label: 'Pause', source: 'fontSize', kind: 'stash', stashedValue: 0 },
			],
		})
		expect(() => core.setValue('pause', 0 as never)).toThrow(
			'setValue: virtual "pause" is a stash action'
		)
	})

	it('resetValue restores defaults (and virtual sources)', () => {
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
		core.setValue('theme', 'dark')
		core.resetValue('theme')
		expect(core.getValue('theme')).toBe('light')
		core.setValue('fontSize', 99)
		core.resetValue('sizePreset')
		expect(core.getValue('fontSize')).toBe(14)
		core.resetValue('missing')
	})

	it('resetAll restores every point and clears stash asides', () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{ id: 'pause', label: 'Pause', source: 'fontSize', kind: 'stash', stashedValue: 0 },
			],
		})
		core.setValue('theme', 'dark')
		core.runStash('pause')
		core.resetAll()
		expect(core.getValue('theme')).toBe('light')
		expect(core.getValue('fontSize')).toBe(14)
		// Aside cleared: stashing again pushes the default aside.
		core.runStash('pause')
		core.runStash('pause')
		expect(core.getValue('fontSize')).toBe(14)
	})
})

describe('run', () => {
	it('runs action points (awaiting async ones)', async () => {
		let calls = 0
		const core = new PaletteCore([
			{
				id: 'save',
				label: 'Save',
				type: 'action',
				run: async () => {
					calls += 1
				},
			},
		])
		await core.run('save')
		expect(calls).toBe(1)
	})

	it('rejects running a valued point bare or an unknown point', async () => {
		const core = new PaletteCore(points())
		await expect(core.run('theme')).rejects.toThrow('run: point "theme" is not an action')
		await expect(core.run('missing')).rejects.toThrow('run: unknown point "missing"')
	})

	it('applies boolean / number / string setters with coercion', async () => {
		const core = new PaletteCore(points())
		await core.run('flag=true')
		expect(core.getValue('flag')).toBe(true)
		await core.run('fontSize=42')
		expect(core.getValue('fontSize')).toBe(42)
		await core.run('theme=dark')
		expect(core.getValue('theme')).toBe('dark')
		await expect(core.run('flag=maybe')).rejects.toThrow('cannot coerce "maybe" to boolean')
		await expect(core.run('fontSize=abc')).rejects.toThrow('cannot coerce "abc" to number')
	})

	it('rejects setters on actions', async () => {
		const core = new PaletteCore(points())
		await expect(core.run('save=x')).rejects.toThrow('run: point "save" is an action')
	})

	it('applies number inc/dec actions with the configured step', async () => {
		const core = new PaletteCore(points())
		await core.run('fontSize:inc')
		expect(core.getValue('fontSize')).toBe(16)
		await core.run('fontSize:dec')
		expect(core.getValue('fontSize')).toBe(14)
		await expect(core.run('fontSize:bogus')).rejects.toThrow('run: unknown action "fontSize:bogus"')
		await expect(core.run('theme:inc')).rejects.toThrow('run: unknown action "theme:inc"')
	})

	it('defaults the step to 1 without constraints', async () => {
		const core = new PaletteCore([{ id: 'n', label: 'N', type: 'number', defaultValue: 0 }])
		await core.run('n:inc')
		expect(core.getValue('n')).toBe(1)
	})

	it('runs enum-from virtuals: bare re-writes the current key, setters map keys', async () => {
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
		await core.run('sizePreset=small')
		expect(core.getValue('fontSize')).toBe(12)
		await core.run('sizePreset')
		expect(core.getValue('fontSize')).toBe(12)
		await expect(core.run('sizePreset=bogus')).rejects.toThrow('unknown option "bogus"')
		await expect(core.run('sizePreset:inc')).rejects.toThrow(
			'virtual "sizePreset" supports no actions'
		)
	})

	it('rejects bare enum-from runs with no matching option', async () => {
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
		await expect(core.run('sizePreset')).rejects.toThrow(
			'virtual "sizePreset" has no option for the current value'
		)
	})

	it('runs stash virtuals and rejects suffixed stash specs', async () => {
		const core = new PaletteCore(points(), {
			virtuals: [
				{ id: 'pause', label: 'Pause', source: 'fontSize', kind: 'stash', stashedValue: 0 },
			],
		})
		await core.run('pause')
		expect(core.getValue('fontSize')).toBe(0)
		await core.run('pause')
		expect(core.getValue('fontSize')).toBe(14)
		await expect(core.run('pause=x')).rejects.toThrow('stash "pause" takes no suffix')
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
		expect(core.getValue('fontSize')).toBe(0)
		core.runStash('pause')
		expect(core.getValue('fontSize')).toBe(14)
		// At the stashed value with no aside → default.
		core.setValue('fontSize', 0)
		core.runStash('pause')
		expect(core.getValue('fontSize')).toBe(14)
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
	it('proxies value subscriptions to the store', () => {
		const core = new PaletteCore(points())
		const global = vi.fn()
		const keyed = vi.fn()
		core.subscribe(global)
		core.subscribe('theme', keyed)
		core.setValue('theme', 'dark')
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
		core.subscribe(valueListener)
		core.subscribeLayout(layoutListener)
		core.dispose()
		core.setValue('theme', 'dark')
		core.layout.insertItem(
			{ container: 'border', region: 'top', trackIndex: 0, toolbarIndex: 0, itemIndex: 0 },
			{ tool: 'extra' }
		)
		expect(valueListener).not.toHaveBeenCalled()
		expect(layoutListener).not.toHaveBeenCalled()
	})

	it('throws PaletteError instances (catchable as such)', async () => {
		const core = new PaletteCore(points())
		try {
			await core.run('missing')
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(PaletteError)
		}
	})
})
