<script setup lang="ts">
/**
 * `@palettable/vue` — `toggle` (boolean) head control.
 *
 * Same DOM contract as the vanilla `renderToggle`: a compact
 * `.palette-default-tool.palette-default-tool-compact` button with
 * `aria-pressed` (`mixed` for skeleton), `is-selected` when pressed,
 * icon-only (no `.palette-default-choice` node — it would reserve gap
 * space and trip the vertical overlay gate). Click recomputes the toggle
 * spec fresh (a captured spec would replay the first transition forever).
 */
import { computed } from 'vue'
import { togglePresenter } from '@palettable/core'
import { boundOf, notifyDrawerItemActivate, pointIdOf, resolveIcon } from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const bound = computed(() => boundOf(props.context.core, pointIdOf(props.context.item)))

const view = computed(() => {
	const { item, display } = props.context
	return togglePresenter(item, bound.value, display)
})

const icon = computed(() => resolveIcon(view.value.icon, props.context.iconResolver))

const pressedAttr = computed(() =>
	view.value.pressed === undefined ? 'mixed' : view.value.pressed ? 'true' : 'false'
)

function onClick(event: MouseEvent): void {
	// Recompute at click time: `view.toggle` is captured from render and
	// goes stale after the first click (false→true would replay forever).
	const { core, item, display } = props.context
	const fresh = boundOf(core, pointIdOf(item))
	const live = togglePresenter(item, fresh, display)
	if (!live.can) return
	core.run(live.toggle)
	notifyDrawerItemActivate(event.currentTarget as HTMLElement)
}
</script>

<template>
	<button
		type="button"
		class="palette-default-tool palette-default-tool-compact"
		:class="[
			`palette-default-tone-${view.tone}`,
			{ 'is-selected': view.pressed === true },
		]"
		:aria-pressed="pressedAttr"
		:disabled="!view.can"
		:title="view.title"
		@click="onClick"
	>
		<span class="palette-default-icon">{{ icon }}</span>
	</button>
</template>
