/**
 * `@palettable/vanilla` — static HTML templates (plans/html.md probe).
 *
 * Locks the template contract: every shell parses to the exact classes /
 * datasets / roles / testids the e2e suite asserts, and every interpolated
 * string is escaped (no `innerHTML` injection).
 */
import { describe, expect, it } from 'vitest'
import {
	addInlineValueShellTemplate,
	addInsertTemplate,
	addPanelShellTemplate,
	addVariantShellTemplate,
	borderShellTemplate,
	commandBoxShellTemplate,
	commandEmptyTemplate,
	commandResultRowTemplate,
	configEmptyTemplate,
	configRowShellTemplate,
	consoleOverlayShellTemplate,
	detailsPanelShellTemplate,
	detailsTitleTemplate,
	drawerPopupShellTemplate,
	drawerTriggerShellTemplate,
	elementFromHtml,
	elementsFromHtml,
	escapeHtml,
	ideSkeletonTemplate,
	itemSpaceTemplate,
	parkingGapTemplate,
	parkingRemoveTemplate,
	parkingRowTemplate,
	parkingStackTemplate,
	stackSpaceTemplate,
	toolbarItemGuardTemplate,
	toolbarItemShellTemplate,
	toolbarShellTemplate,
	trackShellTemplate,
	trackSlotShellTemplate,
	trackSpaceTemplate,
} from './templates.js'

