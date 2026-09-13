<script lang="ts">
	import { paletteItemShield } from '$lib/palette/edition.svelte'

	let { active }: { active: boolean } = $props()
</script>

<div data-testid="shielded" use:paletteItemShield={active}>content</div>
