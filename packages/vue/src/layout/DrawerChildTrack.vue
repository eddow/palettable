<script setup lang="ts">
/**
 * `@palettable/vue` — drawer child track (`.toolbar-track[data-drawer-track]`).
 *
 * Vue-idiom mirror of the vanilla `renderDrawerTrack`: one track of bare
 * toolbars stacked along the child axis (no track gaps, no stack gaps —
 * the popup holds bare toolbars whose item-spaces are live DZs during a
 * drag). Tagged `data-drawer-track` so border-scoped queries stay on the
 * real border toolbars. Child bars render with the popup's own
 * axis/region so edit handles follow the child axis.
 *
 * Drag: item-gap hovers route through the injected IDE drag API (same
 * `session.over` path as borders); hierarchy close is owned by the
 * drawer components.
 */
import { inject } from 'vue'
import type { PaletteRegion, Toolbar, ToolbarItem, Track } from '@palettable/core'
import ToolbarBar from './ToolbarBar.vue'
import type { HeadContext } from '../head.js'
import { ideDragApiKey } from './ide-drag-api.js'

const props = defineProps<{
	track: Track
	axis: 'horizontal' | 'vertical'
	region: PaletteRegion
	editing: boolean
	contextFor: (toolbar: Toolbar, item: ToolbarItem, itemIndex: number) => HeadContext
	inspectedItem: ToolbarItem | undefined
}>()

const dragApi = inject(ideDragApiKey, undefined)

const emit = defineEmits<{
	drawerPointermove: [event: PointerEvent]
	drawerPointerover: [event: PointerEvent]
}>()

function onGuardPointerdown(event: PointerEvent, toolbar: Toolbar, item: ToolbarItem): void {
	dragApi?.guardPointerdown(event, toolbar, item)
}

function onBarPointerdown(event: PointerEvent, toolbar: Toolbar): void {
	dragApi?.barPointerdown(event, toolbar, props.region)
}

function onBarPointermove(event: PointerEvent, toolbar: Toolbar): void {
	dragApi?.barPointermove(event, toolbar)
	emit('drawerPointermove', event)
}

function onBarPointerover(event: PointerEvent, toolbar: Toolbar): void {
	dragApi?.barPointerover(event, toolbar)
	emit('drawerPointerover', event)
}
</script>

<template>
	<div
		class="toolbar-track"
		data-drawer-track="true"
		:style="{ flexDirection: axis === 'vertical' ? 'column' : 'row', alignItems: axis === 'vertical' ? 'stretch' : 'center' }"
	>
		<div
			v-for="(slot, slotIndex) in track"
			:key="`dslot-${slotIndex}`"
			class="toolbar-track-slot"
			:data-toolbar-slot-index="String(slotIndex)"
		>
			<ToolbarBar
				:toolbar="slot.toolbar"
				container-kind="border"
				:editing="editing"
				:context-for="(item, itemIndex) => contextFor(slot.toolbar, item, itemIndex)"
				:inspected-item="inspectedItem"
				@inspect="(item) => dragApi?.inspect(item)"
				@guard-pointerdown="onGuardPointerdown"
				@bar-pointerdown="onBarPointerdown"
				@bar-pointermove="onBarPointermove"
				@bar-pointerover="onBarPointerover"
			/>
		</div>
	</div>
</template>
