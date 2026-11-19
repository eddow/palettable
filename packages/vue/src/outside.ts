/**
 * `@palettable/vue` — beside-border (`outside`) projection.
 *
 * Same contract as the vanilla adapter's `outside.ts`: core owns the
 * pure index-space mapping (`outsideGapForTrack`); this module owns
 * measuring track spans once per hover from `getBoundingClientRect` and
 * passing them in as plain numbers. Core never hit-tests — the adapter
 * reports `{ kind: 'outside', border, gap }` and core paints/dwells it
 * exactly like `stack-gap`.
 *
 * DOM-free (spans are plain numbers) so unit tests pin it without jsdom
 * layout.
 */
import { outsideGapForTrack, type TrackSpan } from '@palettable/core'

export type { TrackSpan }
export { outsideGapForTrack }
