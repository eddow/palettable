<script lang="ts">
	import type { PaletteItemDragTarget } from '$lib/palette/edition.svelte'
	import { paletteItemDrag } from '$lib/palette/edition.svelte'

	let { target }: { target: PaletteItemDragTarget } = $props()
</script>

<div data-testid="item-guard" use:paletteItemDrag={target}></div>
