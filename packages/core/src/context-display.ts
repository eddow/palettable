/**
 * `@palettable/core` — pure context display resolvers (Phase 8).
 *
 * Headless derivation helpers over the `(boundValues, boundBags)`
 * param-array shape (`plans/context.md` §2.2, §4 step 6): no
 * value-mirroring, no virtual chaining — display follows context through
 * derivation. Render never throws on a missing bag (`undefined` slot =
 * "context absent" → disabled + placeholder unless the resolver defines
 * otherwise).
 */
import type { ValuesBag } from './context.js'

/** Aligned root values in `uses` order (one slot per used name). */
export type BoundValues = readonly unknown[]

/** Aligned bags in `uses` order (`undefined` = bag not registered). */
export type BoundBags = readonly (ValuesBag | undefined)[]

/** Sentinel for a missing context bag (`undefined` slot in `boundBags`). */
export const missingContext = undefined

/**
 * Single-point dual-source precedence (the bold example, Context §2.2):
 * the selection bag wins when present (selection present → selection
 * value), else the root-bag value. `undefined` bag = absent → root value.
 */
export function dualSourceValue<T>(
	rootValue: T,
	selectionBag: { get(key: string): T | undefined } | undefined,
	selectionKey: string
): T | undefined {
	if (selectionBag !== undefined) {
		const selected = selectionBag.get(selectionKey)
		if (selected !== undefined) return selected
	}
	return rootValue
}

/**
 * Resolve one bound value by index from the param-array pair. Missing
 * index → `undefined` (never throws).
 */
export function boundValueAt(boundValues: BoundValues, index: number): unknown {
	return boundValues[index]
}

/**
 * Resolve one bound bag by index from the param-array pair. Missing
 * index → `undefined` (missing context, never throws).
 */
export function boundBagAt(boundBags: BoundBags, index: number): ValuesBag | undefined {
	return boundBags[index]
}

/**
 * Read a key from the bag at `bagIndex` (or `undefined` when the bag is
 * absent). Never throws on missing context.
 */
export function readBoundBagKey(boundBags: BoundBags, bagIndex: number, key: string): unknown {
	return boundBags[bagIndex]?.get(key)
}
