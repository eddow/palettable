import { describe, expect, it } from 'vitest'
import { configuration } from './configuration.js'
import {
	actualTrackSpaceAt,
	type Border,
	type Borders,
	canonicalItemTool,
	clampUnit,
	findOwnershipViolations,
	insertToolbar,
	itemFingerprint,
	type Parking,
	removeEmptyTrack,
	removeParkedToolbar,
	removeToolbar,
	resizeToolbar,
	type Toolbar,
	type Track,
} from './layout.js'

function trackOf(...toolbars: Toolbar[]): Track {
	return toolbars.map((toolbar) => ({ space: 0, toolbar }))
}

describe('clampUnit', () => {
	it('clamps into the unit interval, non-finite to 0', () => {
		expect(clampUnit(0.4)).toBe(0.4)
		expect(clampUnit(-1)).toBe(0)
		expect(clampUnit(2)).toBe(1)
		expect(clampUnit(Number.NaN)).toBe(0)
		expect(clampUnit(Number.POSITIVE_INFINITY)).toBe(0)
	})
})

describe('actualTrackSpaceAt', () => {
	it('reads stored spaces and derives the trailing remainder', () => {
		const track = trackOf([{ tool: 'a' }], [{ tool: 'b' }])
		track[0]!.space = 0.2
		track[1]!.space = 0.3
		expect(actualTrackSpaceAt(track, 0)).toBeCloseTo(0.2)
		expect(actualTrackSpaceAt(track, 1)).toBeCloseTo(0.3)
		expect(actualTrackSpaceAt(track, 2)).toBeCloseTo(0.5)
		expect(actualTrackSpaceAt(track, 3)).toBe(0)
	})

	it('clamps stored spaces before deriving the remainder', () => {
		const track = trackOf([{ tool: 'a' }])
		track[0]!.space = 2
		expect(actualTrackSpaceAt(track, 0)).toBe(1)
		expect(actualTrackSpaceAt(track, 1)).toBe(0)
	})
})

describe('removeToolbar / removeEmptyTrack / removeParkedToolbar', () => {
	it('removes a toolbar and merges surrounding spacing', () => {
		const a: Toolbar = [{ tool: 'a' }, { tool: 'b' }]
		const b: Toolbar = [{ tool: 'c' }]
		const track: Track = [
			{ space: 0.2, toolbar: a },
			{ space: 0.3, toolbar: b },
		]
		expect(removeToolbar(track, a)).toBe(0)
		expect(track).toHaveLength(1)
		expect(track[0]!.toolbar).toBe(b)
		// 0.2 + 0.3 merged into the surviving leading gap.
		expect(track[0]!.space).toBeCloseTo(0.5)
	})

	it('returns -1 when the toolbar is not in the track', () => {
		const track = trackOf([{ tool: 'a' }])
		expect(removeToolbar(track, [{ tool: 'x' }])).toBe(-1)
		expect(track).toHaveLength(1)
	})

	it('drops an emptied track from its border', () => {
		const solo: Toolbar = [{ tool: 'solo' }]
		const track: Track = [{ space: 0, toolbar: solo }]
		const border: Border = [track]
		removeToolbar(track, solo)
		removeEmptyTrack(border, track)
		expect(border).toHaveLength(0)
	})

	it('keeps a non-empty track in its border', () => {
		const keep: Toolbar = [{ tool: 'keep' }]
		const doomed: Toolbar = [{ tool: 'doomed' }]
		const track: Track = [
			{ space: 0.4, toolbar: keep },
			{ space: 0, toolbar: doomed },
		]
		removeToolbar(track, doomed)
		removeEmptyTrack(borderOf(track), track)
		expect(track).toHaveLength(1)
		expect(track[0]!.toolbar).toBe(keep)
	})

	it('removes a parked toolbar by identity', () => {
		const a: Toolbar = [{ tool: 'a' }]
		const parking: Parking = [a, [{ tool: 'b' }]]
		expect(removeParkedToolbar(parking, a)).toBe(0)
		expect(parking).toHaveLength(1)
		expect(removeParkedToolbar(parking, a)).toBe(-1)
	})
})

