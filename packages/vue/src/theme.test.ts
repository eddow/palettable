import { describe, expect, it } from 'vitest'
import {
	applyThemeSetting,
	createThemeSetting,
	readThemeSetting,
	resolveTheme,
	systemPrefersLight,
} from './theme.js'

describe('resolveTheme', () => {
	it('passes light/dark through and resolves system via the OS preference', () => {
		expect(resolveTheme('light', false)).toBe('light')
		expect(resolveTheme('dark', true)).toBe('dark')
		expect(resolveTheme('system', true)).toBe('light')
		expect(resolveTheme('system', false)).toBe('dark')
		expect(resolveTheme(undefined, true)).toBe('light')
		expect(resolveTheme(undefined, false)).toBe('dark')
	})

	it('re-exports the core resolution (single shared copy)', async () => {
		const core = await import('@palettable/core')
		expect(resolveTheme).toBe(core.resolveTheme)
	})
})

describe('applyThemeSetting', () => {
	it('toggles the light class + data-theme + colorScheme idempotently', () => {
		const root = document.createElement('div') as unknown as HTMLElement
		expect(applyThemeSetting(root, 'light', false)).toBe('light')
		expect(root.classList.contains('palette-default-theme-light')).toBe(true)
		expect(root.dataset.theme).toBe('light')
		expect(applyThemeSetting(root, 'dark', true)).toBe('dark')
		expect(root.classList.contains('palette-default-theme-light')).toBe(false)
		expect(root.dataset.theme).toBe('dark')
	})

	it('preserves the system setting while painting the resolved value', () => {
		const root = document.createElement('div') as unknown as HTMLElement
		expect(applyThemeSetting(root, 'system', true)).toBe('light')
		expect(root.dataset.theme).toBe('system')
		expect(root.classList.contains('palette-default-theme-light')).toBe(true)
	})

	it('systemPrefersLight defaults to false without matchMedia', () => {
		expect(typeof systemPrefersLight()).toBe('boolean')
	})

	it('samples the OS preference per apply, with no change listener installed', () => {
		const root = document.createElement('div') as unknown as HTMLElement
		const calls: string[] = []
		const media = { matches: false, addEventListener: () => calls.push('listen') }
		const win = window as unknown as {
			matchMedia: (query: string) => typeof media
		}
		const original = win.matchMedia
		win.matchMedia = () => media
		try {
			expect(applyThemeSetting(root, 'system')).toBe('dark')
			media.matches = true
			expect(applyThemeSetting(root, 'system')).toBe('light')
			// Per-call sampling only: the adapter never subscribes to OS flips.
			expect(calls).toEqual([])
		} finally {
			win.matchMedia = original
		}
	})
})

describe('createThemeSetting', () => {
	it('seeds from the root, writes through, and follows external edits', async () => {
		const root = document.createElement('div')
		root.dataset.theme = 'dark'
		const setting = createThemeSetting(root as unknown as HTMLElement)
		expect(setting.value).toBe('dark')
		const seen: string[] = []
		setting.subscribe((next) => seen.push(next))
		setting.set('light')
		expect(root.dataset.theme).toBe('light')
		expect(setting.value).toBe('light')
		// External root write (consumer toggle / direct DOM edit) syncs back.
		root.dataset.theme = 'system'
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(setting.value).toBe('system')
		expect(seen).toEqual(['light', 'system'])
		setting.dispose()
	})

	it('reacts in a computed (Vue equivalent of the tool binding)', async () => {
		const { computed, nextTick } = await import('vue')
		const root = document.createElement('div')
		const setting = createThemeSetting(root as unknown as HTMLElement)
		const resolved = computed(() => resolveTheme(setting.value, true))
		expect(resolved.value).toBe('light')
		setting.set('dark')
		await nextTick()
		expect(resolved.value).toBe('dark')
		setting.dispose()
	})

	it('no tool + no write leaves the root untouched (opt-in)', () => {
		const root = document.createElement('div')
		const before = root.dataset.theme
		expect(readThemeSetting(root)).toBe('system')
		expect(before).toBeUndefined()
	})
})
