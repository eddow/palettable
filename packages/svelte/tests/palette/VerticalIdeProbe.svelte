<script lang="ts">
	import Ide from '$lib/palette/components/Ide.svelte'
	import type { Palette as PaletteRuntime } from '$lib/palette/palette.svelte'
	import type { PaletteBorder } from '$lib/palette/types'

	let { palette, left }: { palette: PaletteRuntime; left: PaletteBorder } = $props()

	// Own the border in `$state` so the layout mutations made by the drag
	// engine re-render the Ide (faithful to the production demo, which wraps
	// its borders in `$state`). A plain prop array would stay reactive only
	// inside the engine, never re-rendering the guards/items between drags.
	// The prop is copied once at init (not tracked); the test mutates the
	// `$state` copy, not the prop.
	const border = $state<PaletteBorder>(structuredClone(left))
</script>

<Ide {palette} left={border}>
	<div data-testid="ide-center">center</div>
</Ide>
