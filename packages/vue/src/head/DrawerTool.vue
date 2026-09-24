<script setup lang="ts">
/**
 * `@palettable/vue` — `drawer` trigger head control.
 *
 * Same DOM contract as the vanilla `renderDrawer`: a `.palettable-drawer`
 * wrapper (purely structural — NO region/axis stamped) holding a
 * `.palette-default-tool.palettable-drawer__trigger` button (icon +
 * `.palette-default-drawer-chevron`, `aria-expanded`/`aria-haspopup`,
 * `is-open-{hover,toggle}`) and a hidden `.palettable-drawer__popup`
 * (`role="dialog"`, `--layout` child axis + `--region` content half).
 * Child content renders via the `renderToolbar` slot prop (the IDE shell
 * passes its drawer-track renderer); without it the popup stays empty.
 *
 * Trigger behavior follows `config.open`: `toggle` toggles on
 * primary-button `pointerdown` (plus a keyboard `click` fallback where
 * `event.detail === 0`); `hover` opens on mouseenter and schedules close
 * via `configuration.drawerHoverCloseMs`. Close-on-click chain
 * (`config.closeOnClick` + hover ancestors) runs on the bubbling
 * `palettable-drawer-item-activate` event. Outside-click + Escape close.
 */
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import {
	configuration,
	drawerChildAxis,
	drawerChildRegion,
	drawerChildRegionFor,
	drawerCloseOnClickOf,
	drawerOpenOf,
	isDrawerItem,
	type PaletteRegion,
	type ToolbarItem,
	type Track,
} from '@palettable/core'
import { resolveIdeStrings } from '../strings.js'
import {
	DRAWER_ITEM_ACTIVATE_EVENT,
	drawerCloseChainIndices,
	type DrawerChainEntry,
	pointIdOf,
	resolveIcon,
} from '../head.js'
import type { HeadContext } from '../head.js'

const props = defineProps<{
	context: HeadContext
	renderToolbar?: (track: Track, axis: 'horizontal' | 'vertical', region: PaletteRegion) => unknown
}>()

const wrapperRef = useTemplateRef<HTMLElement>('wrapper')
const triggerRef = useTemplateRef<HTMLButtonElement>('trigger')
const popupRef = useTemplateRef<HTMLElement>('popup')

const open = ref(false)
const depth = ref(0)

const openMode = computed(() => drawerOpenOf(props.context.item))
const closeOnClick = computed(() => drawerCloseOnClickOf(props.context.item))
const strings = computed(() => resolveIdeStrings(props.context.strings))
const display = computed(() => props.context.display)

const label = computed(() => {
	const { item } = props.context
	const pointId = pointIdOf(item)
	const dictLabel = pointId !== undefined ? display.value?.pointLabels?.[pointId] : undefined
	if (typeof dictLabel === 'string' && dictLabel.length > 0) return dictLabel
	const config = ((item as { config?: Record<string, unknown> }).config ?? {}) as Record<
		string,
		unknown
	>
	return typeof config.label === 'string' ? config.label : ''
})

const hint = computed(() => {
	const { item } = props.context
	const pointId = pointIdOf(item)
	const dictHint = pointId !== undefined ? display.value?.pointHints?.[pointId] : undefined
	if (typeof dictHint === 'string' && dictHint.length > 0) return dictHint
	const config = ((item as { config?: Record<string, unknown> }).config ?? {}) as Record<
		string,
		unknown
	>
	return typeof config.hint === 'string' ? config.hint : undefined
})

const tone = computed(() => {
	const config = ((props.context.item as { config?: Record<string, unknown> }).config ??
		{}) as Record<string, unknown>
	return config.tone === 'accent' ? 'accent' : 'neutral'
})

const triggerIcon = computed(() => {
	const config = ((props.context.item as { config?: Record<string, unknown> }).config ??
		{}) as Record<string, unknown>
	return typeof config.icon === 'string'
		? resolveIcon(config.icon, props.context.iconResolver)
		: undefined
})

const accessibleName = computed(() => {
	if (label.value !== '') return label.value
	return hint.value ?? strings.value.moreFallback
})

const childAxis = computed(() =>
	drawerChildAxis(props.context.surface.axis === 'vertical' ? 'vertical' : 'horizontal')
)
const childRegion = computed<PaletteRegion>(() => drawerChildRegion(childAxis.value))

