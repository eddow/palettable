<script setup lang="ts">
/**
 * `@palettable/vue` — border track (`.toolbar-track`).
 *
 * Same DOM contract as the vanilla `renderBorder` track loop: a
 * `.toolbar-track` (`data-track-index`) with
 * `.toolbar-track-space.toolbar-drop-zone` gaps (`data-track-space-index`,
 * flex-sized from `actualTrackSpaceAt`) interleaved around one
 * `.toolbar-track-slot` (`data-toolbar-slot-index`) per slot, each
 * holding a `ToolbarBar`. Keyed `v-for` over the live track array.
 */
import { computed } from 'vue'
import { actualTrackSpaceAt, configuration, type Toolbar, type Track } from '@palettable/core'
import ToolbarBar from './ToolbarBar.vue'
import type { HeadContext } from '../head.js'
import type { ToolbarItem } from '@palettable/core'

const props = defineProps<{
	track: Track
	trackIndex: number
	editing: boolean
	contextFor: (toolbar: Toolbar, item: ToolbarItem, itemIndex: number) => HeadContext
	inspectedItem: ToolbarItem | undefined
}>()

const emit = defineEmits<{
	inspect: [item: ToolbarItem]
	guardPointerdown: [event: PointerEvent, toolbar: Toolbar, item: ToolbarItem]
	barPointerdown: [event: PointerEvent, toolbar: Toolbar]
	barPointermove: [event: PointerEvent, toolbar: Toolbar]
}>()

const gapStyle = computed(() => (index: number) => {
	const space = actualTrackSpaceAt(props.track, index)
	return {
		flexBasis: `${space * 100}%`,
		flexGrow: `${Math.max(space, configuration.trackGapMinGrow)}`,
	}
})

function gapCount(): number {
	return props.track.length + 1
}
</script>

<template>
	<div class="toolbar-track" :data-track-index="String(trackIndex)">
		<template v-for="gap in gapCount()" :key="`tgap-${gap - 1}`">
			<div
				class="toolbar-track-space toolbar-drop-zone"
				:data-track-space-index="String(gap - 1)"
				:style="gapStyle(gap - 1)"
			></div>
			<div
				v-if="gap - 1 < track.length"
				:key="`tslot-${gap - 1}`"
				class="toolbar-track-slot"
				:data-toolbar-slot-index="String(gap - 1)"
			>
				<ToolbarBar
					:toolbar="track[gap - 1]!.toolbar"
					container-kind="border"
					:editing="editing"
					:context-for="(item, itemIndex) => contextFor(track[gap - 1]!.toolbar, item, itemIndex)"
					:inspected-item="inspectedItem"
					@inspect="(item) => emit('inspect', item)"
					@guard-pointerdown="(event, toolbar, item) => emit('guardPointerdown', event, toolbar, item)"
					@bar-pointerdown="(event, toolbar) => emit('barPointerdown', event, toolbar)"
					@bar-pointermove="(event, toolbar) => emit('barPointermove', event, toolbar)"
				/>
			</div>
		</template>
	</div>
</template>
