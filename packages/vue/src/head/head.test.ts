import { PaletteCore, ValuesBag } from '@palettable/core'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { surfaceForRegion } from '../head.js'
import ButtonTool from './ButtonTool.vue'
import StatusTool from './StatusTool.vue'
import ThemeTool from './ThemeTool.vue'
import ToggleTool from './ToggleTool.vue'

function actionCore() {
	return new PaletteCore([
		{ id: 'save', type: 'action', label: 'Save', run: () => {} },
		{ id: 'dark', type: 'boolean', label: 'Dark' },
	])
}

describe('ButtonTool', () => {
	it('renders label + icon with the vanilla classes and runs on click', () => {
		const core = actionCore()
		const ran: unknown[] = []
		const run = core.run.bind(core)
		core.run = ((spec: never) => {
			ran.push(spec)
			return run(spec)
		}) as typeof core.run
		const Host = defineComponent({
			render: () =>
				h(ButtonTool, {
					context: {
						core,
						item: { point: 'save', control: 'button', config: { icon: '💾' } },
						surface: surfaceForRegion('top'),
					},
				}),
		})
		const wrapper = mount(Host)
		const button = wrapper.get('button.palette-default-tool.palette-default-tone-neutral')
		expect(button.text()).toContain('Save')
		expect(button.text()).toContain('💾')
		expect(button.attributes('disabled')).toBe(undefined)
		button.trigger('click')
		expect(ran).toEqual([{ kind: 'action', point: 'save' }])
	})

	it('renders disabled when can is false', () => {
		const core = new PaletteCore([
			{
				id: 'save',
				type: 'action',
				label: 'Save',
				run: () => {},
				uses: ['mode'],
				can: (bag) => bag?.get('armed' as never) === true,
			},
		])
		const bag = new ValuesBag({ armed: false })
		core.setContext('mode', bag)
		const Host = defineComponent({
			render: () =>
				h(ButtonTool, {
					context: {
						core,
						item: { point: 'save', control: 'button' },
						surface: surfaceForRegion('top'),
					},
				}),
		})
		const wrapper = mount(Host)
		expect(wrapper.get('button').attributes('disabled')).toBeDefined()
	})
})

describe('ToggleTool', () => {
	it('renders pressed state and toggles via core', () => {
		const core = actionCore()
		core.setMany({ dark: true })
		const Host = defineComponent({
			render: () =>
				h(ToggleTool, {
					context: {
						core,
						item: { point: 'dark', control: 'toggle' },
						surface: surfaceForRegion('left'),
					},
				}),
		})
		const wrapper = mount(Host)
		const button = wrapper.get('button')
		expect(button.attributes('aria-pressed')).toBe('true')
		expect(button.classes()).toContain('is-selected')
		button.trigger('click')
		expect(core.values.get('dark')).toBe(false)
	})

	it('renders skeleton as aria-pressed mixed', () => {
		const core = actionCore()
		const Host = defineComponent({
			render: () =>
				h(ToggleTool, {
					context: {
						core,
						item: { point: 'dark', control: 'toggle' },
						surface: surfaceForRegion('left'),
					},
				}),
		})
		const wrapper = mount(Host)
		expect(wrapper.get('button').attributes('aria-pressed')).toBe('mixed')
	})
})

describe('StatusTool', () => {
	it('renders the bag value with the vanilla classes', () => {
		const core = new PaletteCore([{ id: 'clock', type: 'nothing', label: 'Clock', uses: ['ship'] }])
		core.setContext('ship', new ValuesBag({ missionTime: '12:34' }))
		const Host = defineComponent({
			render: () =>
				h(StatusTool, {
					context: {
						core,
						item: { point: 'clock', control: 'status' },
						surface: surfaceForRegion('top'),
					},
				}),
		})
		const wrapper = mount(Host)
		expect(wrapper.get('.palette-default-status').text()).toContain('12:34')
		expect(wrapper.get('.palette-default-status').attributes('aria-disabled')).toBe(undefined)
	})

	it('renders disabled + label when the context bag is absent', () => {
		const core = new PaletteCore([{ id: 'clock', type: 'nothing', label: 'Clock', uses: ['ship'] }])
		const Host = defineComponent({
			render: () =>
				h(StatusTool, {
					context: {
						core,
						item: { point: 'clock', control: 'status' },
						surface: surfaceForRegion('top'),
					},
				}),
		})
		const wrapper = mount(Host)
		expect(wrapper.get('.palette-default-status').attributes('aria-disabled')).toBe('true')
		expect(wrapper.get('.palette-default-status').text()).toContain('Clock')
	})
})

describe('ThemeTool', () => {
	it('renders the theme-tool testid and applies the setting to the root', () => {
		const core = new PaletteCore([
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
		])
		document.documentElement.dataset.theme = 'dark'
		const Host = defineComponent({
			render: () =>
				h(ThemeTool, {
					context: {
						core,
						item: { point: 'theme', control: 'theme' },
						surface: surfaceForRegion('top'),
					},
				}),
		})
		const wrapper = mount(Host)
		const button = wrapper.get('[data-testid="theme-tool"]')
		expect(button.text()).toContain('🌙')
		expect(document.documentElement.dataset.theme).toBe('dark')
		button.trigger('click')
		expect(document.documentElement.dataset.theme).toBe('system')
		delete document.documentElement.dataset.theme
	})
})
