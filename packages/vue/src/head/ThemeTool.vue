<script setup lang="ts">
/**
 * `@palettable/vue` — `theme` head control.
 *
 * Same DOM contract as the vanilla `renderTheme`: a compact icon-only
 * button with `data-testid="theme-tool"`, the current option's icon as
 * its glyph, `title` from the presenter. Get/set lives adapter-side on
 * the document root (`data-theme` / `palette-default-theme-light` class
 * via `applyThemeSetting`) — never through `core.values`. Click cycles
 * light → dark → system, recomputed fresh each time.
 */
import { computed, onMounted, ref } from 'vue'
import { themePresenter } from '@palettable/core'
import { applyThemeSetting } from '../theme.js'
import { boundOf, pointIdOf, readThemeSetting, resolveIcon } from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const setting = ref<'light' | 'dark' | 'system'>(readThemeSetting())

const view = computed(() => {
	const { core, item, display } = props.context
	const fresh = boundOf(core, pointIdOf(item))
	return themePresenter(item, { ...fresh, value: setting.value }, display)
})

const icon = computed(() => resolveIcon(view.value.valueIcon, props.context.iconResolver))

function apply(settingValue: 'light' | 'dark' | 'system'): void {
	setting.value = settingValue
	if (typeof document !== 'undefined') {
		applyThemeSetting(document.documentElement, settingValue)
	}
}

// Apply the resolved theme on mount (mirrors the vanilla render side-effect
// so body-portaled drawer popups follow the same switch).
onMounted(() => {
	if (typeof document !== 'undefined') {
		applyThemeSetting(document.documentElement, setting.value)
	}
})

function onClick(): void {
	const { core, item, display } = props.context
	const fresh = boundOf(core, pointIdOf(item))
	const next = themePresenter(item, { ...fresh, value: readThemeSetting() }, display)
	const applied = next.cycle.kind === 'set' ? next.cycle.value : undefined
	apply(applied === 'light' || applied === 'dark' ? applied : 'system')
}
</script>

<template>
	<button
		type="button"
		class="palette-default-tool palette-default-tool-compact"
		:class="`palette-default-tone-${view.tone}`"
		data-testid="theme-tool"
		:title="view.title"
		:disabled="view.value === undefined && boundOf(context.core, pointIdOf(context.item)).point === undefined"
		@click="onClick"
	>
		<span v-if="icon !== undefined" class="palette-default-icon">{{ icon }}</span>
	</button>
</template>
