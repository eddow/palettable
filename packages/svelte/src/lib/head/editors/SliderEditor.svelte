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
		/** Show a trailing numeric value badge (demo override uses this). */
		showValue?: boolean
	}

	let { context, onChange, showValue = false }: Props = $props()
	const view = $derived(sliderPresenter(context))
</script>

<label
	class={[
		'palette-default-slider',
		showValue ? 'palette-default-slider-badged' : undefined,
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
	{#if showValue}
		<span class="palette-default-slider-badge">{view.value}</span>
	{/if}
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
