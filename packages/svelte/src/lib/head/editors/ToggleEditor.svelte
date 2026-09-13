<script lang="ts">
	import {
		type PaletteEditorContext,
		type PaletteSchema,
		type PaletteToolBool,
		type PaletteToolbarItem, 
		togglePresenter
	} from '$lib/palette/core.svelte'

	type Props = {
		context: PaletteEditorContext<PaletteToolBool, PaletteToolbarItem, PaletteSchema>
		onToggle?: (value: boolean) => void
	}

	let { context, onToggle }: Props = $props()
	const view = $derived(togglePresenter(context))
</script>

<button
	type="button"
	class={[
		'palette-default-tool',
		'palette-default-tool-compact',
		`palette-default-tone-${view.tone}`,
		view.pressed ? 'is-selected' : undefined
	]}
	title={view.title}
	onclick={() => {
		const next = view.toggle()
		onToggle?.(next)
	}}
>
	<span class="palette-default-icon">{view.icon}</span>
</button>
