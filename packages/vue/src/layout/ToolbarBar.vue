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
import { computed, inject, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import type { Toolbar, ToolbarItem } from '@palettable/core'
import ToolbarItemNode from './ToolbarItemNode.vue'
import type { HeadContext } from '../head.js'
import { barRegistryKey } from './bar-registry.js'
import { layoutRevisionKey } from './revision-key.js'
import { itemKeyOf } from './identity-key.js'

const props = defineProps<{
	toolbar: Toolbar
	containerKind: 'border' | 'parking'
	editing: boolean
	contextFor: (item: ToolbarItem, itemIndex: number) => HeadContext
	themeEnabled?: boolean
	inspectedItem: ToolbarItem | undefined
}>()

const registry = inject(barRegistryKey, undefined)
const revision = inject(layoutRevisionKey, undefined)
const barRef = useTemplateRef<HTMLElement>('bar')

function register(): void {
	if (registry && barRef.value) registry.setToolbar(props.toolbar, barRef.value)
}

onMounted(register)

watch(() => props.toolbar, register)

// Re-register after every structural commit: the shell's `layoutRevision`
// bump re-renders this bar with the same toolbar identity but a fresh
// element, and the registry still points at the detached node. Without
// this, `toolbarOfBar` misses the fresh bar and the hover falls through
// to the track-gap path (whole-toolbar zone paints track gaps instead of
// neighbour TB edges). Deferred to `nextTick`: the watcher fires before
// Vue swaps the element, so registering synchronously would capture the
// old (about-to-detach) node.
watch(revision ?? (() => 0), () => {
	nextTick(register)
})

onBeforeUnmount(() => {
	registry?.deleteToolbar(props.toolbar)
})

const emit = defineEmits<{
	inspect: [item: ToolbarItem]
	guardPointerdown: [event: PointerEvent]
	barPointerdown: [event: PointerEvent, toolbar: Toolbar]
	barPointermove: [event: PointerEvent, toolbar: Toolbar]
	barPointerover: [event: PointerEvent, toolbar: Toolbar]
}>()

function gapCount(toolbar: Toolbar): number {
	return (toolbar?.length ?? 0) + 1
}

/** Item count (tracked for reactivity — the live toolbar array mutates
 * in place, so `toolbar.length` alone never notifies). */
const itemCount = computed(() => {
	revision?.value
	return props.toolbar?.length ?? 0
})

/** Identity-stable key: one id per live item object (unique across duplicates). */
function itemKey(item: ToolbarItem): string {
	return itemKeyOf(item)
}

/**
 * Whether `item` is the inspected tool. Identity first (live layout
 * objects are stable across renders); structural fingerprint fallback
 * (point + control + config) covers a stale inspected reference after
 * a structural commit replaced the toolbar array.
 */
function isInspected(item: ToolbarItem): boolean {
	if (props.inspectedItem === undefined) return false
	if (props.inspectedItem === item) return true
	return fingerprint(props.inspectedItem) === fingerprint(item)
}

function fingerprint(item: ToolbarItem): string {
	const record = item as { point?: unknown; control?: unknown; config?: unknown }
	try {
		return JSON.stringify([record.point, record.control, record.config])
	} catch {
		return ''
	}
}
</script>

<template>
	<div
		ref="bar"
		class="toolbar"
		:data-container="containerKind"
		:data-editing="editing ? 'true' : undefined"
		@pointerdown="(event) => emit('barPointerdown', event, toolbar)"
		@pointermove="(event) => emit('barPointermove', event, toolbar)"
		@pointerover="(event) => emit('barPointerover', event, toolbar)"
	>
		<template v-for="gap in itemCount + 1" :key="`gap-${gap - 1}`">
			<div
				class="toolbar-item-space toolbar-drop-zone"
				:data-item-space-index="String(gap - 1)"
			></div>
			<ToolbarItemNode
				v-if="gap - 1 < toolbar.length"
				:key="itemKey(toolbar[gap - 1]!)"
				:item="toolbar[gap - 1]!"
				:item-index="gap - 1"
				:context="contextFor(toolbar[gap - 1]!, gap - 1)"
				:editing="editing"
				:theme-enabled="themeEnabled"
				:inspected="isInspected(toolbar[gap - 1]!)"
				@inspect="(item) => emit('inspect', item)"
				@guard-pointerdown="(event) => emit('guardPointerdown', event)"
			/>
		</template>
	</div>
</template>
