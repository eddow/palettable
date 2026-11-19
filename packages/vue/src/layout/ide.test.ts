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

	it('theme opt-in: omitted hides the tool, true renders it', async () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					type: 'nothing',
					label: 'Theme',
					options: [
						{ value: 'light', icon: '☀️' },
						{ value: 'dark', icon: '🌙' },
						{ value: 'system', icon: '💻' },
					],
				},
				{ id: 'more', type: 'nothing', label: 'More', controls: ['drawer'] },
			],
			{
				initialLayout: {
					version: 1,
					borders: {
						top: [
							[
								{
									space: 1,
									toolbar: [
										{
											point: 'more',
											control: 'drawer',
											toolbar: [{ space: 1, toolbar: [{ point: 'theme', control: 'theme' }] }],
										},
									],
								},
							],
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		delete document.documentElement.dataset.theme
		const Hidden = defineComponent({
			render: () =>
				h(
					PaletteIde,
					{ core, consoleStore, isEditable: () => false },
					{ 'work-zone': () => h('div', 'work') }
				),
		})
		const hidden = mount(Hidden, { attachTo: document.body })
		expect(hidden.find('[data-testid="theme-tool"]').exists()).toBe(false)
		expect(document.documentElement.dataset.theme).toBeUndefined()
		// Explicit itemControls cannot restore the theme point either.
		hidden.unmount()
		const Explicit = defineComponent({
			render: () =>
				h(
					PaletteIde,
					{
						core,
						consoleStore,
						isEditable: () => false,
						itemControls: ['commandBox', 'drawer', 'status', 'theme'],
					},
					{ 'work-zone': () => h('div', 'work') }
				),
		})
		const explicit = mount(Explicit, { attachTo: document.body })
		expect(explicit.find('[data-testid="theme-tool"]').exists()).toBe(false)
		explicit.unmount()
		const Shown = defineComponent({
			render: () =>
				h(
					PaletteIde,
					{ core, consoleStore, isEditable: () => false, theme: true },
					{ 'work-zone': () => h('div', 'work') }
				),
		})
		const shown = mount(Shown, { attachTo: document.body })
		expect(shown.find('[data-testid="theme-tool"]').exists()).toBe(true)
		shown.unmount()
		delete document.documentElement.dataset.theme
	})

	it('theme opt-in: omitted hides a nested drawer theme tool and its root write', async () => {
		const core = new PaletteCore(
			[
				{
					id: 'theme',
					type: 'nothing',
					label: 'Theme',
					options: [
						{ value: 'light', icon: '☀️' },
						{ value: 'dark', icon: '🌙' },
						{ value: 'system', icon: '💻' },
					],
				},
				{ id: 'more', type: 'nothing', label: 'More', controls: ['drawer'] },
			],
			{
				initialLayout: {
					version: 1,
					borders: {
						top: [
							[
								{
									space: 1,
									toolbar: [
										{
											point: 'more',
											control: 'drawer',
											toolbar: [{ space: 1, toolbar: [{ point: 'theme', control: 'theme' }] }],
										},
									],
								},
							],
						],
						right: [],
						bottom: [],
						left: [],
					},
				},
			}
		)
		const consoleStore = new ConsoleStore()
		delete document.documentElement.dataset.theme
		const Host = defineComponent({
			render: () =>
				h(
					PaletteIde,
					{ core, consoleStore, isEditable: () => false },
					{ 'work-zone': () => h('div', 'work') }
				),
		})
		const wrapper = mount(Host, { attachTo: document.body })
		await wrapper.find('.palettable-drawer__trigger').trigger('click')
		// Nested drawer opens, but the theme tool inside stays hidden and the
		// root keeps whatever the consumer stored (no automatic write).
		expect(wrapper.find('.palettable-drawer__popup').exists()).toBe(true)
		expect(wrapper.find('[data-testid="theme-tool"]').exists()).toBe(false)
		expect(document.documentElement.dataset.theme).toBeUndefined()
		wrapper.unmount()
		delete document.documentElement.dataset.theme
	})
})
