import { PaletteStateStore, ValuesBag } from '@palettable/core'
import { describe, expect, it, vi } from 'vitest'
import { createValueProxy } from './value-proxy.js'

describe('createValueProxy over PaletteStateStore', () => {
	it('reads through to the bag and writes through via bag.set', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const { proxy } = createValueProxy<{ theme?: string }>(bag as never)
		expect(proxy.theme).toBe('dark')
		proxy.theme = 'light'
		expect(bag.get('theme')).toBe('light')
	})

	it('bag-notify writes through to the target and calls onChange', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const target: Record<string, unknown> = {}
		const onChange = vi.fn()
		const { proxy } = createValueProxy(bag as never, target, onChange)
		expect(target.theme).toBe('dark')
		bag.set('theme' as never, 'light' as never)
		expect(target.theme).toBe('light')
		expect(proxy.theme).toBe('light')
		expect(onChange).toHaveBeenCalledWith('theme', 'light')
	})

	it('dispose drops the bag subscription', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const target: Record<string, unknown> = {}
		const { proxy, dispose } = createValueProxy(bag as never, target)
		dispose()
		bag.set('theme' as never, 'light' as never)
		expect(target.theme).toBe('dark')
		// Proxy stays usable (direct write still lands in the bag).
		proxy.theme = 'light'
		expect(bag.get('theme')).toBe('light')
	})

	it('echo-loop guard: Object.is-equal proxy-set skips the bag write', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const global = vi.fn()
		bag.subscribe(global)
		const { proxy } = createValueProxy<{ theme?: string }>(bag as never)
		proxy.theme = 'dark'
		expect(global).not.toHaveBeenCalled()
	})

	it('single render path: proxy-set on a bag key renders via notify only', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const target: Record<string, unknown> = {}
		const onChange = vi.fn()
		const { proxy } = createValueProxy(bag as never, target, onChange)
		onChange.mockClear()
		proxy.theme = 'light'
		expect(bag.get('theme')).toBe('light')
		expect(target.theme).toBe('light')
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith('theme', 'light')
	})

	it('isBagKey partition: local keys never touch the bag, still render', () => {
		const bag = new PaletteStateStore()
		bag.set('theme' as never, 'dark' as never)
		const target: Record<string, unknown> = { lastAction: 'Ready' }
		const onChange = vi.fn()
		const bagKeys = new Set(['theme'])
		const { proxy } = createValueProxy<Record<string, unknown>>(bag as never, target, onChange, {
			isBagKey: (key) => bagKeys.has(key),
		})
		onChange.mockClear()
		proxy.lastAction = 'saved'
		expect(target.lastAction).toBe('saved')
		expect(bag.get('lastAction' as never)).toBeUndefined()
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith('lastAction', 'saved')
		// Same-value local write is a no-op (no render).
		onChange.mockClear()
		proxy.lastAction = 'saved'
		expect(onChange).not.toHaveBeenCalled()
	})
})

describe('createValueProxy over ValuesBag', () => {
	it('handles the (changed[]) global notify shape', () => {
		const bag = new ValuesBag({ theme: 'dark' })
		const target: Record<string, unknown> = {}
		const onChange = vi.fn()
		createValueProxy(bag as never, target, onChange)
		bag.set('theme', 'light')
		expect(target.theme).toBe('light')
		expect(onChange).toHaveBeenCalledWith('theme', 'light')
	})
})
