<script setup lang="ts">
/**
 * `@palettable/vue` — `theme` head control.
 *
 * Same DOM contract as the vanilla `renderTheme`: a compact icon-only
 * button with `data-testid="theme-tool"`, the current option's icon as
 * its glyph, `title` from the presenter. Get/set lives adapter-side on
 * the `HeadContext.theme` mirror when present (else the document root
 * directly) — never through `core.values`. Click cycles
 * light → dark → system, recomputed fresh each time. Custom heads observe
 * the same mirror: read `theme.value` in a `computed` and write via
 * `theme.set` — no tool required.
 */
import { computed, onMounted } from 'vue'
import { themePresenter, type ThemeValue } from '@palettable/core'
import { applyThemeSetting, readThemeSetting } from '../theme.js'
import { boundOf, pointIdOf, resolveIcon } from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const settingOf = (context: HeadContext): ThemeValue => context.theme?.value ?? readThemeSetting()

const view = computed(() => {
	const { core, item, display } = props.context
	const fresh = boundOf(core, pointIdOf(item))
	return themePresenter(item, { ...fresh, value: settingOf(props.context) }, display)
})

const icon = computed(() => resolveIcon(view.value.valueIcon, props.context.iconResolver))

function apply(settingValue: ThemeValue): void {
	const { theme } = props.context
	if (theme !== undefined) theme.set(settingValue)
	else if (typeof document !== 'undefined') {
		applyThemeSetting(document.documentElement, settingValue)
	}
}

// Apply the resolved theme on mount only when the mirror is absent (legacy
// direct-root path). With a mirror the IDE already applies on every write,
// so the tool must not re-apply a stale default over a consumer write.
onMounted(() => {
	if (props.context.theme !== undefined) return
	if (typeof document !== 'undefined') {
		applyThemeSetting(document.documentElement, settingOf(props.context))
	}
})

function nextValue(context: HeadContext): ThemeValue {
	const { core, item, display } = context
	const fresh = boundOf(core, pointIdOf(item))
	const next = themePresenter(item, { ...fresh, value: settingOf(context) }, display)
	const applied = next.cycle.kind === 'set' ? next.cycle.value : undefined
	return applied === 'light' || applied === 'dark' ? applied : 'system'
}

function onClick(): void {
	// `settingOf` re-tracks the mirror ref inside `view`, so tool clicks,
	// consumer `theme.set` writes and external root edits all re-render.
	apply(nextValue(props.context))
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
