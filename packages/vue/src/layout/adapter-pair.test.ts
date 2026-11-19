/**
 * `@palettable/vue` — adapter-pair parity harness (publication §2.a).
 *
 * Drives the same five workflows through both mounted adapters (vanilla
 * `createIDE` + Vue `PaletteIde`) and asserts equivalent state and
 * serialized layouts after each step.
 */

import type { ToolbarItem } from '@palettable/core'
import {
	actionableEntries,
	addableEntries,
	ConsoleStore,
	itemFromAddSelection,
	PaletteCore,
	paletteDerivedVariants,
} from '@palettable/core'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createIDE } from '../../../vanilla/src/ide.js'
import PaletteIde from './PaletteIde.vue'

const hosts: HTMLElement[] = []
afterEach(() => {
	for (const host of hosts.splice(0)) host.remove()
})

function points() {
	return [
		{ id: 'lamp', label: 'Lamp', type: 'boolean' },
		{
			id: 'speed',
			label: 'Speed',
			type: 'number',
			constraints: { min: 0, max: 10, step: 1 },
		},
		{ id: 'save', label: 'Save', type: 'action', run: () => {} },
		{ id: 'extra', label: 'Extra', type: 'boolean' },
	] as never[]
}

function initialLayout() {
	return {
		version: 1,
		borders: {
			top: [
				[
					{
						space: 1,
						toolbar: [
							{ point: 'lamp', control: 'toggle' },
							{ point: 'save', control: 'button' },
						],
					},
				],
				[{ space: 1, toolbar: [{ point: 'speed', control: 'slider' }] }],
			],
			right: [],
			bottom: [],
			left: [],
		},
	} as never
}

type Harness = {
	core: PaletteCore
	consoleStore: ConsoleStore
	host: HTMLElement
	dispose: () => void
}

function mountVanilla(): Harness {
	const core = new PaletteCore(points(), {
		initialValues: { lamp: false, speed: 1, extra: false } as never,
		initialLayout: initialLayout(),
	})
	const consoleStore = new ConsoleStore()
	const host = document.createElement('div')
	document.body.append(host)
	hosts.push(host)
	const ide = createIDE(host, { core, consoleStore, isEditable: () => true })
	return { core, consoleStore, host, dispose: () => ide.dispose() }
}

function mountVue(): Harness & { wrapper: ReturnType<typeof mount> } {
	const core = new PaletteCore(points(), {
		initialValues: { lamp: false, speed: 1, extra: false } as never,
		initialLayout: initialLayout(),
	})
	const consoleStore = new ConsoleStore()
	const Host = defineComponent({
		render: () =>
			h(
				PaletteIde,
				{ core, consoleStore, isEditable: () => true },
				{ 'work-zone': () => h('div', 'work') }
			),
	})
	const wrapper = mount(Host, { attachTo: document.body })
	const host = wrapper.element as HTMLElement
	if (host.parentElement) hosts.push(host.parentElement as HTMLElement)
	return { core, consoleStore, host, wrapper, dispose: () => wrapper.unmount() }
}

/** Equivalent state + serialized-layout comparison between the two cores. */
function expectParity(vanilla: Harness, vue: Harness) {
	expect(vue.core.values.asObject()).toEqual(vanilla.core.values.asObject())
	const vanillaBytes = JSON.stringify(vanilla.core.layout.getSnapshot())
	const vueBytes = JSON.stringify(vue.core.layout.getSnapshot())
	expect(vueBytes).toBe(vanillaBytes)
}

/** Add-flow selection for the `extra` boolean point (shared builders). */
function addSelectionFor(core: PaletteCore) {
	const sources = addableEntries(core.points, {})
	const source = sources.find((entry) => entry.pointId === 'extra')
	expect(source).toBeDefined()
	const variant = paletteDerivedVariants(source!, core.points)[0]
	expect(variant).toBeDefined()
	return { source: source!, variant: variant! }
}