describe('escapeHtml', () => {
	it('escapes text and attribute metacharacters', () => {
		expect(escapeHtml(`<a href="x">&'y'</a>`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;'
		)
	})
})

describe('ide skeleton', () => {
	it('parses to layout-transparent hosts + middle/center with console host last', () => {
		const nodes = elementsFromHtml(ideSkeletonTemplate())
		expect(nodes.map((node) => node.className)).toEqual(['', 'palette-ide-middle', '', ''])
		// Border hosts are `display: contents` so borders are direct flex
		// participants (track gaps distribute); the trailing console host
		// stays a real block (it is moved inside the center by the caller).
		expect([nodes[0]!, nodes[2]!].map((node) => node.style.display)).toEqual([
			'contents',
			'contents',
		])
		expect(nodes[3]!.style.display).toBe('')
		const middle = nodes[1]!
		expect(middle.children[1]?.className).toBe('palette-ide-center')
		expect((middle.children[0] as HTMLElement).style.display).toBe('contents')
		expect((middle.children[2] as HTMLElement).style.display).toBe('contents')
	})
})

describe('layout shells', () => {
	it('border shell carries direction classes + region + editing', () => {
		const horizontal = elementFromHtml(
			borderShellTemplate({
				paletteId: 'demo',
				region: 'top',
				direction: 'horizontal',
				editing: true,
			})
		)
		expect(horizontal.className).toContain('toolbar-border')
		expect(horizontal.className).toContain('palette-horizontal')
		expect(horizontal.dataset.region).toBe('top')
		expect(horizontal.dataset.editing).toBe('true')
		const vertical = elementFromHtml(
			borderShellTemplate({
				paletteId: 'demo',
				region: 'left',
				direction: 'vertical',
				editing: false,
			})
		)
		expect(vertical.className).toContain('palette-vertical')
		expect(vertical.dataset.editing).toBeUndefined()
	})

	it('toolbar item shell nests content + guard with datasets', () => {
		const wrapper = elementFromHtml(
			toolbarItemShellTemplate({
				itemIndex: 2,
				tool: 'lamp',
				editor: 'toggle',
				inspected: true,
				editing: true,
			})
		)
		expect(wrapper.className).toBe('toolbar-item')
		expect(wrapper.dataset.itemIndex).toBe('2')
		expect(wrapper.dataset.tool).toBe('lamp')
		expect(wrapper.dataset.editor).toBe('toggle')
		expect(wrapper.dataset.inspected).toBe('true')
		expect(wrapper.querySelector(':scope > .toolbar-item-content')).not.toBeNull()
		expect(wrapper.querySelector(':scope > .toolbar-item-guard')).not.toBeNull()
	})

	it('gap shells carry drop-zone classes + indices', () => {
		expect(elementFromHtml(stackSpaceTemplate(1, 'demo')).dataset.stackIndex).toBe('1')
		expect(elementFromHtml(trackSpaceTemplate(2, 'demo')).dataset.trackSpaceIndex).toBe('2')
		expect(elementFromHtml(itemSpaceTemplate(3, 'demo')).dataset.itemSpaceIndex).toBe('3')
		expect(elementFromHtml(trackShellTemplate(0, 'demo')).dataset.trackIndex).toBe('0')
		expect(elementFromHtml(trackSlotShellTemplate(1)).dataset.toolbarSlotIndex).toBe('1')
		expect(
			elementFromHtml(
				toolbarShellTemplate({ paletteId: 'demo', container: 'parking', editing: false })
			).dataset.container
		).toBe('parking')
		expect(elementFromHtml(toolbarItemGuardTemplate('demo')).getAttribute('aria-hidden')).toBe(
			'true'
		)
	})
})

describe('parking shells', () => {
	it('stack + row + gap + remove carry e2e datasets', () => {
		const stack = elementFromHtml(parkingStackTemplate('demo'))
		expect(stack.dataset.container).toBe('parking')
		expect(elementFromHtml(parkingRowTemplate(2)).dataset.parkingRowIndex).toBe('2')
		expect(elementFromHtml(parkingGapTemplate(1, 'demo')).dataset.parkingGapIndex).toBe('1')
		const remove = elementFromHtml(parkingRemoveTemplate())
		expect(remove.getAttribute('aria-label')).toBe('Delete toolbar')
	})
})

describe('console overlay shell', () => {
	it('carries overlay/input/results testids + placeholder + query', () => {
		const overlay = elementFromHtml(
			consoleOverlayShellTemplate({
				placeholder: 'Add to toolbar…',
				query: 'li',
				canToggle: true,
				isEditing: true,
			})
		)
		expect(overlay.dataset.testid).toBe('console-overlay')
		expect(overlay.getAttribute('role')).toBe('dialog')
		const input = overlay.querySelector('.palette-default-command-input')
		expect(input?.getAttribute('placeholder')).toBe('Add to toolbar…')
		expect((input as HTMLInputElement).value).toBe('li')
		expect(overlay.querySelector('[data-testid="console-results"]')).not.toBeNull()
		expect(overlay.querySelector('[data-testid="console-mode-toggle"]')).not.toBeNull()
	})

	it('omits the mode toggle when edit-only', () => {
		const overlay = elementFromHtml(
			consoleOverlayShellTemplate({
				placeholder: 'Add to toolbar…',
				query: '',
				canToggle: false,
				isEditing: true,
			})
		)
		expect(overlay.querySelector('[data-testid="console-mode-toggle"]')).toBeNull()
	})

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

	it('details + config + add shells carry testids', () => {
		expect(elementFromHtml(detailsPanelShellTemplate()).dataset.testid).toBe(
			'console-details-panel'
		)
		expect(elementFromHtml(detailsTitleTemplate('Inspect')).textContent).toBe('Inspect')
		expect(elementFromHtml(commandEmptyTemplate('Nope')).textContent).toBe('Nope')
		expect(elementFromHtml(configEmptyTemplate('Empty')).textContent).toBe('Empty')
		const row = elementFromHtml(configRowShellTemplate('Label'))
		expect(row.querySelector('.palette-default-config-value')).not.toBeNull()
		const panel = elementFromHtml(addPanelShellTemplate({ label: 'Life', meta: 'm' }))
		expect(panel.dataset.testid).toBe('console-add-panel')
		const variant = elementFromHtml(
			addVariantShellTemplate({ label: 'V', meta: 'm', icon: 'i', isSet: true, selected: true })
		)
		expect(variant.querySelector('[aria-pressed="true"]')).not.toBeNull()
		expect(elementFromHtml(addInsertTemplate()).dataset.testid).toBe('console-add-insert')
		expect(elementFromHtml(addInlineValueShellTemplate()).textContent).toContain('Value')
	})
})

describe('drawer + command-box shells', () => {
	it('drawer trigger keeps the accessible name exact, chevron hidden', () => {
		const trigger = elementFromHtml(
			drawerTriggerShellTemplate({ label: 'More', hint: 'More tools', tone: 'neutral', icon: '▤' })
		)
		expect(trigger.getAttribute('aria-label')).toBe('More')
		expect(
			trigger.querySelector('.palette-default-drawer-chevron')?.getAttribute('aria-hidden')
		).toBe('true')
	})

	it('drawer popup shell is overlay + dialog popup', () => {
		const overlay = elementFromHtml(drawerPopupShellTemplate('horizontal'))
		expect(overlay.getAttribute('role')).toBe('presentation')
		const popup = overlay.querySelector('.palettable-drawer__popup')
		expect(popup?.classList.contains('is-horizontal')).toBe(true)
		expect(popup?.getAttribute('role')).toBe('dialog')
	})

	it('command-box shell carries combobox testids', () => {
		const box = elementFromHtml(commandBoxShellTemplate({ hint: 'Search', icon: '⌘' }))
		expect(box.dataset.testid).toBe('command-box-combobox')
		expect(box.querySelector('[data-testid="command-box-input"]')).not.toBeNull()
		expect(box.querySelector('[data-testid="command-box-results"]')).not.toBeNull()
		expect(box.querySelector('[data-testid="command-box-open-editor"]')).not.toBeNull()
	})
})
