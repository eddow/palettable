<script lang="ts">
	import type { Component } from 'svelte'
	import { icons } from './icons.svelte'

	interface Props {
		/**
		 * Icon value: a string name (resolved through the icon factory) or a Svelte
		 * component. Snippets are not rendered here — render them with `{@render}`
		 * directly at the call site.
		 */
		icon?: string | Component
		/** Optional size, passed through to the icon factory. */
		size?: string | number
	}

	let { icon, size }: Props = $props()

	/** The string name, when `icon` is a string. */
	const name = $derived(typeof icon === 'string' ? icon : undefined)

	/** The resolved component: a direct component, or the factory result for a string name. */
	const IconComponent = $derived.by((): Component | undefined => {
		if (typeof icon !== 'string') return icon
		return icons.factory?.(icon, size)
	})
</script>

{#if IconComponent}
	<IconComponent />
{:else if name !== undefined}
	<span data-icon={name}>{name}</span>
{/if}
