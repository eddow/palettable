<script lang="ts">
	import {
		type PaletteEditorContext,
		type PaletteSchema,
		type PaletteToolbarItem,
		type PaletteToolNumber, 
		sliderPresenter
	} from '$lib/palette/core.svelte'

	type Props = {
		context: PaletteEditorContext<PaletteToolNumber, PaletteToolbarItem, PaletteSchema>
		onChange?: (value: number) => void
	}

	let { context, onChange }: Props = $props()
	const view = $derived(sliderPresenter(context))
</script>

<!--
	Demo override: same variant key (`number.slider`) as the default head, so the
	per-family merge `{ ...headEditors.number, ...demoEditors.number }` replaces the
	head's slider. Visually distinct from the head: a trailing numeric value badge.
-->
<label
	class={[
		'palette-default-slider',
		'palette-default-slider-badged',
		`palette-default-tone-${view.tone}`,
		`palette-default-layout-${view.direction}`,
		`palette-default-region-${view.region}`
	]}
	title={view.title}
>
	<span class="palette-default-icon">{view.icon}</span>
	<input
		type="range"
		min={String(view.min)}
		max={String(view.max)}
		step={String(view.step)}
		value={String(view.value)}
		oninput={(event) => {
			const next = Number((event.currentTarget as HTMLInputElement).value)
			view.set(next)
			onChange?.(next)
		}}
	/>
	<span class="palette-default-slider-badge">{view.value}</span>
</label>

<style>
	.palette-default-slider-badge {
		min-width: 1.5em;
		text-align: center;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		opacity: 0.9;
	}
</style>