const childTrack = computed<Track>(() =>
	isDrawerItem(props.context.item) ? props.context.item.toolbar : []
)

function close(): void {
	if (!open.value) return
	open.value = false
	depth.value = 0
	const popup = popupRef.value
	if (popup) {
		popup.hidden = true
		popup.style.zIndex = ''
		popup.style.setProperty('--region', childRegion.value)
	}
	triggerRef.value?.setAttribute('aria-expanded', 'false')
	props.context.onCloseDrawer?.(props.context.item, triggerRef.value as HTMLElement)
}

function openPopup(): void {
	const wrapper = wrapperRef.value
	const popup = popupRef.value
	// Depth = nesting level (1 = top-level, 2 = nested, …).
	let level = 1
	let ancestor = wrapper?.parentElement?.closest('.palettable-drawer') ?? null
	while (ancestor !== null) {
		level += 1
		ancestor = ancestor.parentElement?.closest('.palettable-drawer') ?? null
	}
	depth.value = level
	open.value = true
	if (popup) {
		popup.hidden = false
		popup.style.zIndex = String(210 + level)
		// Center-seeking placement: stamp the content half on the popup's
		// own `--region` from live geometry; skipped on zero rects
		// (jsdom/detached) where the pre-measure defaults stand.
		const liveIde = wrapper?.closest('.palette-ide') ?? document.body
		const liveIdeRect = liveIde.getBoundingClientRect()
		const ideRect =
			liveIdeRect.width > 0 && liveIdeRect.height > 0 ? liveIdeRect : null
		const liveWrapperRect = wrapper?.getBoundingClientRect()
		const triggerRect =
			liveWrapperRect && liveWrapperRect.width > 0 && liveWrapperRect.height > 0
				? liveWrapperRect
				: null
		if (ideRect !== null && triggerRect !== null) {
			const horizontal = props.context.surface.axis === 'horizontal'
			const triggerCenter = horizontal
				? triggerRect.left + triggerRect.width / 2
				: triggerRect.top + triggerRect.height / 2
			const ideCenter = horizontal
				? ideRect.left + ideRect.width / 2
				: ideRect.top + ideRect.height / 2
			popup.style.setProperty(
				'--region',
				drawerChildRegionFor(horizontal ? 'horizontal' : 'vertical', triggerCenter, ideCenter)
			)
		} else {
			popup.style.setProperty('--region', childRegion.value)
		}
	}
	triggerRef.value?.setAttribute('aria-expanded', 'true')
	if (props.context.surface.axis !== 'both') {
		props.context.onOpenDrawer?.(
			props.context.item,
			triggerRef.value as HTMLElement,
			popup as HTMLElement,
			props.context.surface.axis
		)
	}
}

function onTriggerClick(event: MouseEvent): void {
	// Toggle mode: pointer clicks are owned by the pointerdown toggle —
	// only synthetic clicks (`detail === 0`: tests, keyboard fallback)
	// toggle here to avoid a double toggle.
	if (openMode.value !== 'toggle' || event.detail !== 0) return
	if (open.value) close()
	else openPopup()
}

function onTriggerPointerdown(event: PointerEvent): void {
	if (openMode.value !== 'toggle') return
	// Primary button only: right/middle presses must not toggle.
	if (event.button !== 0) return
	if (open.value) close()
	else openPopup()
}

let hoverCloseTimer: ReturnType<typeof setTimeout> | undefined
function cancelHoverClose(): void {
	if (hoverCloseTimer !== undefined) {
		clearTimeout(hoverCloseTimer)
		hoverCloseTimer = undefined
	}
}
function scheduleHoverClose(): void {
	cancelHoverClose()
	hoverCloseTimer = setTimeout(() => {
		hoverCloseTimer = undefined
		close()
	}, configuration.drawerHoverCloseMs)
}

function onTriggerMouseenter(): void {
	if (openMode.value !== 'hover') return
	cancelHoverClose()
	openPopup()
}

function onDragHover(event: Event): void {
	if ((event as CustomEvent<ToolbarItem>).detail !== props.context.item) return
	if (props.context.isEditing?.() !== true) return
	if (openMode.value === 'hover') cancelHoverClose()
	openPopup()
}

function onWrapperPointerover(): void {
	if (props.context.isEditing?.() !== true) return
	if (props.context.isDragging?.() === true) return
	if (openMode.value === 'hover') cancelHoverClose()
	openPopup()
}

