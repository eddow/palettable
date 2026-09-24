/**
 * `@palettable/vue` demo stub — verifies the IDE shell mounts.
 *
 * Minimal client wiring over `@palettable/demo-core` (same factories the
 * vanilla demo uses): two points, one toolbar per border region, values
 * hydrated via live `setMany`. The full Stellar Outpost demo port
 * (console, drag, configurator, ships, locales) is a follow-up slice —
 * this stub exists to prove the shell renders four borders + work-zone
 * with the vanilla DOM contract.
 */
import { ConsoleStore, PaletteCore } from '@palettable/core'
import { createApp, h } from 'vue'
import PaletteIde from '../src/layout/PaletteIde.vue'
import '../../core/styles/palette.css'
import '../../core/styles/head-default.css'
import '../../core/styles/head-dark.css'
import '../../core/styles/head-light.css'

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
core.setMany({ dark: true })

const consoleStore = new ConsoleStore()

createApp({
	render: () =>
		h(PaletteIde, {
			core,
			consoleStore,
			isEditable: () => false,
		}),
}).mount('#app')
