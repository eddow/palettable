import { describe, expect, it, vi } from 'vitest'
import { ConsoleStore, consolePointDescriptor } from './console.js'

describe('ConsoleStore', () => {
	it('starts closed in run mode with default add state', () => {
		const console = new ConsoleStore()
		expect(console.snapshot).toEqual({
			open: false,
			mode: 'run',
			selectedEntryId: undefined,
			selectedVariantId: undefined,
			booleanValue: 'true',
			setValue: '',
			enumValues: '',
			enumKeywords: '',
		})
	})

	it('open/close/toggle emit snapshots', () => {
		const console = new ConsoleStore()
		const listener = vi.fn()
		console.subscribe(listener)
		console.open('edit')
		expect(console.snapshot.open).toBe(true)
		expect(console.snapshot.mode).toBe('edit')
		console.toggle()
		expect(console.snapshot.open).toBe(false)
		console.toggle()
		expect(console.snapshot).toMatchObject({ open: true, mode: 'run' })
		expect(listener).toHaveBeenCalledTimes(3)
		expect(listener.mock.calls[0]?.[0]).toMatchObject({ open: true, mode: 'edit' })
	})

	it('open resets add state; patch updates it', () => {
		const console = new ConsoleStore()
		console.patch({ selectedEntryId: 'tool:foo', setValue: 'x' })
		expect(console.snapshot.selectedEntryId).toBe('tool:foo')
		console.open('run')
		expect(console.snapshot.selectedEntryId).toBeUndefined()
		expect(console.snapshot.setValue).toBe('')
		console.patch({ booleanValue: 'false' })
		expect(console.snapshot.booleanValue).toBe('false')
		console.resetAddState()
		expect(console.snapshot.booleanValue).toBe('true')
	})

	it('unsubscribe and clearListeners stop notifications', () => {
		const console = new ConsoleStore()
		const listener = vi.fn()
		const stop = console.subscribe(listener)
		stop()
		console.open()
		expect(listener).not.toHaveBeenCalled()
		console.subscribe(listener)
		console.clearListeners()
		console.close()
		expect(listener).not.toHaveBeenCalled()
	})
})

describe('consolePointDescriptor', () => {
	it('returns a console run-point descriptor with overridable label/icon', () => {
		expect(consolePointDescriptor()).toMatchObject({
			id: 'console',
			type: 'action',
			label: 'Console',
		})
		expect(consolePointDescriptor({ label: 'Term', icon: '$' })).toMatchObject({
			label: 'Term',
			icon: '$',
		})
	})
})
