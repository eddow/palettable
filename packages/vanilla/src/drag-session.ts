/**
 * `@palettable/vanilla` — pointer drag-session helper.
 *
 * Window move/up listeners, blur/cancel cleanup, no drag preview element
 * (the toolbar itself moves via layout state). No activation threshold: a
 * drag is live from `pointerdown`, and a committed drop happens on hover,
 * not on release — a zero-pixel click is a legitimate no-op drag.
 *
 * Deliberately no pointer capture: capturing on the drag-origin element
 * retargets every subsequent pointermove to that element, so `target` never
 * leaves the origin toolbar/track and the highlighted DZs freeze on the
 * drag origin. Window-level listeners receive all events without capture,
 * letting hover bubble from the element actually under the cursor.
 */

export type DragPoint = { x: number; y: number }

export type DragStopReason = 'up' | 'buttons' | 'cancel' | 'blur' | 'hidden' | 'manual'

export type DragSnapshot = {
	start: DragPoint
	current: DragPoint
	pointerId: number | undefined
}

export type DragSessionOptions = {
	event: PointerEvent
	onMove: (snapshot: DragSnapshot, event: PointerEvent) => void
	onStop: (snapshot: DragSnapshot & { reason: DragStopReason }, event?: Event) => void
}

function eventPoint(event: PointerEvent): DragPoint {
	return { x: event.clientX, y: event.clientY }
}

export function startDragSession(options: DragSessionOptions): () => void {
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
	const snapshot: DragSnapshot = {
		start: eventPoint(sourceEvent),
		current: eventPoint(sourceEvent),
		pointerId,
	}
	let stopped = false

	sourceEvent.preventDefault()

	function stop(reason: DragStopReason, event?: Event): void {
		if (stopped) return
		stopped = true
		ownerWindow.removeEventListener('pointermove', handleMove)
		ownerWindow.removeEventListener('pointerup', handleUp)
		ownerWindow.removeEventListener('pointercancel', handleCancel)
		ownerWindow.removeEventListener('blur', handleBlur)
		ownerDocument.removeEventListener('visibilitychange', handleVisibility)
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

	ownerWindow.addEventListener('pointermove', handleMove)
	ownerWindow.addEventListener('pointerup', handleUp)
	ownerWindow.addEventListener('pointercancel', handleCancel)
	ownerWindow.addEventListener('blur', handleBlur)
	ownerDocument.addEventListener('visibilitychange', handleVisibility)

	return () => stop('manual')
}
