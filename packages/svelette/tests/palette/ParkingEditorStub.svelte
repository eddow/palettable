<button id="parked-run" onclick={() => run()}>Run</button>

<script lang="ts">
	let { context }: { context: { tool: { run: () => void } } } = $props()
	const run = $derived(context.tool.run)
</script>
