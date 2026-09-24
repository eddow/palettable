import { PaletteStateStore } from '@palettable/core'
import { describe, expect, it, vi } from 'vitest'
import { useValueLens } from './value-lens.js'

describe('useValueLens over PaletteStateStore', () => {
	it('reads through to the bag and writes through via bag.set', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const { state, dispose } = useValueLens<{ theme?: string }>(bag as never)
		expect(state.theme).toBe('dark')
		state.theme = 'light'
		expect(bag.get('theme')).toBe('light')
		dispose()
	})

	it('bag-notify writes through to the state and calls onChange', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const onChange = vi.fn()
		const { state, dispose } = useValueLens<Record<string, unknown>>(bag as never, { onChange })
		expect(state.theme).toBe('dark')
		bag.set('theme' as never, 'light' as never)
		expect(state.theme).toBe('light')
		expect(onChange).toHaveBeenCalledWith('theme', 'light')
		dispose()
	})

	it('dispose drops the bag subscription', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const onChange = vi.fn()
		const { state, dispose } = useValueLens<Record<string, unknown>>(bag as never, { onChange })
		dispose()
		onChange.mockClear()
		bag.set('theme' as never, 'light' as never)
		// No notify after dispose: no write-through, no onChange.
		expect(onChange).not.toHaveBeenCalled()
		// Lens stays usable (direct write still lands in the bag).
		state.theme = 'light'
		expect(bag.get('theme')).toBe('light')
	})

	it('echo-loop guard: Object.is-equal lens-set skips the bag write', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const global = vi.fn()
		bag.subscribe(global)
		const { state, dispose } = useValueLens<{ theme?: string }>(bag as never)
		state.theme = 'dark'
		expect(global).not.toHaveBeenCalled()
		dispose()
	})

	it('single render path: lens-set on a bag key renders via notify only', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const onChange = vi.fn()
		const { state, dispose } = useValueLens<Record<string, unknown>>(bag as never, { onChange })
		onChange.mockClear()
		state.theme = 'light'
		expect(bag.get('theme')).toBe('light')
		expect(state.theme).toBe('light')
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith('theme', 'light')
		dispose()
	})

	it('local-only keys never touch the bag', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const global = vi.fn()
		bag.subscribe(global)
		const onChange = vi.fn()
		const { state, dispose } = useValueLens<Record<string, unknown>>(bag as never, {
			isBagKey: (key) => key !== 'lastAction',
			initial: { lastAction: 'Ready' },
			onChange,
		})
		expect(state.lastAction).toBe('Ready')
		state.lastAction = 'Fired'
		expect(state.lastAction).toBe('Fired')
		expect(bag.get('lastAction' as never)).toBe(undefined)
		expect(global).not.toHaveBeenCalled()
		expect(onChange).toHaveBeenCalledWith('lastAction', 'Fired')
		dispose()
	})
})
