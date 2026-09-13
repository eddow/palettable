<script lang="ts">
	import {
		type PaletteEditorContext,
		type PaletteSchema,
		type PaletteToolbarItem,
		type PaletteToolEnum, 
		selectPresenter
	} from '$lib/palette/core.svelte'

	type Props = {
		context: PaletteEditorContext<PaletteToolEnum<string>, PaletteToolbarItem, PaletteSchema>
		onChange?: (value: string) => void
	}

	let { context, onChange }: Props = $props()
	const view = $derived(selectPresenter(context))
</script>

<div
	class={[
		'palette-default-segmented',
		`palette-default-tone-${view.tone}`,
		`palette-default-layout-${view.direction}`
	]}
	title={view.title}
>
	{#each view.options as option (option.value)}
		<button
			type="button"
			class={[
				'palette-default-tool',
				'palette-default-tool-compact',
				view.value === option.value ? 'is-selected' : undefined
			]}
			disabled={!option.can || view.value === option.value}
			title={option.text}
			onclick={() => {
				view.select(option.value)
				onChange?.(option.value)
			}}
		>
			<span class="palette-default-choice">{option.text}</span>
		</button>
	{/each}
</div>
