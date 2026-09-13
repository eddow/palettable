<script lang="ts">
	import type { SvelteHTMLElements } from 'svelte/elements'
	import { configuration } from '../configuration'
	import {
		actualTrackSpaceAt,
		clearToolbarSlide,
		commitDraggedToTrackSpace,
		lastDragPointer,
		retargetToolbarSlide
	} from '../layout.svelte'
	import type { Palette as PaletteRuntime } from '../palette.svelte'
	import { palettes } from '../palette.svelte'
	import type { PaletteBorder, PaletteRegion, PaletteScope, PaletteTrack } from '../types'
	import Toolbar from './Toolbar.svelte'

	type Props = {
		border: PaletteBorder
		region: PaletteRegion
		track: PaletteTrack
		trackIndex: number
		direction: 'horizontal' | 'vertical'
		palette: PaletteRuntime
		scope: PaletteScope
		el?: SvelteHTMLElements['div']
		space?: SvelteHTMLElements['div']
		toolbar?: SvelteHTMLElements['div']
	}

	let { border, region, track, trackIndex, direction, palette, scope, el, space, toolbar }: Props =
		$props()

	// Root track element, captured so the slide-arming effect can query the
	// current toolbar element inside this track only (border/track index
	// shifts from an origin prune can't misroute the lookup).
	let trackElement: HTMLElement | undefined = $state(undefined)

	// Perpendicular DZs: the gaps between toolbars along the track axis
	// (track spaces). Hovering a gap commits immediately: the dragged tools
	// are extracted into a fresh singleton toolbar at that gap, which is then
	// what keeps moving (see `commitDraggedToTrackSpace`). There is
	// deliberately NO highlight — the new toolbar itself is the visual
	// feedback (previewing is moving).
	//
	// This memo is the idempotency guard: the pointer is typically still over
	// the *same physical gap* on the next move, and the committed toolbar now
	// sits under it. Keeping the memo (instead of clearing it) makes that
	// repeat a no-op by identity, so a second toolbar can never be built for
	// the same gap. Only entering a *different* gap commits again.
	let hoveredTrackSpace = $state<number | undefined>(undefined)

	const isDragging = $derived(palettes.dragging?.palette === palette)
	// The toolbar this track is currently sliding, if any. Reading the cached
	// *mode* (not a recomputed tool-list predicate) is what keeps this stable
	// across commits: a restructure that extracts its tools into a fresh
	// toolbar becomes a slide, and a merge back into a populated toolbar stops
	// being one — which is what disarms slide-follow below. Container-scoped:
	// a parking drag never arms slide-follow in a border track, even if the
	// same toolbar object is rendered in both places.
	const slidingToolbar = $derived(
		palettes.dragging?.palette === palette &&
			palettes.dragging.mode === 'slide' &&
			palettes.dragging.origin.kind === 'border' &&
			palettes.dragging.origin.track === track
			? (palettes.dragging.origin.toolbar ?? undefined)
			: undefined
	)

	function onTrackPointerMove(event: PointerEvent): void {
		if (!palette.editing || !isDragging) {
			hoveredTrackSpace = undefined
			return
		}
		const target = event.target
		if (!(target instanceof HTMLElement)) return
		// Inside a toolbar → the toolbar owns the perpendicular DZs. Do NOT
		// clear the memo here: after a commit the fresh toolbar sits under the
		// pointer, and clearing would re-arm the commit on the very next move.
		if (target.closest('.toolbar')) return
		const spaceEl = target.closest('[data-track-space-index]')
		if (
			!spaceEl ||
			!(event.currentTarget instanceof HTMLElement) ||
			!event.currentTarget.contains(spaceEl)
		) {
			hoveredTrackSpace = undefined
			return
		}
		const index = Number(spaceEl.getAttribute('data-track-space-index'))
		const next = Number.isInteger(index) ? index : undefined
		const prev = hoveredTrackSpace
		// The commit itself rejects the gaps touching the moved toolbar.
		if (next !== undefined && next !== prev && commitDraggedToTrackSpace(track, border, next)) {
			// Record the gap we committed into — not `undefined` — so a repeat
			// move at the same physical position is absorbed by `next === prev`.
			hoveredTrackSpace = next
		} else {
			hoveredTrackSpace = next
		}
	}

	function onTrackPointerLeave(): void {
		hoveredTrackSpace = undefined
	}

	// Declarative slide arming: whenever this track holds the session's sliding
	// toolbar, arm slide-follow over the toolbar's live element. `$effect` runs
	// after Svelte flushes the DOM, so a freshly committed toolbar is already
	// measurable — no manual `tick()`, no attribute-selector lookup from the
	// pointer handler.
	//
	// The `else` branch matters: this effect is the *only* disarm path for a
	// mode change. When a merge turns the selection back into a restructure,
	// `slidingToolbar` becomes `undefined` and the effect must actively clear
	// the session — merely not arming would leave the old toolbar translating
	// under the pointer.
	//
	// `recenter` is passed explicitly (the session has no grab point yet when a
	// restructure lands in a gap) so the effect never *reads* `grabOffset`,
	// which `retargetToolbarSlide` writes.
	$effect(() => {
		const sliding = slidingToolbar
		if (!palette.editing || !sliding) {
			clearToolbarSlide()
			return
		}
		const root = trackElement
		if (!(root instanceof HTMLElement)) return
		const slot = track.findIndex((entry) => entry.toolbar === sliding)
		if (slot < 0) return
		const element = root.querySelector(`[data-toolbar-slot-index="${slot}"] .toolbar`)
		if (!(element instanceof HTMLElement)) return
		const dragging = palettes.dragging
		if (!dragging) return
		const pointer = lastDragPointer()
		retargetToolbarSlide({
			track,
			toolbar: sliding,
			toolbarElement: element,
			direction,
			clientX: pointer.x,
			clientY: pointer.y,
			recenter: dragging.grabOffset === undefined
		})
	})

	$effect(() => {
		if (!palette.editing || !isDragging) hoveredTrackSpace = undefined
	})
</script>

<div
	{...el}
	class={['toolbar-track', el?.class]}
	data-track-index={trackIndex}
	data-palette-id={palette.id}
	bind:this={trackElement}
	onpointermove={onTrackPointerMove}
	onpointerleave={onTrackPointerLeave}
>
	<div
		{...space}
		class={['toolbar-track-space toolbar-drop-zone', space?.class]}
		data-palette-id={palette.id}
		data-track-space-index={0}
		style:flex-basis={`${actualTrackSpaceAt(track, 0) * 100}%`}
		style:flex-grow={Math.max(actualTrackSpaceAt(track, 0), configuration.trackGapMinGrow)}
	></div>
	{#each track as slot, index (slot)}
		<div class="toolbar-track-slot" data-toolbar-slot-index={index}>
			<Toolbar
				toolbar={slot.toolbar}
				{direction}
				{palette}
				{scope}
				{border}
				{region}
				{track}
				{trackIndex}
				el={toolbar}
			/>
		</div>
		<div
			{...space}
			class={['toolbar-track-space toolbar-drop-zone', space?.class]}
			data-palette-id={palette.id}
			data-track-space-index={index + 1}
			style:flex-basis={`${actualTrackSpaceAt(track, index + 1) * 100}%`}
			style:flex-grow={Math.max(
				actualTrackSpaceAt(track, index + 1),
				configuration.trackGapMinGrow
			)}
		></div>
	{/each}
</div>
