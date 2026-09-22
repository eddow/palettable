<script lang="ts">
	import { paletteRoot } from '$lib/palette/edition.svelte'
	import type { Palette as PaletteRuntime } from '$lib/palette/palette.svelte'

	let { palette }: { palette: PaletteRuntime } = $props()
</script>

<div data-testid="palette-root" use:paletteRoot={palette}></div>
