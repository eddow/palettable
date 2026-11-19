import { PaletteStateStore, ValuesBag } from '@palettable/core'
import { describe, expect, it, vi } from 'vitest'
import { effect, stop } from 'vue'
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

	it('reactive effect updates on an external store write', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const { state, dispose } = useValueLens<{ theme?: string }>(bag as never)
		const seen: Array<string | undefined> = []
		const runner = effect(() => {
			seen.push(state.theme)
		})
		expect(seen).toEqual(['dark'])
		bag.set('theme' as never, 'light' as never)
		expect(state.theme).toBe('light')
		expect(seen).toEqual(['dark', 'light'])
		// Equal-value write is a store no-op: no new effect run.
		bag.set('theme' as never, 'light' as never)
		expect(seen).toEqual(['dark', 'light'])
		stop(runner)
		dispose()
	})

	it('reactive effect updates on a lens write', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const onChange = vi.fn()
		const { state, dispose } = useValueLens<{ theme?: string }>(bag as never, { onChange })
		const seen: Array<string | undefined> = []
		const runner = effect(() => {
			seen.push(state.theme)
		})
		expect(seen).toEqual(['dark'])
		onChange.mockClear()
		state.theme = 'light'
		expect(bag.get('theme')).toBe('light')
		expect(state.theme).toBe('light')
		expect(seen).toEqual(['dark', 'light'])
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith('theme', 'light')
		// Equal-value lens write skips the bag write: no notify, no new run.
		bag.set('theme' as never, 'light' as never)
		state.theme = 'light'
		expect(seen).toEqual(['dark', 'light'])
		stop(runner)
		dispose()
	})

	it('reactive effect stops updating after disposal', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const { state, dispose } = useValueLens<{ theme?: string }>(bag as never)
		const seen: Array<string | undefined> = []
		const runner = effect(() => {
			seen.push(state.theme)
		})
		expect(seen).toEqual(['dark'])
		dispose()
		bag.set('theme' as never, 'light' as never)
		expect(bag.get('theme')).toBe('light')
		// Post-dispose the lens stays frozen at the last synced value: the
		// subscription is dropped, so bag-notify no longer writes through.
		expect(state.theme).toBe('dark')
		expect(seen).toEqual(['dark'])
		// Keys added after disposal stay invisible: a disposed lens never
		// reads the live bag (the `undefined`-tracked fallback is
		// subscribed-lenses only).
		bag.set('late' as never, 'x' as never)
		expect((state as Record<string, unknown>).late).toBe(undefined)
		stop(runner)
	})

	it('object identity survives a lens round-trip (no proxy, no notify)', () => {
		const bag = new PaletteStateStore()
		const config = { icon: 'x', label: 'Y' }
		bag.set('config' as never, config as never)
		const global = vi.fn()
		bag.subscribe(global)
		const { state, dispose } = useValueLens<{ config?: unknown }>(bag as never)
		// The lens returns the raw object — writing it back is an
		// equal-value write: no store notification, same identity kept.
		expect(state.config).toBe(config)
		state.config = config
		expect(global).not.toHaveBeenCalled()
		expect(bag.get('config')).toBe(config)
		// A genuinely new object still writes through once.
		const next = { icon: 'x', label: 'Y' }
		state.config = next
		expect(bag.get('config')).toBe(next)
		expect(global).toHaveBeenCalledTimes(1)
		dispose()
	})

	it('reactive effect updates on ValuesBag writes (bag shape)', () => {
		const bag = new ValuesBag<{ theme?: string }>({ theme: 'dark' })
		const { state, dispose } = useValueLens<{ theme?: string }>(bag as never)
		const seen: Array<string | undefined> = []
		const runner = effect(() => {
			seen.push(state.theme)
		})
		expect(seen).toEqual(['dark'])
		bag.set('theme', 'light')
		expect(state.theme).toBe('light')
		expect(seen).toEqual(['dark', 'light'])
		stop(runner)
		dispose()
	})
})
