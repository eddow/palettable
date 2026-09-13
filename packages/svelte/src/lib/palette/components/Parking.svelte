<script lang="ts">
	import { tick } from 'svelte'
	import type { SvelteHTMLElements } from 'svelte/elements'
	import { createGapDwellState, GapDwell } from '../gap-dwell'
	import {
		commitDraggedToParkingRow,
		draggingEmptiesParkingRow,
		lastDragPointer,
		removeParkedToolbar,
		retargetToolbarSlide
	} from '../layout.svelte'
	import { type Palette as PaletteRuntime, palettes } from '../palette.svelte'
	import type { PaletteParking, PaletteScope, PaletteToolbar } from '../types'
	import Toolbar from './Toolbar.svelte'

	type Props = {
		/** Independent parking stack. Owns its toolbars outright — never a
		 * live border, never shared references (single ownership). */
		parking: PaletteParking
		palette: PaletteRuntime
		scope: PaletteScope
		el?: SvelteHTMLElements['div']
		space?: SvelteHTMLElements['div']
		toolbar?: SvelteHTMLElements['div']
		/** Console panel-background hover (the `Ide` mask analogue): while a
		 * drag is active and the pointer is over the console but outside the
		 * parking rows/gaps, keep the end gap lit so the stack reads as a
		 * drop target. */
		maskActive?: boolean
	}

	let { parking, palette, scope, el, space, toolbar, maskActive = false }: Props = $props()

	const isDragging = $derived(palettes.dragging?.palette === palette)

	// Stack DZs: the gaps between rows (gap0, gap1, …). They always exist as
	// zero-size stack spaces and are highlight-only: hovering a row
	// (including its toolbar/tools) highlights the two gaps flanking it;
	// hovering a gap directly highlights only that one. Gated on edit mode
	// AND active drag — no highlight (and no hover-state tracking) when not
	// dragging. Mirrors `ToolbarBorder`'s `activeTrack`/`hoveredStack` pair.
	// Parking is a plain `Stack<Toolbar>`: drops land via the toolbar
	// item-space DZs (`commitDraggedToParking`) or via the dwell-drop below —
	// never by hovering a gap alone.
	// Dwell-drop arming (one-shot timer + committed latch) lives in `GapDwell`.
	const dwellState = $state(createGapDwellState())
	const dwell = new GapDwell()

	// Parking rows show every toolbar except a command-box-only row (mirrors
	// the reference `popupParkingToolbars` filter): the stack itself is
	// untouched — only the *view* hides the launcher row.
	function visibleRows(stack: PaletteParking): { toolbar: PaletteToolbar; index: number }[] {
		return stack.flatMap((toolbarItems, index) => {
			const visible = toolbarItems.filter((item) => item.editor !== 'commandBox')
			return visible.length > 0 ? [{ toolbar: toolbarItems, index }] : []
		})
	}

	// Gap indices are real stack indices (`index + 1` after each visible row),
	// never filtered-view positions — hidden commandBox-only rows must not
	// collapse the numbering.
	function isParkingGapHighlighted(gapIndex: number): boolean {
		if (!palette.editing || !isDragging) return false
		// When the drag would empty the sole parking row, the two gaps
		// touching it are not candidates — dropping there would re-create the
		// same spot once the origin vanishes. Applies to direct hover too.
		const emptied = draggingEmptiesParkingRow(parking)
		if (emptied !== undefined && (gapIndex === emptied || gapIndex === emptied + 1)) return false
		// Console panel-background hover: show the end gap (gap 0 when empty,
		// else the gap after the last row) so the stack reads as a target.
		if (maskActive) return gapIndex === parking.length
		if (dwellState.hovered !== undefined) return gapIndex === dwellState.hovered
		if (dwellState.active === undefined) return false
		return gapIndex === dwellState.active || gapIndex === dwellState.active + 1
	}

	function isParkingGapHovered(gapIndex: number): boolean {
		if (!palette.editing || !isDragging) return false
		return dwellState.hovered === gapIndex
	}

	function onParkingPointerMove(event: PointerEvent): void {
		if (!palette.editing || !isDragging) {
			dwell.reset(dwellState)
			return
		}
		const target = event.target
		if (!(target instanceof HTMLElement)) return
		// Inside a toolbar → that toolbar owns the item-space DZs.
		if (target.closest('.toolbar')) return
		const gapEl = target.closest('[data-parking-gap-index]')
		if (
			gapEl &&
			event.currentTarget instanceof HTMLElement &&
			event.currentTarget.contains(gapEl)
		) {
			const index = Number(gapEl.getAttribute('data-parking-gap-index'))
			dwell.hoverGap(dwellState, Number.isInteger(index) ? index : undefined)
			return
		}
		const rowEl = target.closest('[data-parking-row-index]')
		if (!rowEl || !(event.currentTarget instanceof HTMLElement)) {
			dwell.hoverRow(dwellState, undefined)
			return
		}
		const index = Number(rowEl.getAttribute('data-parking-row-index'))
		dwell.hoverRow(dwellState, Number.isInteger(index) ? index : undefined)
	}

	function onParkingPointerLeave(): void {
		dwell.reset(dwellState)
	}

	$effect(() => {
		if (!palette.editing || !isDragging) dwell.reset(dwellState)
	})

	// One-shot hover-dwell arming (see `GapDwell`): retargeting to another gap
	// restarts the timer (the cleanup clears the previous one), leaving the
	// gap or ending the drag cancels it. The fire re-checks the hover is still
	// on the arming gap before committing, then arms slide-follow over the
	// fresh row once it has flushed.
	$effect(() => {
		// Subscribe to the dwell state + drag/mask so retargeting re-arms.
		const hovered = dwellState.hovered
		void hovered
		const dragging = isDragging
		const editing = palette.editing
		const masked = maskActive
		return dwell.arm(dwellState, {
			editing,
			dragging,
			masked,
			canArm: (gap) => isParkingGapHighlighted(gap),
			onFire: (targetGap) => {
				void (async () => {
					const targetParking = parking
					if (palettes.dragging?.palette !== palette) return
					if (!palette.editing) return
					const pointer = lastDragPointer()
					const committed = commitDraggedToParkingRow(targetParking, targetGap)
					if (!committed) return
					// The commit promotes a restructure into a slide over the
					// fresh row — arm slide-follow once it has flushed so the
					// row sticks under the cursor. `recenter` grabs the fresh
					// row by its middle when the drag has no mousedown grab
					// delta yet; a whole-toolbar slide keeps its grab delta.
					await tick()
					if (dwellState.hovered !== targetGap) return
					if (palettes.dragging?.palette !== palette) return
					const live = palettes.dragging
					if (live?.origin.kind !== 'parking') return
					const placed = live.origin.toolbar
					const at = live.origin.index
					const element = document.querySelector(
						`[data-palette-id="${palette.id}"][data-container="parking"] [data-parking-row-index="${at}"] .toolbar`
					)
					if (!(element instanceof HTMLElement)) return
					retargetToolbarSlide({
						track: [{ space: 0, toolbar: placed }],
						toolbar: placed,
						toolbarElement: element,
						direction: 'horizontal',
						clientX: pointer.x,
						clientY: pointer.y,
						recenter: live.grabOffset === undefined
					})
				})()
			}
		})
	})
