<script lang="ts">
	import type { PaletteBorders } from '$lib/palette/types'

	let { borders }: { borders: PaletteBorders } = $props()
	const trackCount = $derived(borders.top.length)
</script>

<span>tracks:{trackCount}</span>
