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
		/** Number of rating steps to render (defaults to the tool's `max`). */
		maximum?: number
		onChange?: (value: number) => void
	}

	let { context, maximum, onChange }: Props = $props()
	const view = $derived(sliderPresenter(context))
	const steps = $derived(Array.from({ length: maximum ?? view.max }, (_, index) => index + 1))
</script>

<!--
	Demo extension: a new `number` variant the head lacks — a play/rating row of
	"▶"/"▷" triangles. Proves custom heads can EXTEND the map (unlike the slider
	override, which replaces a head variant under the same key).
-->
<div
	class={[
		'palette-default-stars',
		`palette-default-tone-${view.tone}`,
		`palette-default-layout-${view.direction}`
	]}
	title={view.title}
>
	<span class="palette-default-icon">{view.icon}</span>
	<span
		class={['palette-default-stars-row', `palette-default-layout-${view.direction}`]}
		role="radiogroup"
	>
		{#each steps as index (index)}
			<button
				type="button"
				class={['palette-default-arrow', index <= view.value ? 'is-selected' : undefined]}
				role="radio"
				aria-checked={index === view.value}
				title={`${view.title} ${index}`}
				onclick={() => {
					view.set(index)
					onChange?.(index)
				}}
			>
				{index <= view.value ? '▶' : '▷'}
			</button>
		{/each}
	</span>
</div>
