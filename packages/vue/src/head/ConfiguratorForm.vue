<script setup lang="ts">
/**
 * `@palettable/vue` — tool configurator (Details-panel config form).
 *
 * Same DOM contract as the vanilla `renderConfigurator`: a
 * `.palette-default-config-table` of `.palette-default-config-row` rows
 * (Label / Icon / Hint / Control / Tone + per-control rows: drawer open
 * mode `data-testid="configurator-drawer-open"` + close-on-click
 * `data-testid="configurator-drawer-close-on-click"`, status key, slider
 * `data-testid="configurator-show-value"`, select/segmented
 * `data-testid="configurator-show-text"`, select
 * `data-testid="configurator-show-filter"`, delete
 * `data-testid="configurator-delete"`). Mutations go through the `patch`
 * prop (live items: mutate + re-render borders; add-flow drafts: mutate +
 * refresh preview) — the form never touches the layout itself.
 */
import { computed } from 'vue'
import {
	configuratorControlCleanup,
	controlChoicesFor,
	isActionPoint,
	isValuedPoint,
	type AnyPoint,
	type ToolbarItem,
} from '@palettable/core'
import { resolveIdeStrings } from '../strings.js'
import type { IdeStrings } from '../strings.js'

const props = defineProps<{
	item: ToolbarItem
	point: AnyPoint | undefined
	region?: string
	strings?: Partial<IdeStrings>
	iconChoices?: readonly string[]
	deletable?: boolean
	patch: (apply: (target: ToolbarItem) => void) => void
	onDelete?: () => void
}>()

const strings = computed(() => resolveIdeStrings(props.strings))

function defaultControlFor(point: AnyPoint | undefined): string | undefined {
	if (point === undefined) return 'status'
	if (isActionPoint(point)) return 'button'
	if (!isValuedPoint(point)) return 'status'
	if (point.type === 'boolean') return 'toggle'
	if (point.type === 'enum') return 'select'
	return 'slider'
}

const CONTROL_IDS = {
	boolean: ['toggle'],
	enum: ['select', 'segmented'],
	number: ['slider', 'drawerSlider', 'stepper', 'stars'],
	item: ['commandBox', 'drawer', 'status', 'theme'],
	run: ['button'],
} as const

const currentControl = computed(
	() =>
		(props.item as { control?: string }).control ?? defaultControlFor(props.point) ?? 'button'
)

const choices = computed(() => {
	const name = (id: string): string => strings.value.controlNames[id] ?? id
	const registry: Record<string, Record<string, unknown>> = {}
	const familyOf: Record<string, string> = {
		boolean: 'boolean',
		enum: 'enum',
		number: 'number',
		item: 'item',
		run: 'action',
	}
	for (const [group, ids] of Object.entries(CONTROL_IDS)) {
		const family = familyOf[group] ?? 'item'
		registry[group] = {}
		for (const id of ids) {
			registry[group]![id] = { id, label: name(id), families: [family] }
		}
	}
	return controlChoicesFor(
		props.point,
		{ axis: 'horizontal', region: undefined },
		registry as never,
		{ run: 'button', boolean: 'toggle', enum: 'select', number: 'slider' } as never,
		(props.item as { control?: string }).control
	)
})

const showControlRow = computed(() => new Set(choices.value.map((c) => c.id)).size > 1)

