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
import { computed, inject } from 'vue'
import type { Border, PaletteRegion, Toolbar, ToolbarItem, Track } from '@palettable/core'
import BorderTrack from './BorderTrack.vue'
import type { HeadContext } from '../head.js'
import type { IdeStrings } from '../strings.js'
import { trackKeyOf } from './identity-key.js'
import { layoutRevisionKey } from './revision-key.js'

const revision = inject(layoutRevisionKey, undefined)

const props = defineProps<{
	border: Border
	region: PaletteRegion
	editing: boolean
	strings: IdeStrings
	contextFor: (toolbar: Toolbar, item: ToolbarItem, itemIndex: number) => HeadContext
	themeEnabled?: boolean
	inspectedItem: ToolbarItem | undefined
}>()

const emit = defineEmits<{
	inspect: [item: ToolbarItem]
	guardPointerdown: [event: PointerEvent]
	barPointerdown: [event: PointerEvent, toolbar: Toolbar, region: PaletteRegion]
	barPointermove: [event: PointerEvent, toolbar: Toolbar]
	barPointerover: [event: PointerEvent, toolbar: Toolbar]
	borderPointermove: [event: PointerEvent, border: Border]
	borderPointerleave: [event: PointerEvent]
	trackPointermove: [event: PointerEvent, track: Track, trackIndex: number]
	trackPointerleave: [event: PointerEvent, track: Track, trackIndex: number]
}>()

const direction = computed(() =>
	props.region === 'left' || props.region === 'right' ? 'vertical' : 'horizontal'
)
const inverse = computed(() => props.region === 'right' || props.region === 'bottom')

/** Live track indices in render order (reversed for right/bottom). */
const orderedIndices = computed(() => {
	// Track the shell revision: the live border array mutates in place
	// (same reference across commits), so without this the computed
	// never re-evaluates and new tracks never render.
	revision?.value
	const indices = props.border.map((_, index) => index)
	return inverse.value ? indices.reverse() : indices
})

function stackGapCount(): number {
	revision?.value
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
				:key="trackKeyOf(border[orderedIndices[position - 1]!], orderedIndices[position - 1])"
				:track="border[orderedIndices[position - 1]!]!"
				:track-index="orderedIndices[position - 1]!"
				:editing="editing"
				:context-for="contextFor"
				:theme-enabled="themeEnabled"
				:inspected-item="inspectedItem"
				@inspect="(item) => emit('inspect', item)"
				@guard-pointerdown="(event) => emit('guardPointerdown', event)"
				@bar-pointerdown="(event, toolbar) => emit('barPointerdown', event, toolbar, region)"
				@bar-pointermove="(event, toolbar) => emit('barPointermove', event, toolbar)"
				@bar-pointerover="(event, toolbar) => emit('barPointerover', event, toolbar)"
				@track-pointermove="(event, track) => emit('trackPointermove', event, track, orderedIndices[position - 1]!)"
				@track-pointerleave="(event, track) => emit('trackPointerleave', event, track, orderedIndices[position - 1]!)"
			/>
		</template>
	</div>
</template>
