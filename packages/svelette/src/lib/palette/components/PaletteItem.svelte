<script lang="ts">
	import type { Component } from 'svelte'
	import type { PaletteEditorContext } from '../types'

	type Props = {
		Editor: Component<{ context: PaletteEditorContext }>
		context: PaletteEditorContext
	}

	let { Editor, context }: Props = $props()
</script>

<Editor {context} />
