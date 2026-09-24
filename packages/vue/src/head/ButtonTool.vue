<script setup lang="ts">
/**
 * `@palettable/vue` — `button` (action) head control.
 *
 * Same DOM contract as the vanilla `renderButton`: a
 * `.palette-default-tool.palette-default-tone-*` button with
 * `.palette-default-icon` + `.palette-default-choice` children, `disabled`
 * when `can` is false, `title` from the presenter tooltip. Click runs the
 * presenter runnable via `core.run` and notifies drawer ancestors.
 */
import { computed } from 'vue'
import { buttonPresenter, isActionPoint } from '@palettable/core'
import { boundOf, notifyDrawerItemActivate, pointIdOf, resolveIcon } from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const bound = computed(() => boundOf(props.context.core, pointIdOf(props.context.item)))

const view = computed(() => {
	const { core, item, display } = props.context
	const pointId = pointIdOf(item) ?? ''
	const { point, bags } = bound.value
	const can =
		point !== undefined && isActionPoint(point) ? core.evaluateCan(point.id) : true
	return buttonPresenter(
		item,
		{ point, value: undefined, bags },
		{ kind: 'action', point: pointId },
		can,
		display
	)
})

const icon = computed(() => resolveIcon(view.value.icon, props.context.iconResolver))

function onClick(event: MouseEvent): void {
	props.context.core.run(view.value.run)
	notifyDrawerItemActivate(event.currentTarget as HTMLElement)
}
</script>

<template>
	<button
		type="button"
		class="palette-default-tool"
		:class="`palette-default-tone-${view.tone}`"
		:disabled="!view.can"
		:title="view.title"
		@click="onClick"
	>
		<span v-if="icon !== undefined" class="palette-default-icon">{{ icon }}</span>
		<span class="palette-default-choice">{{ view.label }}</span>
	</button>
</template>
