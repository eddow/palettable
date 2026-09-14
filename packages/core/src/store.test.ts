import { describe, expect, it, vi } from 'vitest'
import * as schedule from './globals.js'
import type { AnyPoint } from './points.js'
import { PaletteStateStore } from './store.js'

const points: AnyPoint[] = [
	{ id: 'theme', label: 'Theme', type: 'string', defaultValue: 'light' },
	{ id: 'fontSize', label: 'Font size', type: 'number', defaultValue: 14 },
	{ id: 'save', label: 'Save', type: 'action', run: () => {} },
]

describe('PaletteStateStore', () => {
	it('hydrates valued points from defaults and ignores actions', () => {
		const state = new PaletteStateStore(points)
		expect(state.get('theme')).toBe('light')
		expect(state.get('fontSize')).toBe(14)
		expect(state.get('save')).toBeUndefined()
		expect(state.get('unknown')).toBeUndefined()
	})

	it('set writes and notifies global + key listeners', () => {
		const state = new PaletteStateStore(points)
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
		const state = new PaletteStateStore(points)
		const global = vi.fn()
		state.subscribe(global)
		state.set('theme', 'light')
		expect(global).not.toHaveBeenCalled()
		// NaN is Object.is-equal to itself: still a no-op.
		state.set('theme', Number.NaN as never)
		state.set('theme', Number.NaN as never)
		expect(global).toHaveBeenCalledTimes(1)
	})

	it('reset restores one default; resetAll restores every valued point', () => {
		const state = new PaletteStateStore(points)
		state.set('theme', 'dark')
		state.set('fontSize', 20)
		state.reset(points[0])
		expect(state.get('theme')).toBe('light')
		expect(state.get('fontSize')).toBe(20)
		state.resetAll(points)
		expect(state.get('fontSize')).toBe(14)
	})

	it('reset is a no-op for actions and unknown ids', () => {
		const state = new PaletteStateStore(points)
		expect(() => state.reset(undefined)).not.toThrow()
		expect(() => state.reset(points[2])).not.toThrow()
	})

	it('asObject returns a fresh plain-object snapshot', () => {
		const state = new PaletteStateStore(points)
		const snapshot = state.asObject()
		expect(snapshot).toEqual({ theme: 'light', fontSize: 14 })
		snapshot.theme = 'mutated'
		expect(state.get('theme')).toBe('light')
	})

	it('unsubscribe stops notifications; clearListeners drops everything', () => {
		const state = new PaletteStateStore(points)
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
		const state = new PaletteStateStore(points)
		const second = vi.fn()
		const first = vi.fn(() => stop())
		const stop = state.subscribe(first)
		state.subscribe(second)
		state.set('theme', 'dark')
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(1)
	})

	it('a throwing listener never blocks the others', () => {
		const state = new PaletteStateStore(points)
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
		const state = new PaletteStateStore(points)
		const keyed = vi.fn()
		state.subscribe('theme', keyed)
		state.set('fontSize', 99)
		expect(keyed).not.toHaveBeenCalled()
	})
})
