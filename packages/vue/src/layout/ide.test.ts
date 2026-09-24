import { ConsoleStore, PaletteCore } from '@palettable/core'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import PaletteIde from './PaletteIde.vue'

function stubIde() {
	const core = new PaletteCore(
		[
			{ id: 'save', type: 'action', label: 'Save', run: () => {} },
			{ id: 'dark', type: 'boolean', label: 'Dark' },
		],
		{
			initialLayout: {
				version: 1,
				borders: {
					top: [[{ space: 1, toolbar: [{ point: 'save', control: 'button' }] }]],
					right: [[{ space: 1, toolbar: [{ point: 'dark', control: 'toggle' }] }]],
					bottom: [],
					left: [],
				},
			},
		}
	)
	const consoleStore = new ConsoleStore()
	const Host = defineComponent({
		render: () =>
			h(
				PaletteIde,
				{ core, consoleStore, isEditable: () => false },
				{ 'work-zone': () => h('div', { 'data-testid': 'work-zone' }, 'work') }
			),
	})
	return { core, consoleStore, Host }
}

describe('PaletteIde', () => {
	it('renders four borders with the vanilla DOM contract', () => {
		const { Host } = stubIde()
		const wrapper = mount(Host, { attachTo: document.body })
		expect(wrapper.find('.palette-ide').exists()).toBe(true)
		for (const region of ['top', 'right', 'bottom', 'left']) {
			expect(
				wrapper.find(`.toolbar-border[data-region="${region}"]`).exists(),
				`border ${region}`
			).toBe(true)
		}
		// Tools render with vanilla classes.
		expect(wrapper.find('.palette-default-tool').exists()).toBe(true)
		expect(wrapper.find('[data-testid="work-zone"]').exists()).toBe(true)
		wrapper.unmount()
	})

	it('re-renders on layout ops without losing the shell', () => {
		const { core, Host } = stubIde()
		const wrapper = mount(Host, { attachTo: document.body })
		const before = wrapper.findAll('.toolbar-border').length
		expect(before).toBe(4)
		core.layout.moveItem(
			{ container: 'border', region: 'top', trackIndex: 0, toolbarIndex: 0, itemIndex: 0 },
			{ container: 'border', region: 'top', trackIndex: 0, toolbarIndex: 0, itemIndex: 0 }
		)
		expect(wrapper.findAll('.toolbar-border').length).toBe(4)
		expect(
			wrapper.find('.toolbar-border[data-region="top"]').find('.palette-default-tool').exists()
		).toBe(true)
		wrapper.unmount()
	})
})