function onPopupPointerover(): void {
	if (props.context.isEditing?.() !== true) return
	openPopup()
}

function onActivate(event: Event): void {
	event.stopPropagation()
	const chain: DrawerChainEntry[] = []
	const closers: (() => void)[] = []
	let node: HTMLElement | null = wrapperRef.value ?? null
	while (node !== null) {
		const expando = node as HTMLElement & {
			__closeDrawer?: () => void
			__drawerCloseOnClick?: boolean
			__drawerOpenMode?: 'hover' | 'toggle'
		}
		if (typeof expando.__closeDrawer === 'function') {
			chain.push({
				close: expando.__closeDrawer,
				closeOnClick: expando.__drawerCloseOnClick === true,
				openMode: expando.__drawerOpenMode === 'hover' ? 'hover' : 'toggle',
			})
			closers.push(expando.__closeDrawer)
		}
		node = node.parentElement?.closest('.palettable-drawer') ?? null
	}
	for (const index of drawerCloseChainIndices(chain)) closers[index]?.()
}

function onDocumentClick(event: MouseEvent): void {
	const wrapper = wrapperRef.value
	if (!wrapper?.isConnected) {
		cleanupGlobal()
		return
	}
	if (!open.value || popupRef.value?.hidden !== false) return
	if (wrapper.contains(event.target as Node | null)) return
	close()
}

function onEscape(event: KeyboardEvent): void {
	const wrapper = wrapperRef.value
	if (!wrapper?.isConnected) {
		cleanupGlobal()
		return
	}
	if (event.key !== 'Escape' || !open.value) return
	event.stopPropagation()
	close()
	triggerRef.value?.focus()
}

function cleanupGlobal(): void {
	document.removeEventListener('click', onDocumentClick, true)
	window.removeEventListener('keydown', onEscape, true)
}

document.addEventListener('click', onDocumentClick, true)
window.addEventListener('keydown', onEscape, true)

onBeforeUnmount(() => {
	cleanupGlobal()
	if (hoverCloseTimer !== undefined) clearTimeout(hoverCloseTimer)
})

function exposeClose(): void {
	const wrapper = wrapperRef.value
	if (!wrapper) return
	const expando = wrapper as HTMLElement & {
		__closeDrawer?: () => void
		__openDrawer?: () => void
		__drawerCloseOnClick?: boolean
		__drawerOpenMode?: 'hover' | 'toggle'
	}
	expando.__closeDrawer = () => close()
	expando.__openDrawer = () => {
		if (openMode.value === 'hover') cancelHoverClose()
		openPopup()
	}
	expando.__drawerCloseOnClick = closeOnClick.value
	expando.__drawerOpenMode = openMode.value
}
</script>

<template>
	<div
		ref="wrapper"
		class="palettable-drawer"
		@palettable-drawer-drag-hover="onDragHover"
		@pointerover="onWrapperPointerover"
		@palettable-drawer-item-activate="onActivate"
		@vue:mounted="exposeClose"
		@vue:updated="exposeClose"
	>
		<button
			ref="trigger"
			type="button"
			class="palette-default-tool palettable-drawer__trigger"
			:class="[`palette-default-tone-${tone}`, `is-open-${openMode}`]"
			:aria-label="accessibleName"
			aria-expanded="false"
			aria-haspopup="true"
			:title="accessibleName"
			@click="onTriggerClick"
			@pointerdown="onTriggerPointerdown"
			@mouseenter="onTriggerMouseenter"
			@mouseleave="openMode === 'hover' ? scheduleHoverClose() : undefined"
		><span v-if="triggerIcon !== undefined" class="palette-default-icon">{{ triggerIcon }}</span><span class="palette-default-drawer-chevron" aria-hidden="true">▸</span></button>
		<div
			ref="popup"
			class="palettable-drawer__popup"
			:style="`--layout: ${childAxis}; --region: ${childRegion};`"
			role="dialog"
			tabindex="-1"
			hidden=""
			@mouseenter="openMode === 'hover' ? cancelHoverClose() : undefined"
			@mouseleave="openMode === 'hover' ? scheduleHoverClose() : undefined"
			@pointerover="onPopupPointerover"
		><slot
			name="drawer-track"
			:track="childTrack"
			:axis="childAxis"
			:region="childRegion"
		><component
			v-if="renderToolbar !== undefined"
			:is="renderToolbar(childTrack, childAxis, childRegion)"
		/></slot></div>
	</div>
</template>
