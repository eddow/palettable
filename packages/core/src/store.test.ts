import { describe, expect, it, vi } from 'vitest'
import { PaletteError } from './errors.js'
import * as schedule from './globals.js'
import { PaletteStateStore } from './store.js'

describe('PaletteStateStore', () => {
	it('starts empty (no hydration from definitions); absent = skeleton', () => {
		const state = new PaletteStateStore()
		expect(state.get('theme')).toBeUndefined()
		expect(state.get('fontSize')).toBeUndefined()
		expect(state.get('save')).toBeUndefined()
		expect(state.get('unknown')).toBeUndefined()
		expect(state.has('theme')).toBe(false)
		expect(state.asObject()).toEqual({})
	})

	it('has is false until set, true after; require throws on absent', () => {
		const state = new PaletteStateStore()
		expect(state.has('theme')).toBe(false)
		expect(() => state.require('theme')).toThrow(PaletteError)
		expect(() => state.require('theme')).toThrow('no value for "theme"')
		state.set('theme', 'dark')
		expect(state.has('theme')).toBe(true)
		expect(state.require('theme')).toBe('dark')
	})

	it('set writes and notifies global + key listeners', () => {
		const state = new PaletteStateStore()
		const global = vi.fn()
		const keyed = vi.fn()
		const other = vi.fn()
		state.subscribe(global)
		state.subscribe('theme', keyed)
		state.subscribe('fontSize', other)

		state.set('theme', 'dark')

		expect(state.get('theme')).toBe('dark')
		expect(global).toHaveBeenCalledTimes(1)
		expect(global).toHaveBeenCalledWith('theme', 'dark')
		expect(keyed).toHaveBeenCalledTimes(1)
		expect(keyed).toHaveBeenCalledWith('dark')
		expect(other).not.toHaveBeenCalled()
	})

	it('set is a no-op when Object.is-equal (echo-loop guard)', () => {
		const state = new PaletteStateStore()
		state.set('theme', 'light')
		const global = vi.fn()
		state.subscribe(global)
		state.set('theme', 'light')
		expect(global).not.toHaveBeenCalled()
		// NaN is Object.is-equal to itself: still a no-op.
		state.set('theme', Number.NaN as never)
		state.set('theme', Number.NaN as never)
		expect(global).toHaveBeenCalledTimes(1)
	})

	it('setTree batches writes then notifies (single flush pass)', () => {
		const state = new PaletteStateStore()
		const seen: Array<readonly [string, unknown]> = []
		state.subscribe((id) => {
			seen.push([id, state.get('fontSize')] as const)
		})
		const changed = state.setTree({ theme: 'dark', fontSize: 20 })
		expect(changed).toEqual(['theme', 'fontSize'])
		expect(state.get('theme')).toBe('dark')
		expect(state.get('fontSize')).toBe(20)
		expect(seen[0]?.[1]).toBe(20)
	})

	it('asObject returns a fresh plain-object snapshot', () => {
		const state = new PaletteStateStore()
		state.set('theme', 'light')
		state.set('fontSize', 14)
		const snapshot = state.asObject()
		expect(snapshot).toEqual({ theme: 'light', fontSize: 14 })
		snapshot.theme = 'mutated'
		expect(state.get('theme')).toBe('light')
	})

	it('unsubscribe stops notifications; clearListeners drops everything', () => {
		const state = new PaletteStateStore()
		const global = vi.fn()
		const keyed = vi.fn()
		const stopGlobal = state.subscribe(global)
		const stopKeyed = state.subscribe('theme', keyed)
		stopGlobal()
		stopKeyed()
		state.set('theme', 'dark')
		expect(global).not.toHaveBeenCalled()
		expect(keyed).not.toHaveBeenCalled()

		state.subscribe(global)
		state.subscribe('theme', keyed)
		state.clearListeners()
		state.set('theme', 'light')
		expect(global).not.toHaveBeenCalled()
		expect(keyed).not.toHaveBeenCalled()
	})

	it('unsubscribe-during-notify is safe (snapshot iteration)', () => {
		const state = new PaletteStateStore()
		const second = vi.fn()
		const first = vi.fn(() => stop())
		const stop = state.subscribe(first)
		state.subscribe(second)
		state.set('theme', 'dark')
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(1)
	})

	it('a throwing listener never blocks the others', () => {
		const state = new PaletteStateStore()
		const after = vi.fn()
		// The store re-throws via scheduleMicrotask — capture it instead of
		// letting it escape as an uncaught exception in the test worker.
		const queued: (() => void)[] = []
		const spy = vi.spyOn(schedule, 'scheduleMicrotask').mockImplementation((callback) => {
			queued.push(callback)
		})
		try {
			state.subscribe(() => {
				throw new Error('bad listener')
			})
			state.subscribe(after)
			state.set('theme', 'dark')
			expect(after).toHaveBeenCalledTimes(1)
			expect(state.get('theme')).toBe('dark')
			expect(queued).toHaveLength(1)
			expect(() => queued[0]?.()).toThrow('bad listener')
		} finally {
			spy.mockRestore()
		}
	})

	it('key listeners for other ids are not notified', () => {
		const state = new PaletteStateStore()
		const keyed = vi.fn()
		state.subscribe('theme', keyed)
		state.set('fontSize', 99)
		expect(keyed).not.toHaveBeenCalled()
	})
})
