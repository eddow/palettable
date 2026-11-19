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
import { computed, inject, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { actualTrackSpaceAt, configuration, type Toolbar, type Track } from '@palettable/core'
import ToolbarBar from './ToolbarBar.vue'
import type { HeadContext } from '../head.js'
import type { ToolbarItem } from '@palettable/core'
import { barRegistryKey } from './bar-registry.js'
import { layoutRevisionKey } from './revision-key.js'
import { toolbarKeyOf } from './identity-key.js'

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
	barPointerover: [event: PointerEvent, toolbar: Toolbar]
	trackPointermove: [event: PointerEvent, track: Track]
	trackPointerleave: [event: PointerEvent, track: Track]
}>()

function onTrackPointermove(event: PointerEvent): void {
	emit('trackPointermove', event, props.track)
}

function onTrackPointerleave(event: PointerEvent): void {
	emit('trackPointerleave', event, props.track)
}

const gapStyle = computed(() => (index: number) => {
	revision?.value
	const space = actualTrackSpaceAt(props.track, index)
	return {
		flexBasis: `${space * 100}%`,
		flexGrow: `${Math.max(space, configuration.trackGapMinGrow)}`,
	}
})

const registry = inject(barRegistryKey, undefined)
const revision = inject(layoutRevisionKey, undefined)
const trackRef = useTemplateRef<HTMLElement>('track')

function registerTrack(): void {
	if (registry && trackRef.value) registry.setTrack(props.track, trackRef.value)
}

onMounted(registerTrack)

watch(() => props.track, registerTrack)

// Same fresh-element reason as `ToolbarBar`: the shell re-renders this
// track with the same identity but a new element after every commit.
// Deferred to `nextTick` (the watcher fires before the swap).
watch(revision ?? (() => 0), () => {
	nextTick(registerTrack)
})

onBeforeUnmount(() => {
	registry?.deleteTrack(props.track)
})

function gapCount(): number {
	revision?.value
	return (props.track?.length ?? 0) + 1
}
</script>

<template>
	<div
		ref="track"
		class="toolbar-track"
		:data-track-index="String(trackIndex)"
		@pointermove="onTrackPointermove"
		@pointerleave="onTrackPointerleave"
	>
		<template v-for="gap in gapCount()" :key="`tgap-${gap - 1}`">
			<div
				class="toolbar-track-space toolbar-drop-zone"
				:data-track-space-index="String(gap - 1)"
				:style="gapStyle(gap - 1)"
			></div>
			<div
				v-if="track !== undefined && gap - 1 < track.length"
				:key="toolbarKeyOf(track[gap - 1]!.toolbar)"
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
					@bar-pointerover="(event, toolbar) => emit('barPointerover', event, toolbar)"
				/>
			</div>
		</template>
	</div>
</template>
