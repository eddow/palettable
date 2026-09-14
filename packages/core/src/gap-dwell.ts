/**
 * `@palettable/core` — shared hover-dwell state machine for stack gaps
 * (border stacks + parking).
 *
 * Adapters run the same protocol:
 *
 * - `active` — the row/track hovered (flanking gaps highlight)
 * - `hovered` — the gap directly hovered (only it highlights + arms the timer)
 * - `committed` — one-shot latch suppressing re-arm while the pointer stays
 *   put after a fire; leaving the gap (or drag end) resets it
 * - a `setTimeout` armed on direct hover, firing `onFire(gap)` once
 *   (`configuration.stackDzHoverMs`); retarget/cancel clears it
 *
 * Plain class (no framework reactivity): adapters own their reactive fields
 * and delegate transitions here, keeping the timer/latch rules in one place.
 * `isHighlighted` stays in the adapter (border vs parking veto + mask rules
 * differ); the dwell only asks it whether the arming gap may fire.
 */
import { configuration } from './configuration.js'
import { clearHostTimeout, scheduleHostTimeout } from './globals.js'

export type GapDwellState = {
	active: number | undefined
	hovered: number | undefined
	committed: number | undefined
}

export function createGapDwellState(): GapDwellState {
	return { active: undefined, hovered: undefined, committed: undefined }
}

export class GapDwell {
	private timer: unknown | undefined

	/** Cancel a pending fire without touching hover state. */
	cancel(): void {
		if (this.timer !== undefined) {
			clearHostTimeout(this.timer)
			this.timer = undefined
		}
	}

	/** Clear hover + latch + timer (pointer leave, drag end). */
	reset(state: GapDwellState): void {
		state.active = undefined
		state.hovered = undefined
		state.committed = undefined
		this.cancel()
	}

	/** Direct gap hover: record it, clear the row/track flank. */
	hoverGap(state: GapDwellState, gap: number | undefined): void {
		state.hovered = gap
		state.active = undefined
	}

	/** Row/track hover: record it (flanking gaps highlight, no arming). */
	hoverRow(state: GapDwellState, row: number | undefined): void {
		state.active = row
		state.hovered = undefined
	}

	/**
	 * Evaluate the arming effect. Call from an adapter effect keyed on
	 * `hovered`/drag/mask state; returns a cleanup that cancels the timer.
	 *
	 * - `canArm(gap)` — the adapter's highlight predicate for the gap
	 * - `onFire(gap)` — the commit (must re-check hover liveness itself)
	 */
	arm(
		state: GapDwellState,
		options: {
			editing: boolean
			dragging: boolean
			masked: boolean
			canArm: (gap: number) => boolean
			onFire: (gap: number) => void
		}
	): () => void {
		const gap = state.hovered
		if (
			!options.editing ||
			!options.dragging ||
			options.masked ||
			gap === undefined ||
			state.committed === gap ||
			!options.canArm(gap)
		) {
			this.cancel()
			// Leaving the gap resets the one-shot latch so a fresh hover
			// arms again — including returning to the just-committed gap.
			if (gap === undefined) state.committed = undefined
			return () => this.cancel()
		}
		// Retargeting to another gap is a fresh hover: drop the latch for
		// the previously committed gap so returning to it can arm again.
		if (state.committed !== undefined) state.committed = undefined
		this.cancel()
		const target = gap
		this.timer = scheduleHostTimeout(() => {
			this.timer = undefined
			state.committed = target
			// Backstop: a gap change normally cancels this via the
			// cleanup first — only commit while the pointer is still on
			// the arming gap.
			if (state.hovered !== target) return
			options.onFire(target)
		}, configuration.stackDzHoverMs)
		return () => this.cancel()
	}
}
