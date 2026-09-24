import { describe, expect, it } from 'vitest'
import { outsideGapForTrack } from './outside.js'

describe('outsideGapForTrack', () => {
	it('returns undefined for an empty border', () => {
		expect(outsideGapForTrack([], 10)).toBe(undefined)
	})

	it('resolves before/after every span to the end gaps', () => {
		const spans = [
			{ start: 0, end: 10 },
			{ start: 20, end: 30 },
		]
		expect(outsideGapForTrack(spans, -5)).toBe(0)
		expect(outsideGapForTrack(spans, 35)).toBe(2)
	})

	it('resolves a span alongside a track to the nearer gap', () => {
		const spans = [
			{ start: 0, end: 10 },
			{ start: 20, end: 30 },
		]
		// Middle of track 0 (5) → nearer edge wins → gap 0 or 1 by half.
		expect(outsideGapForTrack(spans, 2)).toBe(0)
		expect(outsideGapForTrack(spans, 8)).toBe(1)
		// Between the spans → nearer track wins.
		expect(outsideGapForTrack(spans, 12)).toBe(1)
		expect(outsideGapForTrack(spans, 18)).toBe(1)
	})
})
