/**
 * `@palettable/core` — param-array display types (Phase 8).
 *
 * Display resolvers receive aligned `(boundValues, boundBags)` arrays in
 * `uses` order, with `undefined` for any unregistered bag. Kept in its own
 * module so `context-display.ts` stays dependency-light (no `context.ts`
 * value import — the bag shape is structural).
 */
import type { ValuesBag } from './context.js'

/** Aligned root values in `uses` order (one slot per used name). */
export type BoundValues = readonly unknown[]

/** Aligned bags in `uses` order (`undefined` = bag not registered). */
export type BoundBags = readonly (ValuesBag | undefined)[]

/** Key accessor over a bag slot (structural — no import of bag values). */
export type BagKeyOf = ValuesBag
