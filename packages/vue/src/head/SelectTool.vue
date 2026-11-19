<script setup lang="ts">
/**
 * `@palettable/vue` — `select` (enum dropdown) head control.
 *
 * Same DOM contract as the vanilla `renderSelect`: a
 * `.palette-default-select.palette-default-tone-*` box with a
 * `.palette-default-select-trigger` (aria-haspopup=listbox), a
 * `.palette-default-select-value` chip (tool icon + value icon + closed
 * label, or the `?` watermark for skeleton), and a hidden
 * `.palette-default-select-list` (role=listbox) of
 * `.palette-default-select-option` rows (role=option, `data-value`,
 * `aria-selected`). Opt-in text filter (`config.showFilter`) pins a
 * `.palette-default-select-filter` row with `data-testid` input + empty
 * state. Opens on click only, never hover.
 */
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { selectClosedLabel, selectPresenter } from '@palettable/core'
import { resolveIdeStrings } from '../strings.js'
import {
	SELECT_WATERMARK_CLASS,
	boundOf,
	pointIdOf,
	resolveIcon,
} from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const open = ref(false)
const filter = ref('')
const boxRef = useTemplateRef<HTMLElement>('box')
const triggerRef = useTemplateRef<HTMLButtonElement>('trigger')

const view = computed(() => {
	const { core, item, surface, display } = props.context
	return selectPresenter(item, boundOf(core, pointIdOf(item)), surface, display)
})

const closedLabel = computed(() => selectClosedLabel(view.value))
const direction = computed(() => view.value.direction)
const toolIcon = computed(() => resolveIcon(view.value.toolIcon, props.context.iconResolver))
const valueIcon = computed(() => resolveIcon(view.value.icon, props.context.iconResolver))
const strings = computed(() => resolveIdeStrings(props.context.strings))

const visibleOptions = computed(() => {
	const term = filter.value.trim().toLowerCase()
	if (term === '') return view.value.listOptions
	return view.value.listOptions.filter((option) =>
		`${option.label} ${option.value}`.toLowerCase().includes(term)
	)
})

function toggle(event: MouseEvent): void {
	event.stopPropagation()
	open.value = !open.value
	if (!open.value) filter.value = ''
}

function close(): void {
	open.value = false
	filter.value = ''
}

function select(optionValue: string, event: MouseEvent): void {
	event.stopPropagation()
	void props.context.core.run(view.value.select(optionValue))
	close()
}

function optionIcon(optionIconValue: string | undefined): string | undefined {
	return resolveIcon(optionIconValue, props.context.iconResolver)
}

function onFilterKeydown(event: KeyboardEvent): void {
	event.stopPropagation()
	if (event.key === 'Enter') {
		event.preventDefault()
		const first = visibleOptions.value.find((option) => option.can && view.value.can)
		if (first !== undefined) {
			void props.context.core.run(view.value.select(first.value))
			close()
			triggerRef.value?.focus()
		}
	} else if (event.key === 'Escape') {
		close()
		triggerRef.value?.focus()
	}
}

function onDocumentClick(event: MouseEvent): void {
	if (!open.value) return
	if (boxRef.value?.contains(event.target as Node | null) === true) return
	close()
}

function onTriggerKeydown(event: KeyboardEvent): void {
	if (event.key === 'Escape' && open.value) {
		event.stopPropagation()
		close()
		triggerRef.value?.focus()
	}
}

document.addEventListener('click', onDocumentClick, true)

onBeforeUnmount(() => {
	document.removeEventListener('click', onDocumentClick, true)
})
</script>

<template>
	<div
		ref="box"
		class="palette-default-select"
		:class="`palette-default-tone-${view.tone}`"
		:title="view.title"
	>
		<button
			ref="trigger"
			type="button"
			class="palette-default-select-trigger"
			aria-haspopup="listbox"
			:aria-expanded="open ? 'true' : 'false'"
			:disabled="!view.can"
			@click="toggle"
			@keydown="onTriggerKeydown"
		>
			<span
				class="palette-default-select-value"
				:class="{ 'is-icon-only': closedLabel === undefined && !view.isSkeleton }"
			>
				<span v-if="toolIcon !== undefined" class="palette-default-icon palette-default-tool-icon">{{ toolIcon }}</span>
				<span v-if="valueIcon !== undefined" class="palette-default-icon palette-default-value-icon">{{ valueIcon }}</span>
			</span>
			<span v-if="view.isSkeleton" :class="SELECT_WATERMARK_CLASS" aria-hidden="true">?</span>
			<span v-else-if="closedLabel !== undefined && direction === 'horizontal'" class="palette-default-choice">{{ closedLabel }}</span>
			<span v-else-if="closedLabel !== undefined && direction === 'vertical'" class="palette-default-choice">{{ closedLabel }}</span>
		</button>
		<div class="palette-default-select-list" role="listbox" :hidden="!open ? '' : undefined">
			<div v-if="view.showFilter" class="palette-default-select-filter">
				<input
					v-model="filter"
					class="palette-default-select-filter-input"
					data-testid="select-filter-input"
					type="text"
					:placeholder="strings.filterPlaceholder"
					:aria-label="strings.filterAriaLabel"
					@click.stop
					@keydown="onFilterKeydown"
				/>
				<div
					class="palette-default-command-empty"
					data-testid="select-filter-empty"
					:hidden="visibleOptions.length > 0 ? '' : undefined"
				>{{ strings.noMatches }}</div>
			</div>
			<button
				v-for="option in view.listOptions"
				:key="option.value"
				type="button"
				class="palette-default-select-option"
				:class="{ 'is-selected': view.value === option.value }"
				role="option"
				:aria-selected="view.value === option.value ? 'true' : 'false'"
				:data-value="option.value"
				:disabled="!option.can || !view.can"
				:hidden="!visibleOptions.includes(option) ? '' : undefined"
				@click="(event) => select(option.value, event)"
			>
				<span v-if="optionIcon(option.icon) !== undefined" class="palette-default-choice-icon">{{ optionIcon(option.icon) }}</span>
				<span class="palette-default-choice">{{ option.label }}</span>
			</button>
		</div>
	</div>
</template>
