<script setup lang="ts">
/**
 * `@palettable/vue` — IDE shell (`.palette-ide`).
 *
 * Vue-idiom mirror of the vanilla `createIDE` structural contract: a
 * `.palette-ide` root (`.editing` + `data-editing` in edit mode,
 * `data-palette-id`) holding top / middle (left + center + right) /
 * bottom hosts, each rendering a `BorderStack` from the live layout.
 * The center holds the `work-zone` slot (consumer content) plus the
 * console overlay slot.
 *
 * Reactivity: a `layoutRevision` counter bumped by layout-op + value +
 * context + console subscriptions re-reads `core.layout.getLayout()`
 * (live object — never cached across renders). Per-tool value sync is
 * reactive by construction (presenters recompute on revision bump);
 * no per-tool subscription map is needed. Drag sessions commit through
 * `core.layout` moves; highlight arrives as session `DragEvent`s applied
 * as class toggles via refs.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import {
	type Border,
	type ConsoleStore,
	type PaletteCore,
	type PaletteRegion,
	type Toolbar,
	type ToolbarItem,
	type Track,
} from '@palettable/core'
import BorderStack from './BorderStack.vue'
import { createVueKeys, isEditableTarget } from '../keys.js'
import { surfaceForRegion, type HeadContext } from '../head.js'
import { syncIdeCatalogStrings, useIdeDisplay, useIdeStrings, type IdeOptions } from '../ide.js'

const props = defineProps<IdeOptions>()

const strings = useIdeStrings(props)
const display = useIdeDisplay(props)
const paletteId = computed(() => props.paletteId ?? 'demo')

/** Structural revision: bumped by every store/layout/console event. */
const layoutRevision = ref(0)
const bump = () => {
	layoutRevision.value += 1
}

const live = computed(() => {
	void layoutRevision.value
	return props.core.layout.getLayout()
})

const editing = computed(() => {
	void layoutRevision.value
	const canEdit = props.isEditable()
	if (!canEdit) return false
	const snapshot = props.consoleStore.snapshot
	if (hasCommandBoxTool()) return snapshot.open
	return snapshot.open && snapshot.mode === 'edit'
})

function hasCommandBoxTool(): boolean {
	const layout = props.core.layout.getLayout()
	const regions: PaletteRegion[] = ['top', 'right', 'bottom', 'left']
	for (const region of regions) {
		for (const track of layout.borders[region]) {
			for (const slot of track) {
				if (
					slot.toolbar.some((item) => (item as { control?: unknown }).control === 'commandBox')
				) {
					return true
				}
			}
		}
	}
	return false
}

const inspected = ref<ToolbarItem | undefined>(undefined)

function contextFor(
	region: PaletteRegion,
	toolbar: Toolbar,
	item: ToolbarItem,
	_itemIndex: number
): HeadContext {
	return {
		core: props.core,
		item,
		surface: surfaceForRegion(region),
		region,
		strings: props.strings,
		display: display.value,
		iconResolver: props.iconResolver,
		onOpenConsole: (mode) => props.consoleStore.open(mode),
		onInspect: () => {
			inspected.value = item
		},
	}
}

function onInspect(item: ToolbarItem): void {
	inspected.value = item
}

function onGuardPointerdown(_event: PointerEvent, _toolbar: Toolbar, item: ToolbarItem): void {
	inspected.value = item
}

function onBarPointerdown(event: PointerEvent, toolbar: Toolbar, region: PaletteRegion): void {
	void event
	void toolbar
	void region
}

function onBarPointermove(event: PointerEvent, _toolbar: Toolbar): void {
	void event
}

function onBorderPointermove(event: PointerEvent, _border: Border): void {
	void event
}

function onBorderPointerleave(event: PointerEvent): void {
	void event
}

function onTrackPointermove(event: PointerEvent, _track: Track, _trackIndex: number): void {
	void event
}

