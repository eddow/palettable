<script lang="ts">
	import {
		type PaletteEditorContext,
		type PaletteSchema,
		type PaletteToolbarItem,
		statusPresenter
	} from '$lib/palette/core.svelte'

	type Props = {
		context: PaletteEditorContext<undefined, PaletteToolbarItem, PaletteSchema>
	}

	let { context }: Props = $props()
	const view = $derived(statusPresenter(context))
</script>

<!--
	Pointless status tool: a read-only label/value span. It binds no point —
	display text comes from the item `config` (`value`, falling back to `label`).
-->
<span class={['palette-default-status', `palette-default-tone-${view.tone}`]} title={view.title}>
	{#if view.icon}
		<span class="palette-default-icon">{view.icon}</span>
	{/if}
	<span class="palette-default-status-value">{view.value}</span>
</span>
