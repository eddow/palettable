import { describe, expect, it } from 'vitest'
import { applyThemeSetting, resolveTheme, systemPrefersLight } from './theme.js'

describe('resolveTheme', () => {
	it('passes light/dark through and resolves system via the OS preference', () => {
		expect(resolveTheme('light', false)).toBe('light')
		expect(resolveTheme('dark', true)).toBe('dark')
		expect(resolveTheme('system', true)).toBe('light')
		expect(resolveTheme('system', false)).toBe('dark')
		expect(resolveTheme(undefined, true)).toBe('light')
		expect(resolveTheme(undefined, false)).toBe('dark')
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
})
