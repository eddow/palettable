<script lang="ts">
	import Ide from '$lib/palette/components/Ide.svelte'
	import type { Palette as PaletteRuntime } from '$lib/palette/palette.svelte'
	import type { PaletteBorder } from '$lib/palette/types'

	let { palette, top }: { palette: PaletteRuntime; top: PaletteBorder } = $props()
</script>

<Ide {palette} {top}>
	<div data-testid="ide-center">center</div>
</Ide>