describe('adapter-pair layout parity (vanilla vs vue)', () => {
	it('matches across add / run / value / save-restore / cross-track drag', async () => {
		const vanilla = mountVanilla()
		const vue = mountVue()
		await nextTick()
		try {
			// Baseline: same points + same initial layout → same bytes.
			expectParity(vanilla, vue)

			// 1. Adding a tool: shared `itemFromAddSelection` conversion,
			// committed through a catalog creation session (the same object
			// shape the console add flow builds).
			for (const harness of [vanilla, vue]) {
				const { source, variant } = addSelectionFor(harness.core)
				const item = itemFromAddSelection({ source, variant }, harness.core.points)
				expect(item).toBeDefined()
				const live = harness.core.layout.getLayout()
				const before = live.borders.top.length
				const session = harness.core.layout.createDrag({
					kind: 'catalog',
					item: item as ToolbarItem,
				})
				session.over(
					{ kind: 'track-gap', track: live.borders.top[0]!, gap: 1 },
					{ clientX: 0, clientY: 0 }
				)
				session.end()
				expect(harness.core.layout.getLayout().borders.top.length).toBe(before)
			}
			await nextTick()
			for (const harness of [vanilla, vue]) {
				const live = harness.core.layout.getLayout()
				const flat = live.borders.top.flatMap((track) => track.flatMap((slot) => slot.toolbar))
				expect(flat.some((item) => (item as { point?: unknown }).point === 'extra')).toBe(true)
			}
			expectParity(vanilla, vue)

			// 2. Running a command: the `save` action button exists in the
			// initial layout on both adapters. Click it through the DOM and
			// assert each adapter routed to `core.run` with the same runnable.
			for (const harness of [vanilla, vue]) {
				const actionable = actionableEntries(harness.core.points, {})
				const saveEntry = actionable.find(
					(entry) => entry.run.kind === 'action' && entry.run.point === 'save'
				)
				expect(saveEntry).toBeDefined()
				const seen: unknown[] = []
				const run = harness.core.run.bind(harness.core)
				harness.core.run = ((spec: never) => {
					seen.push(spec)
					return run(spec)
				}) as typeof harness.core.run
				try {
					const saveButton = [...harness.host.querySelectorAll('button')].find((button) =>
						button.textContent?.includes('Save')
					) as HTMLButtonElement | undefined
					expect(saveButton).toBeDefined()
					saveButton!.click()
					await nextTick()
				} finally {
					harness.core.run = run
				}
				expect(seen).toEqual([saveEntry!.run])
			}
			expectParity(vanilla, vue)

			// 3. Updating a value: toggle `lamp` through each adapter DOM.
			for (const harness of [vanilla, vue]) {
				const toggle = harness.host.querySelector(
					'.toolbar-item[data-point="lamp"] .toolbar-item-content button'
				) as HTMLButtonElement | null
				expect(toggle).not.toBe(null)
				toggle!.click()
				await nextTick()
			}
			expect(vanilla.core.values.get('lamp' as never)).toBe(true)
			expect(vue.core.values.get('lamp' as never)).toBe(true)
			expectParity(vanilla, vue)

			// 4. Saving/restoring: snapshot bytes round-trip through fresh
			// cores and reload onto both adapters.
			const vanillaBytes = JSON.stringify(vanilla.core.layout.getSnapshot())
			expect(JSON.stringify(vue.core.layout.getSnapshot())).toBe(vanillaBytes)
			const parsed: unknown = JSON.parse(vanillaBytes)
			for (const harness of [vanilla, vue]) {
				harness.core.layout.setLayout(structuredClone(parsed) as never)
			}
			await nextTick()
			expectParity(vanilla, vue)
			{
				const freshVanilla = new PaletteCore(points(), {
					initialLayout: JSON.parse(vanillaBytes) as never,
				})
				const freshVue = new PaletteCore(points(), {
					initialLayout: JSON.parse(vanillaBytes) as never,
				})
				expect(JSON.stringify(freshVue.layout.getSnapshot())).toBe(
					JSON.stringify(freshVanilla.layout.getSnapshot())
				)
			}

			// 5. Cross-track drag: `speed` moves track 1 → track 0 through a
			// real session `over()` (the op shape adapters apply live).
			for (const harness of [vanilla, vue]) {
				const live = harness.core.layout.getLayout()
				const from = live.borders.top[1]?.[0]?.toolbar
				const item = from?.[0]
				if (!from || !item) throw new Error('expected dragged tool')
				const session = harness.core.layout.createDrag({ kind: 'tool', toolbar: from, item })
				const target = live.borders.top[0]?.[0]?.toolbar
				if (!target) throw new Error('expected drop target')
				session.over({ kind: 'item-gap', toolbar: target, gap: 0 }, { clientX: 0, clientY: 0 })
				session.end()
			}
			await nextTick()
			for (const harness of [vanilla, vue]) {
				const live = harness.core.layout.getLayout()
				const head = live.borders.top[0]?.[0]?.toolbar ?? []
				expect(head.some((item) => (item as { point?: unknown }).point === 'speed')).toBe(true)
			}
			expectParity(vanilla, vue)
		} finally {
			vanilla.dispose()
			vue.dispose()
		}
	})
})
