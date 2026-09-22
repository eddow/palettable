/**
 * Pointer drag-session helper for palette toolbar reordering.
 *
 * Ported from `@sursaut/ui` `directives/local-drag.ts` (`startLocalDragSession`),
 * trimmed to the palette's needs: window move/up listeners, blur/cancel
 * cleanup, and no drag preview element (the toolbar itself moves via reactive
 * layout state).
 *
 * There is deliberately no activation threshold: a drag is live from
 * `pointerdown`, and a committed drop happens on hover, not on release. The
 * caller decides what a commit means (see `commitDraggedToTrackSpace`), so a
 * zero-pixel click is a legitimate no-op drag rather than a cancelled one.
 */

export type PaletteDragPoint = { x: number; y: number }

export type PaletteDragStopReason = 'up' | 'buttons' | 'cancel' | 'blur' | 'hidden' | 'manual'

export type PaletteDragSnapshot = {
	start: PaletteDragPoint
	current: PaletteDragPoint
	pointerId: number | undefined
}

export type PaletteDragSessionOptions = {
	event: PointerEvent
	onMove: (snapshot: PaletteDragSnapshot, event: PointerEvent) => void
	onStop: (snapshot: PaletteDragSnapshot & { reason: PaletteDragStopReason }, event?: Event) => void
}

function eventPoint(event: PointerEvent): PaletteDragPoint {
	return { x: event.clientX, y: event.clientY }
}

function releaseCapture(_element: HTMLElement, _pointerId: number | undefined): void {
	// Intentionally no pointer capture: capturing on the drag-origin element
	// retargets every subsequent pointermove to that element, so `target`
	// never leaves the origin toolbar/track and the highlighted DZs freeze
	// on the drag origin. The window-level move/up listeners below already
	// receive all events without capture, letting hover bubble from the
	// element actually under the cursor (so tb/track/stack can change).
	return
}

export function startPaletteDragSession(options: PaletteDragSessionOptions): () => void {
	const sourceEvent = options.event
	const element =
		sourceEvent.currentTarget instanceof HTMLElement
			? sourceEvent.currentTarget
			: sourceEvent.target instanceof HTMLElement
				? sourceEvent.target
				: undefined
	const ownerDocument = element?.ownerDocument ?? document
	const ownerWindow = ownerDocument.defaultView ?? window
	const pointerId = sourceEvent.pointerId
	const snapshot: PaletteDragSnapshot = {
		start: eventPoint(sourceEvent),
		current: eventPoint(sourceEvent),
		pointerId,
	}
	let stopped = false

	sourceEvent.preventDefault()

	function stop(reason: PaletteDragStopReason, event?: Event): void {
		if (stopped) return
		stopped = true
		ownerWindow.removeEventListener('pointermove', handleMove)
		ownerWindow.removeEventListener('pointerup', handleUp)
		ownerWindow.removeEventListener('pointercancel', handleCancel)
		ownerWindow.removeEventListener('blur', handleBlur)
		ownerDocument.removeEventListener('visibilitychange', handleVisibility)
		releaseCapture(element ?? ownerDocument.body, pointerId)
		options.onStop({ ...snapshot, reason }, event)
	}

	function handleMove(event: PointerEvent): void {
		if (event.pointerId !== pointerId) return
		snapshot.current = eventPoint(event)
		if (event.buttons === 0) {
			stop('buttons', event)
			return
		}
		options.onMove({ ...snapshot }, event)
	}

	function handleUp(event: PointerEvent): void {
		if (event.pointerId !== pointerId) return
		snapshot.current = eventPoint(event)
		stop('up', event)
	}

	function handleCancel(event: PointerEvent): void {
		if (event.pointerId !== pointerId) return
		snapshot.current = eventPoint(event)
		stop('cancel', event)
	}

	function handleBlur(): void {
		stop('blur')
	}

	function handleVisibility(): void {
		if (ownerDocument.visibilityState === 'visible') return
		stop('hidden')
	}

	if (element?.isConnected) {
		// Intentionally no `setPointerCapture`: see `releaseCapture` above.
		// Window listeners receive every move/up without retargeting hover.
		void pointerId
	}
	ownerWindow.addEventListener('pointermove', handleMove)
	ownerWindow.addEventListener('pointerup', handleUp)
	ownerWindow.addEventListener('pointercancel', handleCancel)
	ownerWindow.addEventListener('blur', handleBlur)
	ownerDocument.addEventListener('visibilitychange', handleVisibility)

	return () => stop('manual')
}
