/**
 * `@palettable/vanilla` — static HTML templates.
 *
 * Locks the template contract: every shell parses to the exact classes /
 * datasets / roles / testids the e2e suite asserts, and every interpolated
 * string is escaped (no `innerHTML` injection).
 */
import { describe, expect, it } from 'vitest'
import {
	commandBoxShellTemplate,
	commandEmptyTemplate,
	commandResultRowTemplate,
	drawerPopupShellTemplate,
	drawerTriggerShellTemplate,
	el,
	elementFromHtml,
	escapeHtml,
	iconSpan,
	sel,
	splitStatusTime,
	statusShellTemplate,
} from './templates.js'

describe('escapeHtml', () => {
	it('escapes text and attribute metacharacters', () => {
		expect(escapeHtml(`<a href="x">&'y'</a>`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;'
		)
	})
})

describe('sel', () => {
	it('returns root plus queried sub-elements in order', () => {
		const [box, input, results] = sel(
			commandBoxShellTemplate({ hint: 'Search', icon: '⌘' }),
			'.palette-default-command-input',
			'.palette-default-command-results'
		)
		expect(box?.dataset.testid).toBe('command-box-combobox')
		expect(input?.className).toContain('palette-default-command-input')
		expect(results?.dataset.testid).toBe('command-box-results')
	})

	it('el + iconSpan build the shared primitives', () => {
		expect(el('div', 'toolbar-item-content').className).toBe('toolbar-item-content')
		expect(iconSpan(undefined)).toBeNull()
		expect(iconSpan('⌘')?.textContent).toBe('⌘')
	})
})

describe('command shells', () => {
	it('result rows escape label/meta/icon and honor disabled', () => {
		const row = elementFromHtml(
			commandResultRowTemplate({ label: '<Life>', meta: 'a&b', icon: '"i"', disabled: true })
		)
		expect(row.className).toContain('palette-default-command-result')
		expect((row as HTMLButtonElement).disabled).toBe(true)
		expect(row.querySelector('.palette-default-command-result-label')?.textContent).toBe(
			'"i"<Life>'
		)
		expect(row.querySelector('.palette-default-command-result-meta')?.textContent).toBe('a&b')
		expect(row.innerHTML).not.toContain('<Life>')
	})

	it('empty shell carries escaped text', () => {
		expect(elementFromHtml(commandEmptyTemplate('Nope')).textContent).toBe('Nope')
	})
})

describe('drawer + command-box shells', () => {
	it('drawer trigger is icon-only: label is tooltip + accessible name, never text', () => {
		const trigger = elementFromHtml(
			drawerTriggerShellTemplate({
				label: 'More',
				hint: 'More tools',
				tone: 'neutral',
				icon: '▤',
				axis: 'vertical',
				region: 'left',
			})
		)
		expect(trigger.getAttribute('aria-label')).toBe('More')
		expect(trigger.getAttribute('title')).toBe('More')
		expect(trigger.textContent).not.toContain('More')
		expect(
			trigger.querySelector('.palette-default-drawer-chevron')?.getAttribute('aria-hidden')
		).toBe('true')
		expect(trigger.classList.contains('palette-default-layout-vertical')).toBe(true)
		expect(trigger.classList.contains('palette-default-region-left')).toBe(true)
	})

	it('drawer popup shell is a hidden dialog popup (hierarchical, no overlay)', () => {
		const popup = elementFromHtml(drawerPopupShellTemplate('horizontal'))
		expect(popup.classList.contains('palettable-drawer__popup')).toBe(true)
		expect(popup.classList.contains('is-horizontal')).toBe(true)
		expect(popup.getAttribute('role')).toBe('dialog')
		expect(popup.hasAttribute('hidden')).toBe(true)
		expect(popup.style.getPropertyValue('--layout')).toBe('horizontal')
		expect(popup.style.getPropertyValue('--region')).toBe('')
	})

	it('command-box shell carries combobox testids', () => {
		const box = elementFromHtml(commandBoxShellTemplate({ hint: 'Search', icon: '⌘' }))
		expect(box.dataset.testid).toBe('command-box-combobox')
		expect(box.querySelector('[data-testid="command-box-input"]')).not.toBeNull()
		expect(box.querySelector('[data-testid="command-box-results"]')).not.toBeNull()
		expect(box.querySelector('[data-testid="command-box-open-editor"]')).not.toBeNull()
	})
})

describe('status shells', () => {
	it('horizontal shell carries a single value node', () => {
		const span = elementFromHtml(
			statusShellTemplate({ tone: 'neutral', direction: 'horizontal', region: 'top' })
		)
		expect(span.classList.contains('palette-default-layout-horizontal')).toBe(true)
		expect(span.classList.contains('palette-default-region-top')).toBe(true)
		expect(span.querySelector('.palette-default-status-value')).not.toBe(null)
		expect(span.querySelector('.palette-default-status-minutes')).toBe(null)
	})

	it('vertical shell stacks minutes above seconds with a hidden fallback', () => {
		const span = elementFromHtml(
			statusShellTemplate({ tone: 'neutral', direction: 'vertical', region: 'left' })
		)
		expect(span.classList.contains('palette-default-layout-vertical')).toBe(true)
		expect(span.classList.contains('palette-default-region-left')).toBe(true)
		expect(span.querySelector('.palette-default-status-minutes')).not.toBe(null)
		expect(span.querySelector('.palette-default-status-seconds')).not.toBe(null)
		expect(span.querySelector('.palette-default-status-value')?.hasAttribute('hidden')).toBe(true)
	})

	it('splitStatusTime splits strict mm:ss only', () => {
		expect(splitStatusTime('04:37')).toEqual(['04', '37'])
		expect(splitStatusTime('4:37')).toEqual(['4', '37'])
		expect(splitStatusTime('ready')).toBe(undefined)
		expect(splitStatusTime('12:345')).toBe(undefined)
		expect(splitStatusTime('ab:cd')).toBe(undefined)
	})
})
