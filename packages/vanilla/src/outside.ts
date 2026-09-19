/**
 * `@palettable/vanilla` — beside-border (`outside`) projection (Phase 6).
 *
 * Pure helper mapping a beside-border pointer onto the border's own
 * stack-gap index space: a span alongside track *i* resolves to the nearer
 * of gaps *i* / *i+1*. Core never hit-tests — the adapter reports
 * `{ kind: 'outside', border, gap }` and core paints/dwells it exactly
 * like `stack-gap` (same index space, different hit region).
 *
 * DOM-free (spans are plain numbers) so unit tests pin it without jsdom
 * layout: the caller measures track spans once per hover from
 * `getBoundingClientRect` and passes them in.
 */

/** One track's span on the border's stack axis (already projected). */
export type TrackSpan = {
	readonly start: number
	readonly end: number
}

/**
 * Resolve the stack gap for a pointer at `along` (already projected onto
 * the border's stack axis) given the track spans in order. A span
 * alongside track *i* resolves to the nearer of gaps *i* / *i+1* (nearer
 * edge wins); a pointer before every span resolves to gap 0, after every
 * span to gap `spans.length`. Returns `undefined` when there are no spans
 * (empty border — nothing to align with, so the caller reports nothing).
 */
export function outsideGapForTrack(spans: readonly TrackSpan[], along: number): number | undefined {
	if (spans.length === 0) return undefined
	let best = 0
	let bestDistance = Number.POSITIVE_INFINITY
	spans.forEach((span, trackIndex) => {
		const middle = (span.start + span.end) / 2
		const distance =
			along < span.start ? span.start - along : along > span.end ? along - span.end : 0
		const edgeGap = along - middle < 0 ? trackIndex : trackIndex + 1
		const clamped = Math.min(Math.max(edgeGap, 0), spans.length)
		if (distance < bestDistance) {
			bestDistance = distance
			best = clamped
		}
	})
	return best
}
