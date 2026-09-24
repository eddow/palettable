<script setup lang="ts">
/**
 * `@palettable/vue` — `stepper` (number ±) head control.
 *
 * Same DOM contract as the vanilla `renderStepper`: a
 * `.palette-default-stepper.palette-default-tone-*` group with minus /
 * readout / plus children, the readout a
 * `.palette-default-stepper-value` chip (icon + text). Clicks recompute
 * the base value fresh (a captured value would replay the first step
 * forever) and clamp to min/max; minus/plus disable at the range ends or
 * when `can` is false.
 */
import { computed } from 'vue'
import { sliderPresenter } from '@palettable/core'
import { boundOf, liveValue, pointIdOf, resolveIcon } from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const view = computed(() => {
	const { core, item, surface, display } = props.context
	return sliderPresenter(item, boundOf(core, pointIdOf(item)), surface, display)
})

const icon = computed(() => resolveIcon(view.value.icon, props.context.iconResolver))

const minusDisabled = computed(
	() =>
		!view.value.can ||
		view.value.value === undefined ||
		view.value.value - view.value.step < view.value.min
)

const plusDisabled = computed(
	() =>
		!view.value.can ||
		view.value.value === undefined ||
		view.value.value + view.value.step > view.value.max
)

function step(direction: 1 | -1): void {
	const { core, item, surface, display } = props.context
	const pointId = pointIdOf(item)
	if (pointId === undefined) return
	try {
		const point = core.getDefinition(pointId)
		const live = sliderPresenter(
			item,
			{ point, value: liveValue(core, point), bags: core.resolveBags(point?.uses) },
			surface,
			display
		)
		if (live.value === undefined) return
		core.writeValue(
			pointId,
			direction === 1
				? Math.min(live.max, live.value + live.step)
				: Math.max(live.min, live.value - live.step)
		)
	} catch {
		// Skeleton: nothing to write to.
	}
}
</script>

<template>
	<div
		class="palette-default-stepper"
		:class="`palette-default-tone-${view.tone}`"
		:title="view.title"
	>
		<button
			type="button"
			class="palette-default-tool palette-default-tool-compact"
			:disabled="minusDisabled"
			@click="() => step(-1)"
		>−</button>
		<span class="palette-default-stepper-value"><span class="palette-default-icon">{{ icon }}</span>{{ view.value }}</span>
		<button
			type="button"
			class="palette-default-tool palette-default-tool-compact"
			:disabled="plusDisabled"
			@click="() => step(1)"
		>+</button>
	</div>
</template>