</script>

<div
	{...el}
	class={['palette-parking palette-horizontal stack-vertical', el?.class]}
	data-palette-id={palette.id}
	data-container="parking"
	onpointermove={onParkingPointerMove}
	onpointerleave={onParkingPointerLeave}
>
	<div
		{...space}
		class={[
			'toolbar-stack-space toolbar-drop-zone',
			isParkingGapHighlighted(0) ? 'highlighted' : undefined,
			isParkingGapHovered(0) ? 'hovered' : undefined,
			space?.class
		]}
		data-palette-id={palette.id}
		data-parking-gap-index={0}
	></div>
	{#each visibleRows(parking) as { toolbar: toolbarItems, index } (toolbarItems)}
		<div class="palette-parking-row" data-parking-row-index={index}>
			{#if palette.editing}
				<button
					type="button"
					class="palette-parking-remove"
					aria-label="Delete toolbar"
					title="Delete toolbar"
					onclick={(event) => {
						event.stopPropagation()
						if (toolbarItems.length === 0) return
						removeParkedToolbar(parking, toolbarItems)
					}}><span aria-hidden="true" class="palette-parking-remove-icon">🗑</span></button
				>
			{/if}
			<Toolbar
				toolbar={toolbarItems}
				direction="horizontal"
				{palette}
				{scope}
				region="top"
				{parking}
				parkingIndex={index}
				el={toolbar}
			/>
		</div>
		<div
			{...space}
			class={[
				'toolbar-stack-space toolbar-drop-zone',
				isParkingGapHighlighted(index + 1) ? 'highlighted' : undefined,
				isParkingGapHovered(index + 1) ? 'hovered' : undefined,
				space?.class
			]}
			data-palette-id={palette.id}
			data-parking-gap-index={index + 1}
		></div>
	{/each}
</div>
