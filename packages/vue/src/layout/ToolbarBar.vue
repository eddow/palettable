<script setup lang="ts">
/**
 * `@palettable/vue` — toolbar bar (`.toolbar`).
 *
 * Same DOM contract as the vanilla `renderToolbarElement`: a `.toolbar`
 * bar (`data-container`, `data-editing` in edit mode) with
 * `.toolbar-item-space.toolbar-drop-zone` gaps (`data-item-space-index`)
 * interleaved around one `ToolbarItemNode` per tool. Keyed `v-for` over
 * the live toolbar array replaces the vanilla `NodeRegistry` — identity
 * is positional (`data-item-index`), never trusted across renders.
 *
 * Drag wiring (pointerdown on the bar background = whole-toolbar slide;
 * pointermove = item-gap hover through the session) arrives via the
 * `drag` slot prop from the IDE shell, which owns the session.
 */
import type { Toolbar, ToolbarItem } from '@palettable/core'
import ToolbarItemNode from './ToolbarItemNode.vue'
import type { HeadContext } from '../head.js'

defineProps<{
	toolbar: Toolbar
	containerKind: 'border' | 'parking'
	editing: boolean
	contextFor: (item: ToolbarItem, itemIndex: number) => HeadContext
	inspectedItem: ToolbarItem | undefined
}>()

const emit = defineEmits<{
	inspect: [item: ToolbarItem]
	guardPointerdown: [event: PointerEvent, toolbar: Toolbar, item: ToolbarItem]
	barPointerdown: [event: PointerEvent, toolbar: Toolbar]
	barPointermove: [event: PointerEvent, toolbar: Toolbar]
}>()

function gapCount(toolbar: Toolbar): number {
	return toolbar.length + 1
}
</script>

<template>
	<div
		class="toolbar"
		:data-container="containerKind"
		:data-editing="editing ? 'true' : undefined"
		@pointerdown="(event) => emit('barPointerdown', event, toolbar)"
		@pointermove="(event) => emit('barPointermove', event, toolbar)"
	>
		<template v-for="gap in gapCount(toolbar)" :key="`gap-${gap - 1}`">
			<div
				class="toolbar-item-space toolbar-drop-zone"
				:data-item-space-index="String(gap - 1)"
			></div>
			<ToolbarItemNode
				v-if="gap - 1 < toolbar.length"
				:key="`item-${gap - 1}`"
				:item="toolbar[gap - 1]!"
				:item-index="gap - 1"
				:context="contextFor(toolbar[gap - 1]!, gap - 1)"
				:editing="editing"
				:inspected="inspectedItem === toolbar[gap - 1]"
				@inspect="(item) => emit('inspect', item)"
				@guard-pointerdown="(event, item) => emit('guardPointerdown', event, toolbar, item)"
			/>
		</template>
	</div>
</template>
