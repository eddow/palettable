<script lang="ts">
	import { paletteCommandBoxModel } from '$lib/palette/edition.svelte'

	let { onModel }: { onModel: (model: ReturnType<typeof paletteCommandBoxModel>) => void } =
		$props()
	const source = $state({ useWide: false })
	const model = paletteCommandBoxModel({
		entries: () =>
			source.useWide
				? [
						{ id: 'alpha', label: 'Alpha', keywords: ['shared'], run() {} },
						{ id: 'beta', label: 'Beta', keywords: ['shared'], run() {} }
					]
				: [{ id: 'alpha', label: 'Alpha', keywords: ['shared'], run() {} }]
	})
	$effect(() => {
		onModel(model)
	})
</script>

<button onclick={() => (source.useWide = true)}>widen</button>
