<script lang="ts">
	import ToolbarBorder from '$lib/palette/components/ToolbarBorder.svelte'
	import type { Palette as PaletteRuntime } from '$lib/palette/palette.svelte'
	import type { PaletteBorder, PaletteScope } from '$lib/palette/types'

	let { palette, border }: { palette: PaletteRuntime; border: PaletteBorder } = $props()
	const scope = $derived<PaletteScope>({ palette })
</script>

<ToolbarBorder {border} direction="horizontal" region="top" {palette} {scope} />
