<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { SvelteHTMLElements } from 'svelte/elements'
	import { paletteRoot } from '../layout.svelte'
	import type { Palette as PaletteRuntime } from '../palette.svelte'
	import { palettes } from '../palette.svelte'
	import type { PaletteBorder, PaletteScope } from '../types'
	import ToolbarBorder from './ToolbarBorder.svelte'

	type Props = {
		palette: PaletteRuntime
		top?: PaletteBorder
		right?: PaletteBorder
		bottom?: PaletteBorder
		left?: PaletteBorder
		el?: SvelteHTMLElements['div']
		center?: SvelteHTMLElements['div']
		border?: SvelteHTMLElements['div']
		track?: SvelteHTMLElements['div']
		space?: SvelteHTMLElements['div']
		toolbar?: SvelteHTMLElements['div']
		children?: Snippet
	}

	let {
		palette,
		top,
		right,
		bottom,
		left,
		el,
		center,
		border,
		track,
		space,
		toolbar,
		children
	}: Props = $props()

	// The scope record is the serializable payload editors read (`palette` +
	// `region`); children stamp `region` at the border level. `$derived` keeps
	// it reactive if the `palette` prop changes without recreating it per render.
	const scope = $derived<PaletteScope>({ palette })

	// Modal-mask hover: while editing + dragging, a pointer over the center
	// (the dimmed work-zone / console overlay background, i.e. NOT over a
	// border and NOT inside the dialog panel) shows the 4 most-inner stack
	// DZs — one per border, each at its end closest to the center
	// (`border.length` in every region: bottom-most of top, top-most of
	// bottom, right-most of left, left-most of right). Each `ToolbarBorder`
	// highlights its own inner stack when `maskActive` is set.
	let maskHover = $state(false)
	const isDragging = $derived(palettes.dragging?.palette === palette)

	function onIdePointerMove(event: PointerEvent): void {
		if (!palette.editing || !isDragging) {
			maskHover = false
			return
		}
		const target = event.target
		if (!(target instanceof HTMLElement)) {
			maskHover = false
			return
		}
		// Over a border → the border owns the highlight, not the mask.
		if (target.closest('.toolbar-border')) {
			maskHover = false
			return
		}
		// On the modal itself (console panel, drawer popup, native dialog)
		// → neither border nor mask. Note: the console overlay background
		// itself carries `role="dialog"`, so it must NOT be excluded — only
		// the panel counts as modal; the overlay background is the mask.
		if (target.closest('.palette-default-command-panel, .svelette-palette-drawer__popup, dialog')) {
			maskHover = false
			return
		}
		maskHover = true
	}

	function onIdePointerLeave(): void {
		maskHover = false
	}

	$effect(() => {
		if (!palette.editing || !isDragging) maskHover = false
	})
</script>

<div
	{...el}
	class={['palette-ide', el?.class]}
	data-palette-id={palette.id}
	use:paletteRoot={palette}
	onpointermove={onIdePointerMove}
	onpointerleave={onIdePointerLeave}
>
	{#if top !== undefined}
		<ToolbarBorder
			border={top}
			direction="horizontal"
			region="top"
			{palette}
			{scope}
			el={border}
			{track}
			{space}
			{toolbar}
			maskActive={maskHover}
		/>
	{/if}
	<div class="palette-ide-middle">
		{#if left !== undefined}
			<ToolbarBorder
				border={left}
				direction="vertical"
				region="left"
				{palette}
				{scope}
				el={border}
				{track}
				{space}
				{toolbar}
				maskActive={maskHover}
			/>
		{/if}
		<div {...center} class={['palette-ide-center', center?.class]}>
			{@render children?.()}
		</div>
		{#if right !== undefined}
			<ToolbarBorder
				border={right}
				inverse={true}
				direction="vertical"
				region="right"
				{palette}
				{scope}
				el={border}
				{track}
				{space}
				{toolbar}
				maskActive={maskHover}
			/>
		{/if}
	</div>
	{#if bottom !== undefined}
		<ToolbarBorder
			border={bottom}
			inverse={true}
			direction="horizontal"
			region="bottom"
			{palette}
			{scope}
			el={border}
			{track}
			{space}
			{toolbar}
			maskActive={maskHover}
		/>
	{/if}
</div>
