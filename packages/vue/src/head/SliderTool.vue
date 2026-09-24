<script setup lang="ts">
/**
 * `@palettable/vue` — `slider` (number range) head control.
 *
 * Same DOM contract as the vanilla `renderSlider`: a
 * `.palette-default-slider.palette-default-slider-{inline,drawer}.palette-default-tone-*`
 * label with a `.palette-default-slider-value` readout chip (icon + text,
 * icon-only when `config.showValue === false`) and a
 * `.palette-default-slider-track > input[type=range]` with min/max/step
 * from the point constraints. Input writes via `core.writeValue`
 * (skeleton-safe: nothing to write to is a no-op).
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

function onInput(event: Event): void {
	const { core, item } = props.context
	const pointId = pointIdOf(item)
	if (pointId === undefined) return
	const target = event.target
	if (!(target instanceof HTMLInputElement)) return
	try {
		core.writeValue(pointId, Number(target.value))
	} catch {
		// Skeleton (no value anywhere): thumb has nothing to write to.
	}
}
</script>

<template>
	<label
		class="palette-default-slider"
		:class="[
			`palette-default-slider-${view.variant}`,
			`palette-default-tone-${view.tone}`,
		]"
		:title="view.title"
	>
		<span v-if="view.variant === 'drawer'" class="palette-default-slider-trigger">
			<span
				class="palette-default-slider-value"
				:class="{ 'is-icon-only': !view.showValue }"
			><span class="palette-default-icon">{{ icon }}</span><template v-if="view.showValue">{{ view.text }}</template></span>
		</span>
		<span
			v-else
			class="palette-default-slider-value"
			:class="{ 'is-icon-only': !view.showValue }"
		><span class="palette-default-icon">{{ icon }}</span><template v-if="view.showValue">{{ view.text }}</template></span>
		<span class="palette-default-slider-track">
			<input
				type="range"
				:min="String(view.min)"
				:max="String(view.max)"
				:step="String(view.step)"
				:value="String(view.value ?? view.min)"
				:disabled="!view.can"
				:aria-label="view.title"
				@input="onInput"
			/>
		</span>
	</label>
</template>