function onKeyDown(event: KeyboardEvent): void {
	if (event.defaultPrevented) return
	if (isEditableTarget(event.target)) return
	if (event.key === 'Escape') {
		if (props.consoleStore.snapshot.open) {
			event.preventDefault()
			props.consoleStore.close()
		}
		return
	}
	if (editing.value) return
	const keys = createVueKeys(props.core.keys)
	const runnable = keys.resolve(event)
	if (!runnable) return
	try {
		if (runnable.kind === 'inc' || runnable.kind === 'dec') {
			let can = true
			try {
				can = props.core.can(runnable)
			} catch {
				return
			}
			if (!can) return
		}
		event.preventDefault()
		event.stopPropagation()
		props.core.run(runnable)
	} catch {
		// Unresolvable bindings never break typing.
	}
}

window.addEventListener('keydown', onKeyDown)

const opsUnsub = props.core.subscribeLayoutOps(() => bump())
const consoleUnsub: () => void = (props.consoleStore as ConsoleStore).subscribe(() => bump())
let localeUnsub: (() => void) | undefined
try {
	localeUnsub = props.core.values.subscribe(props.localePointId ?? 'locale', () => {
		syncIdeCatalogStrings(props)
		bump()
	})
} catch {
	localeUnsub = undefined
}
const contextUnsub = props.core.subscribeContext((_bagName, changed) => {
	// Key changes update tools in place (reactive recompute covers it);
	// identity changes re-resolve every tool reading the bag.
	if (changed.length === 0) bump()
	else bump()
})

syncIdeCatalogStrings(props)

onBeforeUnmount(() => {
	opsUnsub()
	consoleUnsub()
	localeUnsub?.()
	contextUnsub()
	window.removeEventListener('keydown', onKeyDown)
})

defineExpose({ bump, inspected })
</script>

<template>
	<div
		class="palette-ide"
		:class="{ editing }"
		:data-palette-id="paletteId"
		:data-editing="editing ? 'true' : undefined"
	>
		<BorderStack
			:border="live.borders.top"
			region="top"
			:editing="editing"
			:strings="strings"
			:context-for="(toolbar, item, itemIndex) => contextFor('top', toolbar, item, itemIndex)"
			:inspected-item="inspected"
			@inspect="onInspect"
			@guard-pointerdown="onGuardPointerdown"
			@bar-pointerdown="onBarPointerdown"
			@bar-pointermove="onBarPointermove"
			@border-pointermove="onBorderPointermove"
			@border-pointerleave="onBorderPointerleave"
			@track-pointermove="onTrackPointermove"
		/>
		<div class="palette-ide-middle">
			<BorderStack
				:border="live.borders.left"
				region="left"
				:editing="editing"
				:strings="strings"
				:context-for="(toolbar, item, itemIndex) => contextFor('left', toolbar, item, itemIndex)"
				:inspected-item="inspected"
				@inspect="onInspect"
				@guard-pointerdown="onGuardPointerdown"
				@bar-pointerdown="onBarPointerdown"
				@bar-pointermove="onBarPointermove"
				@border-pointermove="onBorderPointermove"
				@border-pointerleave="onBorderPointerleave"
				@track-pointermove="onTrackPointermove"
			/>
			<div class="palette-ide-center">
				<slot name="work-zone" />
				<slot name="console" />
			</div>
			<BorderStack
				:border="live.borders.right"
				region="right"
				:editing="editing"
				:strings="strings"
				:context-for="(toolbar, item, itemIndex) => contextFor('right', toolbar, item, itemIndex)"
				:inspected-item="inspected"
				@inspect="onInspect"
				@guard-pointerdown="onGuardPointerdown"
				@bar-pointerdown="onBarPointerdown"
				@bar-pointermove="onBarPointermove"
				@border-pointermove="onBorderPointermove"
				@border-pointerleave="onBorderPointerleave"
				@track-pointermove="onTrackPointermove"
			/>
		</div>
		<BorderStack
			:border="live.borders.bottom"
			region="bottom"
			:editing="editing"
			:strings="strings"
			:context-for="(toolbar, item, itemIndex) => contextFor('bottom', toolbar, item, itemIndex)"
			:inspected-item="inspected"
			@inspect="onInspect"
			@guard-pointerdown="onGuardPointerdown"
			@bar-pointerdown="onBarPointerdown"
			@bar-pointermove="onBarPointermove"
			@border-pointermove="onBorderPointermove"
			@border-pointerleave="onBorderPointerleave"
			@track-pointermove="onTrackPointermove"
		/>
	</div>
</template>
