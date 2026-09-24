<script setup lang="ts">
/**
 * `@palettable/vue` — `commandBox` (toolbar combobox) head control.
 *
 * Same DOM contract as the vanilla `renderCommandBox`: a
 * `.palette-default-command-box.is-floating` box (`data-testid="command-box-combobox"`,
 * `data-has-text`) with a `.palette-default-command-shell` (icon, hint/text
 * readout, `data-testid="command-box-input"` input, `data-testid="command-box-open-configurator"`
 * edit button) and a hidden `.palette-default-command-popover` holding a
 * `data-testid="command-box-results"` list of `.palette-default-command-result`
 * rows (max 8, empty state when none match). Runs commands inline via
 * `core.run`; Enter runs the first match; Escape closes.
 */
import { computed, ref } from 'vue'
import { actionableEntries, filterCommandEntries } from '@palettable/core'
import { resolveIdeStrings } from '../strings.js'
import { pointIdOf, resolveIcon } from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{ context: HeadContext }>()

const query = ref('')
const open = ref(false)

const strings = computed(() => resolveIdeStrings(props.context.strings))
const display = computed(() => props.context.display)

const hint = computed(() => {
	const { item } = props.context
	const pointId = pointIdOf(item)
	const dictHint = pointId !== undefined ? display.value?.pointHints?.[pointId] : undefined
	if (typeof dictHint === 'string' && dictHint.length > 0) return dictHint
	const meta = (item as { config?: Record<string, unknown> }).config ?? {}
	if (typeof meta.hint === 'string') return meta.hint
	return strings.value.searchHint
})

const shellIcon = computed(() => {
	const { item } = props.context
	const meta = (item as { config?: Record<string, unknown> }).config ?? {}
	if (typeof meta.icon === 'string')
		return resolveIcon(meta.icon, props.context.iconResolver) ?? '⌘'
	return '⌘'
})

const entries = computed(() => {
	const { core } = props.context
	const all = actionableEntries(core.points, {
		keys: core.keys,
		values: core.values.asObject(),
		strings: core.strings,
	})
	return filterCommandEntries(all, { free: query.value }).slice(0, 8)
})

const hasText = computed(() => query.value.trim().length > 0)

function onFocus(): void {
	open.value = true
}

function onBlur(): void {
	open.value = false
}

function onOpenConsole(event: MouseEvent): void {
	event.preventDefault()
	props.context.onOpenConsole?.('edit')
	;(event.currentTarget as HTMLElement | null)?.blur?.()
}

function runEntry(run: unknown): void {
	props.context.core.run(run as never)
	open.value = false
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === 'Enter') {
		event.preventDefault()
		const first = entries.value[0]
		if (first) runEntry(first.run)
		open.value = false
		;(event.target as HTMLElement).blur()
	}
	if (event.key === 'Escape') {
		open.value = false
		;(event.target as HTMLElement).blur()
	}
}

function entryIcon(icon: unknown): string | undefined {
	return typeof icon === 'string'
		? resolveIcon(icon, props.context.iconResolver)
		: undefined
}
</script>

<template>
	<div
		class="palette-default-command-box is-floating"
		:data-has-text="hasText ? 'true' : 'false'"
		data-testid="command-box-combobox"
	>
		<div class="palette-default-command-shell" :title="hint">
			<span class="palette-default-command-icon palette-default-icon">{{ shellIcon }}</span>
			<div class="palette-default-command-tokens">
				<span class="palette-default-command-text" :class="{ 'is-hint': !hasText }" aria-hidden="true">{{ hasText ? query : hint }}</span>
				<input
					v-model="query"
					class="palette-default-command-input"
					data-testid="command-box-input"
					:placeholder="strings.commandPlaceholder"
					value=""
					@focus="onFocus"
					@blur="onBlur"
					@keydown="onKeydown"
				/>
				<button
					type="button"
					class="palette-default-command-open"
					data-testid="command-box-open-configurator"
					:aria-label="strings.editToolbars"
					:title="strings.editToolbars"
					@mousedown.prevent
					@click="onOpenConsole"
				>✎</button>
			</div>
		</div>
		<div class="palette-default-command-popover" :hidden="!open ? '' : undefined">
			<div class="palette-default-command-results" data-testid="command-box-results">
				<div v-if="entries.length === 0" class="palette-default-command-empty">{{ strings.noMatchingCommands }}</div>
				<button
					v-for="entry in entries"
					:key="entry.id"
					type="button"
					class="palette-default-command-result"
					:disabled="entry.can === false"
					@mousedown.prevent
					@click="() => runEntry(entry.run)"
				>
					<span class="palette-default-command-result-copy">
						<span class="palette-default-command-result-label"><span v-if="entryIcon(entry.icon) !== undefined" class="palette-default-icon">{{ entryIcon(entry.icon) }}</span>{{ entry.label }}</span>
						<span class="palette-default-command-result-meta">{{ entry.meta }}</span>
					</span>
				</button>
			</div>
		</div>
	</div>
</template>
