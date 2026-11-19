<script setup lang="ts">
/**
 * `@palettable/vue` — `stars` (number rating) head control.
 *
 * Same DOM contract as the vanilla `renderStars`: a
 * `.palette-default-stars.palette-default-tone-*` group with icon +
 * `.palette-default-stars-row` (`role="radiogroup"`) of
 * `.palette-default-arrow` buttons (`role="radio"`, `aria-checked`).
 * Filled glyph `▶` at/below value, `▷` above. Click writes via
 * `core.writeValue` (skeleton: no-op). Reuses `sliderPresenter` for the
 * view-model, like the vanilla renderer.
 */
import { computed } from 'vue'
import { sliderPresenter } from '@palettable/core'
import { boundOf, pointIdOf, resolveIcon } from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const view = computed(() => {
	const { core, item, surface, display } = props.context
	return sliderPresenter(item, boundOf(core, pointIdOf(item)), surface, display)
})

const icon = computed(() => resolveIcon(view.value.icon, props.context.iconResolver))

const starIndices = computed(() => {
	const indices: number[] = []
	for (let index = 1; index <= view.value.max; index += 1) indices.push(index)
	return indices
})

function isFilled(index: number): boolean {
	return view.value.value !== undefined && index <= view.value.value
}

function onRate(index: number): void {
	const pointId = pointIdOf(props.context.item)
	if (pointId === undefined) return
	try {
		props.context.core.writeValue(pointId, index)
	} catch {
		// Skeleton: nothing to write to.
	}
}
</script>

<template>
	<div
		class="palette-default-stars"
		:class="`palette-default-tone-${view.tone}`"
		:title="view.title"
	>
		<span v-if="icon !== undefined" class="palette-default-icon">{{ icon }}</span>
		<span class="palette-default-stars-row" role="radiogroup">
			<button
				v-for="index in starIndices"
				:key="index"
				type="button"
				class="palette-default-arrow"
				:class="{ 'is-selected': isFilled(index) }"
				role="radio"
				:aria-checked="index === view.value ? 'true' : 'false'"
				:title="`${view.title} ${index}`"
				:disabled="!view.can"
				@click="() => onRate(index)"
			>{{ isFilled(index) ? '▶' : '▷' }}</button>
		</span>
	</div>
</template>
