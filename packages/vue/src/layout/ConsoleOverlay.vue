<script setup lang="ts">
/**
 * `@palettable/vue` — console overlay (`.palette-default-command-overlay`).
 *
 * Vue-idiom mirror of the vanilla `renderConsole`: a `role="dialog"`
 * overlay (`data-testid="console-overlay"`) with close button, parking
 * top (`ConsoleParking`), command box main (input + optional mode toggle
 * + results), and the details panel (inspect configurator / add panel /
 * empty hint). Same DOM contract the e2e suite asserts.
 *
 * Reactivity: `consoleQuery` is local state (input owns it); results
 * recompute per keystroke. `selectedEntryId` lives in the `ConsoleStore`
 * (patched on add-flow select). `inspected` lives in the IDE shell
 * (set by guard pointerdown). All reads go through core builders /
 * presenters; all writes through `core.run` / `core.layout` /
 * `ConsoleStore`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import {
	actionableEntries,
	addableEntries,
	type AddableEntry,
	type ConsoleStore,
	filterCommandEntries,
	isActionPoint,
	type PaletteCore,
	paletteDerivedVariants,
	type ToolbarItem,
} from '@palettable/core'
import { itemFromAddSelection } from '../add-item.js'
import { pointIdOf, resolveIcon, type HeadContext } from '../head.js'
import { resolveIdeStrings } from '../strings.js'
import ConfiguratorForm from '../head/ConfiguratorForm.vue'
import HeadItem from '../head/HeadItem.vue'
import ConsoleParking from './ConsoleParking.vue'

const props = defineProps<{
	core: PaletteCore
	consoleStore: ConsoleStore
	editing: boolean
	canEdit: boolean
	editOnly: boolean
	inspected: ToolbarItem | undefined
	iconResolver?: (token: string) => string | undefined
	iconChoices?: readonly string[]
	itemControls?: readonly string[]
	strings: ReturnType<typeof resolveIdeStrings>
	display?: import('@palettable/core').DisplayStrings
	onClose: () => void
	onToggleMode: () => void
	onSelectAddEntry: (entry: AddableEntry) => void
	onClearInspecting: () => void
	onDeleteInspected: () => void
	patchLive: (item: ToolbarItem, apply: (target: ToolbarItem) => void) => void
}>()

const query = ref('')
const inputRef = useTemplateRef<HTMLInputElement>('input')

// Local mirror of the store selection: `consoleStore.patch` emits
// synchronously, but the shell's `layoutRevision` bump (which makes
// `snapshot` recompute) lands on the next flush. The mirror updates
// synchronously so the add panel paints without waiting a tick.
const selectedId = ref<string | undefined>(props.consoleStore.snapshot.selectedEntryId)
const storeUnsub = props.consoleStore.subscribe((state) => {
	selectedId.value = state.selectedEntryId
})

onBeforeUnmount(() => {
	storeUnsub()
})

const snapshot = computed(() => {
	// Reactive on console-store bumps via parent `layoutRevision`.
	// Read the revision through the store snapshot: `consoleStore.patch`
	// emits, the shell bumps `layoutRevision`, and this recomputes.
	void props.editing
	return props.consoleStore.snapshot
})

const placeholder = computed(() =>
	props.editing ? props.strings.addPlaceholder : props.strings.runPlaceholder
)

const showModeToggle = computed(() => props.canEdit && !props.editOnly)

const toggleLabel = computed(() => (props.editing ? props.strings.doneEditing : props.strings.editToolbars))

function actionCan(): Record<string, boolean | undefined> {
	const out: Record<string, boolean | undefined> = {}
	for (const point of props.core.points) {
		if (!isActionPoint(point)) continue
		try {
			out[point.id] = props.core.evaluateCan(point.id)
		} catch {
			out[point.id] = true
		}
	}
	return out
}

type ResultRow =
	| { readonly kind: 'add'; readonly entry: AddableEntry }
	| { readonly kind: 'run'; readonly entry: { readonly id: string; readonly label: string; readonly meta: string; readonly icon?: string; readonly can?: boolean; readonly run: unknown } }

const results = computed<readonly ResultRow[]>(() => {
	if (props.editing) {
		const sources = addableEntries(
			props.core.points,
			{ itemControls: props.itemControls, strings: props.core.strings },
			{ excludePoints: ['console'] }
		)
		const filtered = filterCommandEntries(sources, { free: query.value })
		return filtered.slice(0, 8).map((entry) => ({ kind: 'add' as const, entry }))
	}
	const all = actionableEntries(
		props.core.points,
		{
			keys: props.core.keys,
			values: props.core.values.asObject(),
			actionCan: actionCan(),
			strings: props.core.strings,
		},
		{ excludePoints: ['console'] }
	)
	const filtered = filterCommandEntries(all, { free: query.value })
	return filtered.slice(0, 8).map((entry) => ({ kind: 'run' as const, entry: { ...entry } }))
})

function onInput(): void {
	query.value = inputRef.value?.value ?? ''
}

function onKeydown(event: KeyboardEvent): void {
	if (event.key === 'Enter') {
		event.preventDefault()
		const first = results.value[0]
		if (first === undefined) return
		if (first.kind === 'add') {
			props.onClearInspecting()
			addDraftKey.value += 1
			props.onSelectAddEntry(first.entry)
		} else {
			props.core.run(first.entry.run as never)
			props.onClose()
		}
	} else if (event.key === 'Escape') {
		props.onClose()
	}
}

function onResultClick(row: ResultRow): void {
	if (row.kind === 'add') {
		props.onClearInspecting()
		addDraftKey.value += 1
		props.onSelectAddEntry(row.entry)
		return
	}
	props.core.run(row.entry.run as never)
	props.onClose()
}

function onOverlayMousedown(event: MouseEvent): void {
	if (event.target === event.currentTarget) props.onClose()
}

function entryIcon(icon: unknown): string | undefined {
	return typeof icon === 'string' ? resolveIcon(icon, props.iconResolver) : undefined
}

// ── Details panel ────────────────────────────────────────────────────────────

const inspectedPoint = computed(() => {
	if (props.inspected === undefined) return undefined
	try {
		const id = pointIdOf(props.inspected)
		return id !== undefined ? props.core.getDefinition(id) : undefined
	} catch {
		return undefined
	}
})

const selectedAddEntry = computed(() => {
	const id = selectedId.value ?? snapshot.value.selectedEntryId
	if (id === undefined) return undefined
	return addableEntries(
		props.core.points,
		{ itemControls: props.itemControls, strings: props.core.strings },
		{ excludePoints: ['console'] }
	).find((entry) => entry.id === id)
})

const addDraftKey = ref(0)

const addDraft = computed(() => {
	const source = selectedAddEntry.value
	if (source === undefined) return undefined
	void addDraftKey.value
	const variant = paletteDerivedVariants(source, props.core.points, props.core.strings)[0]
	if (variant === undefined) return undefined
	const draft = itemFromAddSelection(
		{ source, variant },
		props.core.points,
		props.core.controls,
		props.core.controlDefaults
	)
	return draft
})

const addDraftPointId = computed(() => {
	if (addDraft.value === undefined) return undefined
	try {
		const id = pointIdOf(addDraft.value)
		return id
	} catch {
		return undefined
	}
})

const addDraftPoint = computed(() => {
	if (addDraft.value === undefined || addDraftPointId.value === undefined) return undefined
	try {
		return props.core.getDefinition(addDraftPointId.value)
	} catch {
		return undefined
	}
})

function patchDraft(apply: (target: ToolbarItem) => void): void {
	const draft = addDraft.value
	if (draft === undefined) return
	apply(draft)
	// Force recompute of the preview below.
	addDraftKey.value += 1
}

function previewContext(draft: ToolbarItem): HeadContext {
	return {
		core: props.core,
		item: draft,
		surface: { axis: 'horizontal', region: 'top' },
		region: 'top',
		strings: props.strings,
		display: props.display,
		iconResolver: props.iconResolver,
		onOpenConsole: (mode) => props.consoleStore.open(mode),
	}
}

function onPreviewPointerdown(event: PointerEvent, draft: ToolbarItem): void {
	const target = event.target
	if (target instanceof HTMLElement) {
		if (target.closest('input, select, textarea') !== null) return
	}
	// Catalog drag from the preview is wired by the IDE shell via
	// `startCatalogDrag` — emitted here as a custom event.
	emit('preview-pointerdown', event, JSON.parse(JSON.stringify(draft)) as ToolbarItem)
}

const emit = defineEmits<{
	'preview-pointerdown': [event: PointerEvent, item: ToolbarItem]
	'panel-pointermove': [event: PointerEvent]
	'panel-pointerleave': [event: PointerEvent]
}>()

function onPanelPointermove(event: PointerEvent): void {
	emit('panel-pointermove', event)
}

function onPanelPointerleave(event: PointerEvent): void {
	emit('panel-pointerleave', event)
}

onMounted(() => {
	nextTick(() => inputRef.value?.focus())
})

watch(
	() => selectedId.value ?? snapshot.value.selectedEntryId,
	() => {
		addDraftKey.value += 1
	}
)
</script>

<template>
	<div
		class="palette-default-command-overlay"
		data-testid="console-overlay"
		role="dialog"
		:aria-label="strings.consoleAriaLabel"
		tabindex="-1"
		@mousedown="onOverlayMousedown"
	>
		<div
			class="palette-default-command-panel"
			role="presentation"
			@pointermove="onPanelPointermove"
			@pointerleave="onPanelPointerleave"
		>
			<button
				type="button"
				class="palette-default-command-close"
				:aria-label="strings.closeConsole"
				@click="onClose"
			>×</button>
			<div class="palette-default-command-top">
				<ConsoleParking
					:core="core"
					:editing="editing"
					:strings="strings"
					:icon-resolver="iconResolver"
					:display="display"
				/>
			</div>
			<div class="palette-default-command-bottom">
				<div class="palette-default-command-main">
					<div class="palette-default-command-box is-expanded">
						<div class="palette-default-command-shell" :title="strings.consoleTitle">
							<span class="palette-default-icon">⌘</span>
							<div class="palette-default-command-tokens">
								<input
									ref="input"
									class="palette-default-command-input"
									data-testid="console-input"
									:placeholder="placeholder"
									:value="query"
									@input="onInput"
									@keydown="onKeydown"
								/>
								<button
									v-if="showModeToggle"
									type="button"
									class="palette-default-command-mode"
									data-testid="console-mode-toggle"
									:aria-pressed="editing ? 'true' : 'false'"
									:aria-label="toggleLabel"
									:title="toggleLabel"
									@click="onToggleMode"
								>{{ editing ? '✓' : '✎' }}</button>
							</div>
						</div>
						<div class="palette-default-command-popover">
							<div class="palette-default-command-results" data-testid="console-results">
								<div v-if="results.length === 0" class="palette-default-command-empty">{{ strings.noMatchingCommands }}</div>
								<button
									v-for="row in results"
									:key="row.kind === 'add' ? row.entry.id : row.entry.id"
									type="button"
									class="palette-default-command-result"
									:disabled="row.kind === 'run' ? row.entry.can === false : undefined"
									@mousedown.prevent
									@click="() => onResultClick(row)"
								>
									<span class="palette-default-command-result-copy">
										<span class="palette-default-command-result-label"><span v-if="entryIcon(row.kind === 'add' ? row.entry.icon : row.entry.icon) !== undefined" class="palette-default-icon">{{ entryIcon(row.kind === 'add' ? row.entry.icon : row.entry.icon) }}</span>{{ row.kind === 'add' ? row.entry.label : row.entry.label }}</span>
										<span class="palette-default-command-result-meta">{{ row.kind === 'add' ? row.entry.meta : row.entry.meta }}</span>
									</span>
								</button>
							</div>
						</div>
					</div>
				</div>
				<div
					v-if="editing"
					class="palette-default-panel palette-default-details-panel"
					data-testid="console-details-panel"
				>
					<template v-if="inspected !== undefined">
						<div class="palette-default-panel-title">{{ strings.inspectTitle }}</div>
						<ConfiguratorForm
							:item="inspected"
							:point="inspectedPoint"
							:strings="strings"
							:icon-choices="iconChoices"
							:patch="(apply) => { const item = props.inspected; if (item !== undefined) props.patchLive(item, apply) }"
							:on-delete="onDeleteInspected"
						/>
					</template>
					<template v-else-if="selectedAddEntry !== undefined">
						<div class="palette-default-panel-title">{{ strings.addToToolbarTitle }}</div>
						<div class="palette-default-config-stack" data-testid="console-add-panel">
							<div class="palette-default-config-header">
								<strong>{{ selectedAddEntry.label }}</strong><span>{{ selectedAddEntry.meta }}</span>
							</div>
							<template v-if="addDraft !== undefined">
								<div class="palette-default-panel-title">{{ strings.configureTitle }}</div>
								<ConfiguratorForm
									:item="addDraft"
									:point="addDraftPoint !== undefined ? addDraftPoint : undefined"
									:strings="strings"
									:icon-choices="iconChoices"
									:deletable="false"
									:patch="patchDraft"
								/>
								<div class="palette-default-add-preview" data-testid="console-add-preview">
									<div class="palette-default-panel-title">{{ strings.previewTitle }}</div>
									<div
										class="toolbar-item-content palette-default-add-preview-content"
										data-testid="console-add-preview-content"
										@pointerdown="(event) => onPreviewPointerdown(event, addDraft!)"
									>
										<HeadItem :context="previewContext(addDraft)" />
									</div>
								</div>
							</template>
							<div v-else class="palette-default-config-empty">{{ strings.cannotAdd }}</div>
						</div>
					</template>
					<template v-else>
						<div class="palette-default-panel-title">{{ strings.detailsTitle }}</div>
						<div class="palette-default-config-empty">{{ strings.detailsEmpty }}</div>
					</template>
				</div>
			</div>
		</div>
	</div>
</template>
