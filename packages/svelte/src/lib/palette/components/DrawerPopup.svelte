<script lang="ts">
	import type { Palette as PaletteRuntime } from '../palette.svelte'
	import type { PaletteRegion, PaletteScope, PaletteToolbar } from '../types'
	import Toolbar from './Toolbar.svelte'

	type Props = {
		palette: PaletteRuntime
		toolbar: PaletteToolbar
		direction: 'horizontal' | 'vertical'
		region: PaletteRegion
		pos: { left: number; top: number }
		placement: 'start' | 'center' | 'end'
		onClose: () => void
		onPopupEnter?: () => void
		onPopupLeave?: () => void
	}

	let {
		palette,
		toolbar,
		direction,
		region,
		pos,
		placement,
		onClose,
		onPopupEnter,
		onPopupLeave
	}: Props = $props()

	// Child toolbar reads `palette` + `region` off this scope object (passed
	// by `DrawerEditor`'s portal via `mount` props).
	const scope = $derived<PaletteScope>({ palette, region })
</script>

<div
	class="svelette-palette-drawer__overlay"
	role="presentation"
	onclick={() => onClose()}
	onkeydown={(event) => {
		if (event.key === 'Escape') onClose()
	}}
>
	<div
		class={['svelette-palette-drawer__popup', `is-${direction}`]}
		data-placement={placement}
		style:left={`${pos.left}px`}
		style:top={`${pos.top}px`}
		role="dialog"
		tabindex={-1}
		onclick={(event) => event.stopPropagation()}
		onkeydown={(event) => event.stopPropagation()}
		onmouseenter={() => onPopupEnter?.()}
		onmouseleave={() => onPopupLeave?.()}
	>
		<Toolbar {toolbar} {direction} {palette} {scope} {region} />
	</div>
</div>
