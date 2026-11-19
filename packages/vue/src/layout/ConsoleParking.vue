<script setup lang="ts">
/**
 * `@palettable/vue` — console parking stack (`.palette-parking`).
 *
 * Vue-idiom mirror of the vanilla `renderParking`: a `.palette-parking`
 * stack (`data-container="parking"`) with
 * `.toolbar-stack-space.toolbar-drop-zone` gaps
 * (`data-parking-gap-index`) interleaved around one
 * `.palette-parking-row` (`data-parking-row-index`) per visible row.
 * CommandBox-only toolbars are filtered out. Editing rows get a
 * `.palette-parking-remove` delete button (`moveToolbar(..., undefined)`).
 * Same DOM contract the e2e suite asserts.
 */
import { computed, inject, useTemplateRef } from 'vue'
import type { DisplayStrings, PaletteCore, Toolbar, ToolbarItem } from '@palettable/core'
import ToolbarBar from './ToolbarBar.vue'
import { surfaceForRegion, type HeadContext } from '../head.js'
import type { IdeStrings } from '../strings.js'
import { ideDragApiKey } from './ide-drag-api.js'
import { layoutRevisionKey } from './revision-key.js'
import { toolbarKeyOf } from './identity-key.js'

const props = defineProps<{
	core: PaletteCore
	editing: boolean
	strings: IdeStrings
	iconResolver?: (token: string) => string | undefined
	display?: DisplayStrings
}>()

const emit = defineEmits<{
	inspect: [item: ToolbarItem]
	guardPointerdown: [event: PointerEvent, toolbar: Toolbar, item: ToolbarItem]
	barPointerdown: [event: PointerEvent, toolbar: Toolbar]
	barPointermove: [event: PointerEvent, toolbar: Toolbar]
}>()
void emit

const dragApi = inject(ideDragApiKey, undefined)
const revision = inject(layoutRevisionKey, undefined)
const stackRef = useTemplateRef<HTMLElement>('stack')

const parking = computed(() => {
	// Reactive on parent `layoutRevision` (re-read live each render).
	// The live parking array mutates in place (same reference across
	// commits), so track the shell revision explicitly — otherwise the
	// computed never re-evaluates and new rows never render.
	revision?.value
	return props.core.layout.getLayout().parking
})

const visible = computed(() => {
	// Track the shell revision (same in-place-mutation reason as
	// `parking` above): a dwell commit splices a row into the live
	// parking array without changing its reference, so without this the
	// new row never renders.
	revision?.value
	return parking.value
		.map((toolbar, index) => ({ toolbar, index }))
		.filter(({ toolbar }) =>
			toolbar.some((item) => (item as { control?: unknown }).control !== 'commandBox')
		)
})

function gapCount(): number {
	// Track the shell revision: `visible` is cached on the same live
	// array reference, so the template's `gapCount()` call must depend
	// on the revision explicitly or the new trailing gap never renders.
	revision?.value
	return visible.value.length + 1
}

function contextFor(toolbar: Toolbar, item: ToolbarItem): HeadContext {
	return {
		core: props.core,
		item,
		surface: surfaceForRegion('top'),
		region: 'top',
		strings: props.strings,
		display: props.display,
		iconResolver: props.iconResolver,
		onOpenConsole: undefined,
		onInspect: undefined,
		isEditing: () => props.editing,
		isDragging: () => dragApi?.dragActive() === true,
		onOpenDrawer: (drawerItem) => dragApi?.trackDrawerOpen(drawerItem),
		onCloseDrawer: (drawerItem) => dragApi?.trackDrawerClose(drawerItem),
		closeUnrelatedDrawers: (target) => dragApi?.closeUnrelatedDrawers(target),
	}
}

function onRemove(index: number, event: MouseEvent): void {
	event.stopPropagation()
	props.core.layout.moveToolbar({ container: 'parking', toolbarIndex: index }, undefined)
}

function onStackPointermove(event: PointerEvent): void {
	dragApi?.parkingPointermove(event)
}

function onStackPointerleave(event: PointerEvent): void {
	dragApi?.parkingPointerleave(event)
}

function onPanelPointermove(event: PointerEvent): void {
	dragApi?.panelPointermove(event)
}

function onPanelPointerleave(event: PointerEvent): void {
	dragApi?.panelPointerleave(event)
}
</script>

<template>
	<div
		ref="stack"
		class="palette-parking palette-default-command-parking"
		data-container="parking"
		style="--layout: horizontal; --region: top;"
		@pointermove="onStackPointermove"
		@pointerleave="onStackPointerleave"
	>
		<template v-for="position in gapCount()" :key="`pgap-${position - 1}`">
			<div
				class="toolbar-stack-space toolbar-drop-zone"
				:data-parking-gap-index="String(position - 1)"
				:data-stack-index="String(position - 1)"
				:data-empty-text="strings.emptyDropZone"
			></div>
			<div
				v-if="position - 1 < visible.length"
				:key="`prow-${toolbarKeyOf(visible[position - 1]!.toolbar)}`"
				class="palette-parking-row"
				:data-parking-row-index="String(visible[position - 1]!.index)"
			>
				<button
					v-if="editing"
					type="button"
					class="palette-parking-remove"
					:aria-label="strings.deleteToolbar"
					:title="strings.deleteToolbar"
					@click="(event) => onRemove(visible[position - 1]!.index, event)"
				><span class="palette-parking-remove-icon" aria-hidden="true">🗑</span></button>
				<ToolbarBar
					:toolbar="visible[position - 1]!.toolbar"
					container-kind="parking"
					:editing="editing"
					:context-for="(item) => contextFor(visible[position - 1]!.toolbar, item)"
					:inspected-item="undefined"
					@inspect="(item) => dragApi?.inspect(item)"
					@guard-pointerdown="(event, toolbar, item) => dragApi?.guardPointerdown(event, toolbar, item)"
					@bar-pointerdown="(event, toolbar) => dragApi?.barPointerdown(event, toolbar, 'top')"
					@bar-pointermove="(event, toolbar) => dragApi?.barPointermove(event, toolbar)"
					@bar-pointerover="(event, toolbar) => dragApi?.barPointerover(event, toolbar)"
				/>
			</div>
		</template>
	</div>
</template>
