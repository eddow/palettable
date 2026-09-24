<script setup lang="ts">
/**
 * `@palettable/vue` — `segmented` (enum joined-buttons) head control.
 *
 * Same DOM contract as the vanilla `renderSegmented`: a
 * `.palette-default-segmented.palette-default-tone-*` group of
 * `.palette-default-tool.palette-default-tool-compact` buttons with
 * `data-value`, `is-selected` on the current value, disabled when the
 * option or tool `can` is false (or the button already shows the value).
 * Labels honour `config.showText` (icon-only when false, with the icon-less
 * fallback keeping the label so no button is ever empty).
 */
import { computed } from 'vue'
import { selectPresenter } from '@palettable/core'
import { boundOf, notifyDrawerItemActivate, pointIdOf, resolveIcon } from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const view = computed(() => {
	const { core, item, surface, display } = props.context
	return selectPresenter(item, boundOf(core, pointIdOf(item)), surface, display)
})

function optionIcon(optionIconValue: string | undefined): string | undefined {
	return resolveIcon(optionIconValue, props.context.iconResolver)
}

function optionLabel(option: {
	readonly value: string
	readonly icon: string | undefined
	readonly label: string | undefined
}): string | undefined {
	if (view.value.showText) return option.label
	if (option.icon === undefined) return option.label ?? option.value
	return undefined
}

function select(optionValue: string, event: MouseEvent): void {
	props.context.core.run(view.value.select(optionValue))
	notifyDrawerItemActivate(event.currentTarget as HTMLElement)
}
</script>

<template>
	<div
		class="palette-default-segmented"
		:class="`palette-default-tone-${view.tone}`"
		:title="view.title"
	>
		<button
			v-for="option in view.options"
			:key="option.value"
			type="button"
			class="palette-default-tool palette-default-tool-compact"
			:class="{ 'is-selected': view.value === option.value }"
			:disabled="!option.can || !view.can || view.value === option.value"
			:data-value="option.value"
			:title="option.text"
			@click="(event) => select(option.value, event)"
		>
			<span v-if="optionIcon(option.icon) !== undefined" class="palette-default-choice-icon">{{ optionIcon(option.icon) }}</span>
			<span v-if="optionLabel(option) !== undefined" class="palette-default-choice">{{ optionLabel(option) }}</span>
		</button>
	</div>
</template>
