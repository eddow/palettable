<script setup lang="ts">
/**
 * `@palettable/vue` — `status` (nothing-point) head control.
 *
 * Same DOM contract as the vanilla `renderStatus`: a
 * `.palette-default-status.palette-default-tone-*` span with icon +
 * value nodes, `aria-disabled="true"` when the context bag is absent.
 * Vertical splits `mm:ss` into minutes/seconds nodes; anything else falls
 * back to the single value node so the square is never empty.
 */
import { computed } from 'vue'
import { statusPresenter } from '@palettable/core'
import { boundOf, pointIdOf, resolveIcon, splitStatusTime } from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const view = computed(() => {
	const { core, item, surface, display } = props.context
	return statusPresenter(item, boundOf(core, pointIdOf(item)), surface, display)
})

const icon = computed(() => resolveIcon(view.value.icon, props.context.iconResolver))

const split = computed(() =>
	view.value.direction === 'vertical' ? splitStatusTime(view.value.value) : undefined
)
</script>

<template>
	<span
		class="palette-default-status"
		:class="`palette-default-tone-${view.tone}`"
		:title="view.title"
		:aria-disabled="!view.can ? 'true' : undefined"
	>
		<span v-if="icon !== undefined" class="palette-default-icon">{{ icon }}</span>
		<template v-if="split !== undefined">
			<span class="palette-default-status-minutes">{{ split[0] }}</span>
			<span class="palette-default-status-seconds">{{ split[1] }}</span>
			<span class="palette-default-status-value" hidden="">{{ view.value }}</span>
		</template>
		<template v-else>
			<span
				v-if="view.direction === 'vertical'"
				class="palette-default-status-minutes"
				hidden=""
			></span>
			<span
				v-if="view.direction === 'vertical'"
				class="palette-default-status-seconds"
				hidden=""
			></span>
			<span class="palette-default-status-value">{{ view.value }}</span>
		</template>
	</span>
</template>