describe('insertToolbar / resizeToolbar', () => {
	it('splits the target gap by the split ratio', () => {
		const a: Toolbar = [{ tool: 'a' }]
		const track = trackOf(a)
		track[0]!.space = 0.4
		const b: Toolbar = [{ tool: 'b' }]
		insertToolbar(track, 0, b, 0.5)
		expect(track).toHaveLength(2)
		expect(track[0]!.toolbar).toBe(b)
		// Gap 0 (0.4) splits 50/50; the trailing remainder (0.6) is untouched.
		expect(track[0]!.space).toBeCloseTo(0.2)
		expect(track[1]!.space).toBeCloseTo(0.2)
		expect(actualTrackSpaceAt(track, 2)).toBeCloseTo(0.6)
	})

	it('rebalances spaces around an existing toolbar', () => {
		const track = trackOf([{ tool: 'a' }], [{ tool: 'b' }])
		track[0]!.space = 0.2
		track[1]!.space = 0.3
		resizeToolbar(track, 0, 0.5)
		const merged = 0.2 + 0.3
		expect(track[0]!.space).toBeCloseTo(merged * 0.5)
		expect(track[1]!.space).toBeCloseTo(merged * 0.5)
	})

	it('ignores out-of-range resize indices', () => {
		const track = trackOf([{ tool: 'a' }])
		const before = track[0]!.space
		resizeToolbar(track, 9, 0.5)
		expect(track[0]!.space).toBe(before)
	})
})

describe('canonicalItemTool / itemFingerprint', () => {
	it('strips setter and action suffixes', () => {
		expect(canonicalItemTool({ tool: 'alertLevel' })).toBe('alertLevel')
		expect(canonicalItemTool({ tool: 'alertLevel=red' })).toBe('alertLevel')
		expect(canonicalItemTool({ tool: 'alertLevel|red' })).toBe('alertLevel')
		expect(canonicalItemTool({ tool: 'alertLevel:inc' })).toBe('alertLevel')
		expect(() => canonicalItemTool({ editor: 'status' } as never)).toThrow('no bound point')
	})

	it('resolves inline virtual definitions to their own id', () => {
		expect(
			canonicalItemTool({
				tool: { id: 'pause', label: 'Pause', source: 'gameSpeed', kind: 'stash', stashedValue: 0 },
			})
		).toBe('pause')
	})

	it('fingerprints canonical tool + editor + config', () => {
		expect(itemFingerprint({ tool: 'alertLevel' })).toBe(
			itemFingerprint({ tool: 'alertLevel=red' })
		)
		expect(itemFingerprint({ tool: 'alertLevel' })).toBe(
			itemFingerprint({ tool: 'alertLevel|red' })
		)
		expect(itemFingerprint({ tool: 'alertLevel' })).toBe(
			itemFingerprint({ tool: 'alertLevel:inc' })
		)
		expect(itemFingerprint({ tool: 'a', editor: 'toggle' })).not.toBe(
			itemFingerprint({ tool: 'a', editor: 'select' })
		)
		expect(itemFingerprint({ tool: 'a', config: { b: 1, a: 2 } })).toBe(
			itemFingerprint({ tool: 'a', config: { a: 2, b: 1 } })
		)
	})
})

describe('findOwnershipViolations', () => {
	function bordersWith(top: Border): Borders {
		return { top, right: [], bottom: [], left: [] }
	}

	it('passes a clean layout', () => {
		const violations = findOwnershipViolations({
			borders: bordersWith([trackOf([{ tool: 'a' }])]),
			parking: [[{ tool: 'p' }]],
		})
		expect(violations).toEqual([])
	})

	it('flags shared references and structural duplicates', () => {
		const shared = { tool: 'a' }
		const violations = findOwnershipViolations({
			borders: bordersWith([[{ space: 0, toolbar: [shared] }]]),
			parking: [[shared]],
		})
		expect(violations.some((v) => v.includes('shared'))).toBe(true)
		expect(violations.some((v) => v.includes('duplicate'))).toBe(true)
	})
})

describe('configuration', () => {
	it('exposes the tunable magic numbers', () => {
		expect(configuration.stackDzHoverMs).toBe(500)
		expect(configuration.drawerHoverCloseMs).toBe(120)
		expect(configuration.trackGapSplit).toBe(0.5)
		expect(configuration.trackGapMinGrow).toBe(0.0001)
	})
})

function borderOf(track: Track): Border {
	return [track]
}
