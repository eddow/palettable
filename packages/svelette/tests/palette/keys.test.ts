import { describe, expect, it } from 'vitest'
import {
	createPaletteKeys,
	isPaletteKeys,
	normalizePaletteKeystroke,
	paletteKeystrokeFromEvent,
} from '$lib/palette/keys'
import { Palette } from '$lib/palette/palette.svelte'

describe('palette keys', () => {
	it('normalizes modifier aliases and ordering', () => {
		expect(normalizePaletteKeystroke('cmd + shift + a')).toBe('Shift+Meta+A')
		expect(normalizePaletteKeystroke('option+ctrl+escape')).toBe('Ctrl+Alt+Esc')
		expect(normalizePaletteKeystroke(' space ')).toBe('Space')
		expect(normalizePaletteKeystroke('alt+meta+ctrl+k')).toBe('Ctrl+Alt+Meta+K')
		expect(normalizePaletteKeystroke('`')).toBe('`')
	})

	it('derives normalized keystrokes from keyboard events', () => {
		const event = new KeyboardEvent('keydown', {
			key: ' ',
			ctrlKey: true,
			altKey: true,
			bubbles: true,
		})

		expect(paletteKeystrokeFromEvent(event)).toBe('Ctrl+Alt+Space')
	})

	it('resolves normalized bindings and finds multiple shortcuts for a tool', () => {
		const keys = createPaletteKeys({
			'cmd+shift+a': 'inspect',
			'ctrl+n': 'inspect',
			space: 'toggle',
		})

		expect(keys.findByTool('inspect')).toEqual(['Shift+Meta+A', 'Ctrl+N'])
		expect(
			keys.resolve(
				new KeyboardEvent('keydown', { key: 'a', shiftKey: true, metaKey: true, bubbles: true })
			)
		).toBe('inspect')
		expect(keys.resolve(new KeyboardEvent('keydown', { key: 'Space', bubbles: true }))).toBe(
			'toggle'
		)
		expect(keys.resolve(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))).toBe('toggle')
	})

	it('returns undefined when no binding matches', () => {
		const keys = createPaletteKeys({
			N: 'open',
		})

		expect(keys.resolve(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))).toBeUndefined()
	})

	it('resolves grave accent (backtick) bindings', () => {
		const keys = createPaletteKeys({
			'`': 'openConsole',
		})

		expect(keys.findByTool('openConsole')).toEqual(['`'])
		expect(keys.resolve(new KeyboardEvent('keydown', { key: '`', bubbles: true }))).toBe(
			'openConsole'
		)
	})

	it('normalizes and resolves escape aliases consistently', () => {
		const keys = createPaletteKeys({
			escape: 'close',
		})

		expect(normalizePaletteKeystroke('Esc')).toBe('Esc')
		expect(keys.findByTool('close')).toEqual(['Esc'])
		expect(keys.resolve(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))).toBe(
			'close'
		)
	})

	it('accepts a raw bindings map in Palette config and normalizes it', () => {
		const palette = new Palette({
			tools: {
				reset: {
					label: 'Reset',
					get can() {
						return true
					},
					run() {},
				},
			},
			keys: { 'cmd+shift+a': 'reset' },
		})
		expect(isPaletteKeys(palette.keys)).toBe(true)
		expect(palette.keys.findByTool('reset')).toEqual(['Shift+Meta+A'])
		expect(
			palette.keys.resolve(
				new KeyboardEvent('keydown', { key: 'a', shiftKey: true, metaKey: true, bubbles: true })
			)
		).toBe('reset')
	})

	it('keeps a prebuilt PaletteKeys registry as-is', () => {
		const registry = createPaletteKeys({ N: 'reset' })
		const palette = new Palette({
			tools: {
				reset: {
					label: 'Reset',
					get can() {
						return true
					},
					run() {},
				},
			},
			keys: registry,
		})
		expect(palette.keys).toBe(registry)
	})
})
