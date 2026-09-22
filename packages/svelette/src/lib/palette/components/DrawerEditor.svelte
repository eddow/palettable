<script lang="ts">
	import { mount, unmount } from 'svelte'
	import type { SvelteHTMLElements } from 'svelte/elements'
	import { configuration } from '../configuration'
	import { getDrawerPortalContainer, paletteDrawerCollapse } from '../drawer-editor.svelte'
	import type {
		PaletteDrawerToolbarItem,
		PaletteEditorContext,
		PaletteRegion,
		PaletteToolbar,
		PaletteToolbarItem
	} from '../types'
	import DrawerPopup from './DrawerPopup.svelte'

	type Props = {
		context: PaletteEditorContext<undefined, PaletteToolbarItem>
		el?: SvelteHTMLElements['button']
	}

	let { context, el }: Props = $props()

	type DrawerItem = PaletteDrawerToolbarItem & { toolbar: PaletteToolbar }
	function resolveDrawerItem(item: PaletteToolbarItem): DrawerItem | undefined {
		if (item.editor !== 'drawer') return undefined
		const drawer = item as Partial<DrawerItem>
		if (!Array.isArray(drawer.toolbar)) return undefined
		return item as DrawerItem
	}

	const item = $derived(resolveDrawerItem(context.item))
	const config = $derived((item?.config ?? {}) as Record<string, unknown>)
	const icon = $derived(typeof config.icon === 'string' ? config.icon : undefined)
	const label = $derived(typeof config.label === 'string' ? config.label : '')
	const hint = $derived(typeof config.hint === 'string' ? config.hint : undefined)
	const tone = $derived(config.tone === 'accent' ? 'accent' : 'neutral')
	const openMode = $derived(
		config.open === 'hover' || config.open === 'press' ? config.open : 'click'
	)
	const placement = $derived(
		config.placement === 'start' || config.placement === 'end' ? config.placement : 'center'
	)

	// Perpendicular-direction contract: invert the parent axis for the child
	// toolbar; the child region follows so nested drawers continue the pattern.
	const parentAxis = $derived(context.surface?.axis === 'vertical' ? 'vertical' : 'horizontal')
	const childDirection = $derived<'horizontal' | 'vertical'>(
		parentAxis === 'vertical' ? 'horizontal' : 'vertical'
	)
	const childRegion = $derived<PaletteRegion>(childDirection === 'vertical' ? 'left' : 'top')

	let open = $state(false)
	let trigger = $state<HTMLButtonElement | undefined>(undefined)
	let popupPos = $state({ left: 0, top: 0 })

	function syncPopup() {
		// `parentAxis` is read inside try/catch so jsdom's throwing
		// `getBoundingClientRect` (or a detached trigger) can never break the
		// portal effect — position falls back to the last known `popupPos`.
		// `popupPos` is only assigned when the rect actually changed: the
		// portal `$effect` calls `syncPopup()` on every run, and writing the
		// same `$state` unconditionally would re-trigger the effect forever
		// (`effect_update_depth_exceeded`).
		try {
			const axis = parentAxis
			if (!trigger || typeof trigger.getBoundingClientRect !== 'function') return
			const rect = trigger.getBoundingClientRect()
			if (!rect || typeof rect.left !== 'number' || typeof rect.top !== 'number') return
			const offset = 6
			const next =
				axis === 'vertical'
					? { left: (rect.right ?? 0) + offset, top: rect.top }
					: { left: rect.left, top: (rect.bottom ?? 0) + offset }
			if (next.left !== popupPos.left || next.top !== popupPos.top) popupPos = next
		} catch {
			return
		}
	}

	function close() {
		open = false
	}

	function toggle() {
		if (!open) syncPopup()
		open = !open
	}

	// `open: 'hover'` keeps the portal open while the pointer travels from the
	// trigger to the body-portaled popup: leaving the trigger schedules a
	// close that entering the popup cancels (and vice versa). `click`/`press`
	// modes ignore hover entirely.
	let hoverCloseTimer: ReturnType<typeof setTimeout> | undefined
	function cancelHoverClose() {
		if (hoverCloseTimer !== undefined) {
			clearTimeout(hoverCloseTimer)
			hoverCloseTimer = undefined
		}
	}
	function scheduleHoverClose() {
		cancelHoverClose()
		hoverCloseTimer = setTimeout(() => {
			hoverCloseTimer = undefined
			open = false
		}, configuration.drawerHoverCloseMs)
	}

	// Shared collapse signal: any bump of `paletteDrawerCollapse.version`
	// closes this drawer (consumers bump it when switching modes, etc.).
	// `seenVersion` is plain (non-reactive) state: the effect subscribes to
	// `version` only, seeds on first run, and closes on later bumps.
	let seenVersion: number | undefined
	$effect(() => {
		const version = paletteDrawerCollapse.version
		if (seenVersion === undefined) {
			seenVersion = version
			return
		}
		if (version !== seenVersion) {
			seenVersion = version
			open = false
		}
	})

	// Portal lifecycle: `mount` the popup into `document.body` (or the factory
	// `portalContainer`) while open; `unmount` + `host.remove()` on teardown.
	// The popup builds its scope from `palette` + child `region` and binds it
	// to the child `Toolbar`, so nested drawers resolve tools and invert their
	// own axis correctly. `open` is read up-front so the effect re-runs (and
	// disposes the portal) when the drawer closes.
	// `pos` passes the shared `$state` object itself (not `left`/`top` snapshots):
	// resize/scroll repositioning re-renders the popup in place instead of
	// unmounting + remounting it (which would lose nested-drawer state).
	$effect(() => {
		const isOpen = open
		const currentItem = item
		if (!isOpen || !currentItem) return
		const scopePalette = context.scope.palette
		if (!scopePalette) return
		syncPopup()
		const host = document.createElement('div')
		const container = getDrawerPortalContainer() ?? document.body
		container.appendChild(host)
		const app = mount(DrawerPopup, {
			target: host,
			props: {
				palette: scopePalette as never,
				toolbar: currentItem.toolbar,
				direction: childDirection,
				region: childRegion,
				pos: popupPos,
				placement,
				onClose: close,
				onPopupEnter: openMode === 'hover' ? cancelHoverClose : undefined,
				onPopupLeave: openMode === 'hover' ? scheduleHoverClose : undefined
			}
		})
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			close()
			trigger?.focus()
		}
		const onLayout = () => syncPopup()
		window.addEventListener('resize', onLayout)
		window.addEventListener('scroll', onLayout, true)
		window.addEventListener('keydown', onKey)
		return () => {
			window.removeEventListener('resize', onLayout)
			window.removeEventListener('scroll', onLayout, true)
			window.removeEventListener('keydown', onKey)
			unmount(app)
			host.remove()
		}
	})
</script>

{#if item}
	<button
		{...el}
		bind:this={trigger}
		type="button"
		class={[
			'palette-default-tool',
			`palette-default-tone-${tone}`,
			'palettable-drawer__trigger',
			el?.class
		]}
		aria-label={label || hint}
		aria-expanded={open ? 'true' : 'false'}
		aria-haspopup="true"
		title={hint ?? label}
		onclick={openMode === 'click' ? toggle : undefined}
		onpointerdown={openMode === 'press' ? toggle : undefined}
		onmouseenter={openMode === 'hover'
			? () => {
					cancelHoverClose()
					syncPopup()
					open = true
				}
			: undefined}
		onmouseleave={openMode === 'hover' ? () => scheduleHoverClose() : undefined}
	>
		{#if icon}
			<span class="palette-default-icon">{icon}</span>
		{/if}
		{#if label}
			<span>{label}</span>
		{/if}
		<span class="palette-default-drawer-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
	</button>
{/if}
