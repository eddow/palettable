<script lang="ts">
	import Parking from '$lib/palette/components/Parking.svelte'
	import type { Palette as PaletteRuntime } from '$lib/palette/palette.svelte'
	import type { PaletteParking, PaletteScope } from '$lib/palette/types'

	let {
		palette,
		parking
	}: {
		palette: PaletteRuntime
		parking: PaletteParking
	} = $props()
	const scope = $derived<PaletteScope>({ palette })
</script>

<Parking {parking} {palette} {scope} />
