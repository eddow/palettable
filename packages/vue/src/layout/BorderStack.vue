<script setup lang="ts">
/**
 * `@palettable/vue` — border stack (`.toolbar-border`).
 *
 * Same DOM contract as the vanilla `renderBorder`: a `.toolbar-border`
 * (`--layout` direction, `--region`, `data-region`) with
 * `.toolbar-stack-space.toolbar-drop-zone` gaps (`data-stack-index`,
 * `data-empty-text`) interleaved around one `BorderTrack` per track.
 * Right/bottom borders render tracks in reverse (visual order), with
 * stack-gap indices mapped back to live indices. Keyed `v-for` over the
 * live border array — structural commits re-render via layout-op
 * subscriptions in the IDE shell, never by position trust.
 */
import { computed } from 'vue'
import type { Border, PaletteRegion, Toolbar, ToolbarItem, Track } from '@palettable/core'
import BorderTrack from './BorderTrack.vue'
import type { HeadContext } from '../head.js'
import type { IdeStrings } from '../strings.js'

const props = defineProps<{
	border: Border
	region: PaletteRegion
	editing: boolean
	strings: IdeStrings
	contextFor: (toolbar: Toolbar, item: ToolbarItem, itemIndex: number) => HeadContext
	inspectedItem: ToolbarItem | undefined
}>()

const emit = defineEmits<{
	inspect: [item: ToolbarItem]
	guardPointerdown: [event: PointerEvent, toolbar: Toolbar, item: ToolbarItem]
	barPointerdown: [event: PointerEvent, toolbar: Toolbar, region: PaletteRegion]
	barPointermove: [event: PointerEvent, toolbar: Toolbar]
	borderPointermove: [event: PointerEvent, border: Border]
	borderPointerleave: [event: PointerEvent]
	trackPointermove: [event: PointerEvent, track: Track, trackIndex: number]
}>()

const direction = computed(() =>
	props.region === 'left' || props.region === 'right' ? 'vertical' : 'horizontal'
)
const inverse = computed(() => props.region === 'right' || props.region === 'bottom')

/** Live track indices in render order (reversed for right/bottom). */
const orderedIndices = computed(() => {
	const indices = props.border.map((_, index) => index)
	return inverse.value ? indices.reverse() : indices
})

function stackGapCount(): number {
	return props.border.length + 1
}

/** Render-order position → live stack-gap index. */
function stackGapAt(position: number): number {
	if (!inverse.value) return position
	return props.border.length - position
}
</script>

<template>
	<div
		class="toolbar-border"
		:style="{ '--layout': direction, '--region': region }"
		:data-region="region"
		@pointermove="(event) => emit('borderPointermove', event, border)"
		@pointerleave="(event) => emit('borderPointerleave', event)"
	>
		<template v-for="position in stackGapCount()" :key="`sgap-${position - 1}`">
			<div
				class="toolbar-stack-space toolbar-drop-zone"
				:data-stack-index="String(stackGapAt(position - 1))"
				:data-empty-text="strings.emptyDropZone"
			></div>
			<BorderTrack
				v-if="position - 1 < border.length"
				:key="`track-${orderedIndices[position - 1]}`"
				:track="border[orderedIndices[position - 1]!]!"
				:track-index="orderedIndices[position - 1]!"
				:editing="editing"
				:context-for="contextFor"
				:inspected-item="inspectedItem"
				@inspect="(item) => emit('inspect', item)"
				@guard-pointerdown="(event, toolbar, item) => emit('guardPointerdown', event, toolbar, item)"
				@bar-pointerdown="(event, toolbar) => emit('barPointerdown', event, toolbar, region)"
				@bar-pointermove="(event, toolbar) => emit('barPointermove', event, toolbar)"
			/>
		</template>
	</div>
</template>
