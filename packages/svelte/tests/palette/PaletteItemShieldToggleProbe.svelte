<script lang="ts">
	import PaletteItemShieldProbe from './PaletteItemShieldProbe.svelte'

	let { initial }: { initial: boolean } = $props()
	// svelte-ignore state_referenced_locally
	let active = $state(initial)
</script>

<button type="button" data-testid="toggle-btn" onclick={() => (active = !active)}>toggle</button>
<PaletteItemShieldProbe {active} />
