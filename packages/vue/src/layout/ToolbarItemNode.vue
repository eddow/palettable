<script setup lang="ts">
/**
 * `@palettable/vue` — toolbar item wrapper (`.toolbar-item`).
 *
 * Same DOM contract as the vanilla `renderToolbarElement` item loop: a
 * `.toolbar-item` wrapper (`data-item-index`, `data-point`, `data-control`,
 * `data-inspected` when selected for the configurator) holding a
 * `.toolbar-item-content` (inert in edit mode, except drawer content —
 * an inert ancestor would remove the inline popup from hit-testing) with
 * the head control, plus a `.toolbar-item-guard` in edit mode
 * (`pointerdown` selects for the configurator + starts the tool drag).
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import type { ToolbarItem } from '@palettable/core'
import { canonicalItemPoint } from '@palettable/core'
import HeadItem from '../head/HeadItem.vue'
import type { HeadContext } from '../head.js'
import { barRegistryKey } from './bar-registry.js'
import { layoutRevisionKey } from './revision-key.js'

const props = defineProps<{
	item: ToolbarItem
	itemIndex: number
	context: HeadContext
	editing: boolean
	inspected: boolean
}>()

const emit = defineEmits<{
	inspect: [item: ToolbarItem]
	guardPointerdown: [event: PointerEvent, item: ToolbarItem]
}>()

const pointId = computed(() => {
	try {
		const id = canonicalItemPoint(props.item)
		return id === '' ? undefined : id
	} catch {
		return undefined
	}
})

const controlId = computed(
	() => (props.item as { control?: unknown }).control as string | undefined
)

const isDrawer = computed(() => controlId.value === 'drawer')

const registry = inject(barRegistryKey, undefined)
const revision = inject(layoutRevisionKey, undefined)
const itemRef = useTemplateRef<HTMLElement>('item')

function registerItem(): void {
	if (registry && itemRef.value) registry.setItem(props.item, itemRef.value)
}

onMounted(registerItem)

// Same fresh-element reason as `ToolbarBar`: re-register after every
// structural commit so `elementOfItem` never points at a detached node.
// Deferred to `nextTick` (the watcher fires before the swap).
watch(revision ?? (() => 0), () => {
	nextTick(registerItem)
})

watch(() => props.item, (next, prev) => {
	if (prev !== undefined) registry?.deleteItem(prev)
	registerItem()
})

onBeforeUnmount(() => {
	registry?.deleteItem(props.item)
})

function onGuardPointerdown(event: PointerEvent): void {
	emit('inspect', props.item)
	emit('guardPointerdown', event, props.item)
}
</script>

<template>
	<div
		ref="item"
		class="toolbar-item"
		:data-item-index="String(itemIndex)"
		:data-point="pointId"
		:data-control="controlId"
		:data-inspected="inspected ? 'true' : undefined"
	>
		<div class="toolbar-item-content" :inert="editing && !isDrawer ? true : undefined">
			<HeadItem :context="context" />
		</div>
		<div
			v-if="editing"
			class="toolbar-item-guard"
			aria-hidden="true"
			@pointerdown="onGuardPointerdown"
		></div>
	</div>
</template>
