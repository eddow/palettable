<script lang="ts">
	import { SliderEditor as HeadSliderEditor } from '$lib/head/registry'
	import type {
		PaletteEditorContext,
		PaletteSchema,
		PaletteToolbarItem,
		PaletteToolNumber
	} from '$lib/palette/core.svelte'

	type Props = {
		context: PaletteEditorContext<PaletteToolNumber, PaletteToolbarItem, PaletteSchema>
		onChange?: (value: number) => void
	}

	let { context, onChange }: Props = $props()
</script>

<!--
	Demo override: the shared head slider with the value badge forced on.
	Proves the override mechanism (same `number.slider` key, demo spread last).
-->
<HeadSliderEditor {context} {onChange} showValue />