const config = computed(
	() => ((props.item as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>
)

const labelValue = computed(() => {
	if (typeof config.value.label === 'string') return config.value.label
	const point = (props.item as { point?: unknown }).point
	if (typeof point === 'string') return point
	return currentControl.value ?? 'Item'
})

function setConfig(key: string, value: unknown): void {
	props.patch((target) => {
		const record = target as { config?: Record<string, unknown> }
		const next = { ...(record.config ?? {}) }
		if (value === undefined) delete next[key]
		else next[key] = value as never
		record.config = next
	})
}

function onControlChange(event: Event): void {
	const next = (event.target as HTMLSelectElement).value
	props.patch((target) => {
		const record = target as { control?: string; config?: Record<string, unknown> }
		record.control = next
		const cleanup = configuratorControlCleanup(next)
		if (record.config) {
			for (const key of cleanup) delete record.config[key]
		}
	})
}

function onDelete(): void {
	props.onDelete?.()
}
</script>

<template>
	<div class="palette-default-config-table">
		<div class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.labelKey }}</strong></div>
			<div class="palette-default-config-value"><input :value="labelValue" @input="setConfig('label', ($event.target as HTMLInputElement).value)" /></div>
		</div>
		<div class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.iconKey }}</strong></div>
			<div class="palette-default-config-value"><input :value="typeof config.icon === 'string' ? config.icon : ''" :list="iconChoices !== undefined && iconChoices.length > 0 ? 'palette-config-icon-choices' : undefined" @input="setConfig('icon', ($event.target as HTMLInputElement).value)" /><datalist v-if="iconChoices !== undefined && iconChoices.length > 0" id="palette-config-icon-choices"><option v-for="choice in iconChoices" :key="choice" :value="choice" /></datalist></div>
		</div>
		<div class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.hintKey }}</strong></div>
			<div class="palette-default-config-value"><input :value="typeof config.hint === 'string' ? config.hint : ''" @input="setConfig('hint', ($event.target as HTMLInputElement).value)" /></div>
		</div>
		<div v-if="showControlRow" class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.controlKey }}</strong></div>
			<div class="palette-default-config-value">
				<select :value="currentControl" @change="onControlChange">
					<option v-for="choice in choices" :key="choice.id" :value="choice.id">{{ choice.label }}</option>
				</select>
			</div>
		</div>
		<div class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.toneKey }}</strong></div>
			<div class="palette-default-config-value">
				<select :value="config.tone === 'accent' ? 'accent' : 'neutral'" @change="setConfig('tone', ($event.target as HTMLSelectElement).value === 'accent' ? 'accent' : 'neutral')">
					<option value="neutral">{{ strings.toneNeutral }}</option>
					<option value="accent">{{ strings.toneAccent }}</option>
				</select>
			</div>
		</div>
		<template v-if="currentControl === 'drawer'">
			<div class="palette-default-config-row">
				<div class="palette-default-config-key"><strong>{{ strings.openModeKey }}</strong></div>
				<div class="palette-default-config-value">
					<select
						:value="config.open === 'hover' ? 'hover' : 'toggle'"
						data-testid="configurator-drawer-open"
						:aria-label="strings.openModeKey"
						@change="setConfig('open', ($event.target as HTMLSelectElement).value === 'toggle' ? undefined : ($event.target as HTMLSelectElement).value)"
					>
						<option value="hover">{{ strings.openHover }}</option>
						<option value="toggle">{{ strings.openToggle }}</option>
					</select>
				</div>
			</div>
			<div class="palette-default-config-row">
				<div class="palette-default-config-key"><strong>{{ strings.closeOnClickKey }}</strong></div>
				<div class="palette-default-config-value">
					<input
						type="checkbox"
						:checked="config.closeOnClick === true"
						data-testid="configurator-drawer-close-on-click"
						:aria-label="strings.closeOnClickKey"
						@change="setConfig('closeOnClick', ($event.target as HTMLInputElement).checked ? true : undefined)"
					/>
				</div>
			</div>
		</template>
		<div v-if="currentControl === 'status'" class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.statusKeyKey }}</strong></div>
			<div class="palette-default-config-value"><input :value="typeof config.statusKey === 'string' ? config.statusKey : ''" @input="setConfig('statusKey', ($event.target as HTMLInputElement).value.trim() === '' ? undefined : ($event.target as HTMLInputElement).value)" /></div>
		</div>
		<div v-if="currentControl === 'slider' || currentControl === 'drawerSlider'" class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.displayNumberKey }}</strong></div>
			<div class="palette-default-config-value">
				<input
					type="checkbox"
					:checked="config.showValue !== false"
					data-testid="configurator-show-value"
					:aria-label="strings.displayNumberKey"
					@change="setConfig('showValue', ($event.target as HTMLInputElement).checked ? undefined : false)"
				/>
			</div>
		</div>
		<div v-if="currentControl === 'select' || currentControl === 'segmented'" class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.showTextKey }}</strong></div>
			<div class="palette-default-config-value">
				<input
					type="checkbox"
					:checked="config.showText !== false"
					data-testid="configurator-show-text"
					:aria-label="strings.showTextKey"
					@change="setConfig('showText', ($event.target as HTMLInputElement).checked ? undefined : false)"
				/>
			</div>
		</div>
		<div v-if="currentControl === 'select'" class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.filterListKey }}</strong></div>
			<div class="palette-default-config-value">
				<input
					type="checkbox"
					:checked="config.showFilter === true"
					data-testid="configurator-show-filter"
					:aria-label="strings.filterListKey"
					@change="setConfig('showFilter', ($event.target as HTMLInputElement).checked ? true : undefined)"
				/>
			</div>
		</div>
		<div v-if="deletable !== false" class="palette-default-config-row">
			<div class="palette-default-config-key"><strong>{{ strings.deleteKey }}</strong></div>
			<div class="palette-default-config-value">
				<button type="button" class="palette-default-config-delete" data-testid="configurator-delete" @click="onDelete">{{ strings.deleteTool }}</button>
			</div>
		</div>
	</div>
</template>
