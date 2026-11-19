/**
 * `@palettable/vue` — pointer drag-session helper.
 *
 * Verbatim port of the vanilla adapter's `drag-session.ts`: window move/up
 * listeners, blur/cancel cleanup, no drag preview element (the toolbar
 * itself moves via layout state). No activation threshold: a drag is live
 * from `pointerdown`, and a committed drop happens on hover, not on
 * release — a zero-pixel click is a legitimate no-op drag.
 *
 * Deliberately no pointer capture: capturing on the drag-origin element
 * retargets every subsequent pointermove to that element, so `target` never
 * leaves the origin toolbar/track and the highlighted DZs freeze on the
 * drag origin. Window-level listeners receive all events without capture,
 * letting hover bubble from the element actually under the cursor.
 *
 * Framework-agnostic: Vue components call `startDragSession` from a
 * `pointerdown` handler and drop the returned stop function on unmount.
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

	// Re-dispatch every window pointermove to the element under the cursor
	// so Vue template listeners (`@pointermove` on bars/borders/tracks)
	// fire for the hovered element even when the pointer is implicitly
	// captured to the drag-origin guard (touch/pen + Playwright synthetic
	// mouse). Vanilla relies on bubbling from the element under the cursor;
	// capture retargeting freezes `event.target` on the origin instead.
	// The re-dispatched event is a real `PointerEvent` (not synthetic), so
	// `elementFromPoint` hit-testing in the handlers still resolves the
	// live element. Playwright's synthetic mouse is trusted in Chromium
	// (`isTrusted: true`), so no `isTrusted` gate — the `under !== target`
	// check already prevents double-handling when no capture is active.
	// Dedup: the clone bubbles through every nested level (track → border
	// → bar), and each level's Vue listener would send its own `over()`
	// for the same physical move — one move must equal one `over()`
	// (vanilla's window listeners fire once per move; without this the
	// same gap commits twice: extract, then a duplicate slide-relocation).
	// Stamp the clone; handlers drop events they already saw.
	let lastDispatchStamp = ''
	function redispatch(event: PointerEvent): void {
		if (typeof ownerDocument.elementFromPoint !== 'function') return
		if (event.clientX === undefined || event.clientY === undefined) return
		const under = ownerDocument.elementFromPoint(event.clientX, event.clientY)
		if (!(under instanceof HTMLElement)) return
		if (under === event.target) return
		const stamp = `${event.clientX}:${event.clientY}`
		if (stamp === lastDispatchStamp) return
		lastDispatchStamp = stamp
		const clone = new PointerEvent('pointermove', {
			bubbles: true,
			cancelable: true,
			clientX: event.clientX,
			clientY: event.clientY,
			pointerId: event.pointerId,
			pointerType: event.pointerType,
			buttons: event.buttons,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
			metaKey: event.metaKey,
		})
		;(clone as PointerEvent & { __palettableRedispatch?: string }).__palettableRedispatch = stamp
		under.dispatchEvent(clone)
	}

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
		redispatch(event)
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
