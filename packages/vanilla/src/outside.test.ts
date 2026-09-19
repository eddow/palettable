/**
 * `@palettable/vanilla` — `outside` projection pins (Phase 6).
 *
 * The beside-border pointer maps onto the border's own stack-gap index
 * space: a span alongside track *i* resolves to the nearer of gaps *i* /
 * *i+1* (nearer edge wins). Pure numbers — no DOM.
 */
import { describe, expect, it } from 'vitest'
import { outsideGapForTrack } from './outside.js'

describe('outsideGapForTrack', () => {
	const spans = [
		{ start: 0, end: 100 },
		{ start: 100, end: 200 },
	]
	it('resolves the nearer edge of the alongside span', () => {
		// Inside track 0, before its middle → gap 0; after → gap 1.
		expect(outsideGapForTrack(spans, 25)).toBe(0)
		expect(outsideGapForTrack(spans, 75)).toBe(1)
		// Inside track 1, before its middle → gap 1; after → gap 2.
		expect(outsideGapForTrack(spans, 125)).toBe(1)
		expect(outsideGapForTrack(spans, 175)).toBe(2)
	})
	it('clamps before every span to gap 0 and after to the end gap', () => {
		expect(outsideGapForTrack(spans, -50)).toBe(0)
		expect(outsideGapForTrack(spans, 250)).toBe(2)
	})
	it('returns undefined with no spans (empty border)', () => {
		expect(outsideGapForTrack([], 50)).toBeUndefined()
	})
})
