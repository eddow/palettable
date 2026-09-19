# Drag interface refactor — session + events (active plan)

> Status: **active plan — Phases 1–5 landed 2026-09-19 (complete, not
> scoped) + granular drag ops + `track` kind deleted.** Review fixes 2026-09-17 (kept): dwell re-paint after `structure`,
> no `resize` on a slideless gesture, vanilla `end()`-before-disarm +
> real pointer samples. Granular ops 2026-09-19: every drag commit emits a
> precise `move-toolbar` op (`from` = pre-mutation origin, `to` = placed
> toolbar, `pruned` = emptied toolbar/track/row victims — never `replace`,
> which stays whole-load-only); vanilla applies it at track granularity
> (`syncTrack` for exactly the named tracks, per-region `syncBorder`
> fallback only when the track list itself changed). Normative spec is below (`Decisions` / `Types` / `Methods` /
> `Adapter responsibilities`); the execution checklist is `Plan` (this file
> tracks only what is left). `packages/svelte/src` is **out of scope**
> (frozen oracle, per mitosis). Order: `core` first, then `vanilla`. Gate
> after Phase 5: core 321, vanilla 51, e2e **vanilla 31 green** — the svelte
> failures are still only the Phase-0 fail set (4), so vanilla is fully green.

## Goal

Replace the current free-function drag protocol (`dragStart` / `dragOver` →
`DragOverDecision`, `DraggingState` passed explicitly, silent live-array
mutation + manual `syncBorder`, adapter-owned slide math in `vanilla/slide.ts`,
dwell owned by svelte wiring (core `gap-dwell.ts` unwired in vanilla)) with the
session + event interface specified below: `layout.createDrag(target)` → `ToolbarDrag`
(`over` / `measure` / `end`, all `void`), core-raised `DragEvent`s
(`highlight` diffs + `slide` / `clearSlide` / `resize` + `structure` ops) on
the layout's single event stream. Unlocks vue parity (one wire vocabulary
for every adapter) and deletes the legacy surface once vanilla is green.
## Non-goals

- No svelte changes (oracle stays frozen until Phase 12 per `mitosis.md`).
- No visual / CSS redesign (`.highlighted` / `.hovered` mapping unchanged).
- No `moveItem` / `moveToolbar` / `insertItem` / `removeItem` signature changes
  (they stay for discrete edits; drag just stops bypassing them silently).
- No new e2e demos or ports (same Stellar Outpost page, same suite).

## Where we are (2026-09-16)

| Spec item | Current state | Plan phase |
| --------- | ------------- | ---------- |
| `ToolbarDrag` session + `GrabTarget` | missing — free `dragStart`/`dragOver`, `DraggingState` passed explicitly from `vanilla/ide.ts` | 1 |
| `structure` events on the layout stream | missing — commits mutate silently, adapter re-renders via `syncBorder` (and would double-apply with the op stream) | 1 |
| `highlight` diff events (`off` / `on` / `double`) | missing — `dragOver` returns full paint sets + `moved`; `double` never painted | 2 |
| Dwell in core (`stackDzHoverMs` in the session) | missing in vanilla — `GapDwell` exists in core but only svelte wires it; vanilla stack/parking gaps are paint-only with **no fire at all** | 3 |
| `SlideFrame` / `measure` / core `clampSlideDelta` | missing — clamp + bounds + grab live in `vanilla/slide.ts`; follow is `armSlide`/`disarmSlide` in `ide.ts` | 4 |
| `slide` / `clearSlide` / `resize`, `end()` finalise | missing — release is adapter `resizeToolbar` + `transform = ''` in `endToolDrag` | 4 |
| `Hoverable` union, no `parking-row-gap`, no `track`-background, dry-side track fallback | diverged — `DragElement` carries container-less gaps + `parking-row-gap` + `track` | 5 |
| `outside`, `catalog`, mask/panel affordances, editing-flip `end()`, chrome mirror | missing | 6 |
| Legacy deletion + docs migration | blocked on 1–6 | 7 |

## Decisions

- **Identity, not position.** The adapter passes live object references
  (`Toolbar` / `ToolbarItem` / `Track` / `Border` / `Parking` arrays from
  `getLayout()`). Position indices go stale after every commit (prune
  shift, track removal, singleton extraction); core locates the origin by
  `===` scan. The adapter never re-resolves.
- **One session object per gesture — methods, not globals.** There is no
  free `dragStart` / `dragOver` / `dragEnd` and no module-level controller: a
  gesture creates a session (`layout.createDrag(target)`) and the
  verbs are its methods — `this` is the session and `this.layout` is the live
  `PaletteLayoutTree`. The adapter never passes a layout, because the session
  was born holding one.
- **Core *raises* events; the methods return `void`.** The session emits on
  the layout's single event stream (the stream that already carries
  `LayoutOp`). The adapter subscribes once and follows events in emission
  order — it never reconciles a return value, and nothing can be applied
  twice because during a drag there is one stream and one writer.
- **Paint events are diffs; structure events are precise ops.** `highlight` is
  emitted only when a gap's paint actually changed (`off` / `on` / `double`),
  and `structure` carries a `move-toolbar` op derived per commit (`from` =
  pre-mutation origin location, `to` = placed toolbar location, `pruned` =
  emptied toolbar/track/row victims). `replace` never fires during a drag
  (whole-loads only). A structure event resets the
  session's paint baseline and re-paints the live toolbar afterwards
  (including re-emitting `slide` for the element that now exists) — never a
  diff against nodes that a re-render destroyed.
- **Stateful core session.** The session holds the selection, the resolved
  origin, the cached mode, the DZ paint state, the pending slide split and the
  dwell timer. The adapter holds measured frames, the DOM classes it was told
  to paint, the rAF loop writing `transform`, and the listeners. It holds
  measured state and painted state — never a decision.
- **All behaviour in core.** The adapter never decides a move, a highlight,
  whether/what slides, or when a dwell fires. It hit-tests, measures, applies.
- **Nothing is ever cloned.** A drag moves the *same* `ToolbarItem` objects
  inside the *same* `Toolbar` array; a sliding toolbar keeps its identity and
  its DOM node. Only a restructure *creates* a toolbar (a fresh empty array,
  then the items are spliced into it) and *prunes* the origin once emptied —
  the one case where the adapter's node map gains and loses nodes.
- **`this.layout` is the only writer during a drag.** `moveItem` /
  `moveToolbar` / `insertItem` / `removeItem` stay for discrete edits (console
  add, parking delete, demo presets) and must **not** be called from a drag
  session: a drag mutates the live arrays through the engine, which then emits
  the matching `structure` event.
- **No `XY` in core, and no DOM.** Hit-testing is the adapter's job (abstract
  indices travel inside `Hoverable`). Core consumes two raw client numbers per
  hover (`PointerSample`) plus a *measured slide frame* that the adapter
  refreshes only when slide-follow (re)arms — never per pointer move. Geometry
  is pushed, not pulled: `measure(frame)`.
- **No `parking-row-gap`.** Parking rows are full-width toolbars, so an item
  gap inside a parking row is just an `item-gap` — the live `toolbar`
  reference suffices and core resolves the container itself. Symmetrically,
  every gap kind carries its container (`item-gap` → `toolbar`, `track-gap` →
  `track`, `stack-gap` / `outside` → `border`, `parking-gap` → `parking`).
- **No `track-background`.** Tracks are fully covered by toolbars + track
  gaps, so every hover inside a track already resolves to a toolbar, tool or
  gap; the flanking stack-gap paints are derived from the containing track on
  every such hover (emptied veto applies).
- **Tagged union, never a bare array.** Every hover is a tagged value
  (`{ kind: 'toolbar', toolbar }`, not a bare `Toolbar`) so discrimination
  never depends on "does this object happen to have a `kind`".
- **"Beside" a container is a first-class index.** `outside` reports a
  pointer that is *not* inside a border but is aligned, on that border's stack
  axis, with stack gap `gap` — the **same index space** as the in-border
  `stack-gap`, a different hit region. It paints and dwells exactly like
  `stack-gap`. The adapter resolves the alignment (a pointer alongside track
  *i* resolves to the nearer of stack gaps *i* / *i+1*); core still never
  hit-tests.
- **The mask and the console panel are adapter affordances.** Hovering the
  dimmed work zone / overlay background (the mask) and the panel background
  around parking commits nothing and vetoes nothing, so the adapter owns them
  completely: it paints the inner end gap of each border (mask) and the
  parking end gap above/below the parking rect (panel), using the
  core-exported veto predicates (`draggingEmptiesTrackIndex` /
  `draggingEmptiesParkingRow`) so the *rule* stays in core. Where a mask
  position maps to a real container (the parking end gap) it reports the normal
  hover (`parking-gap`) so dwell and commit stay core's; where it maps to
  nothing it reports `null`.
- **Time is core's.** The stack/parking dwell
  (`configuration.stackDzHoverMs`) lives in the session: it arms on a directly
  hovered gap, cancels on gap change / `null` hover / `end()`, and emits the
  structure event itself. The adapter's `pointerup` / `pointercancel` /
  `blur` / `visibilitychange` listeners only call `end()`, and an `editing`
  flip false mid-gesture does the same.

## Types

```ts
/** Adapter-measured slide frame: axis-projected plain numbers, no DOM.
 * Measured when the adapter arms slide-follow (at grab time for a
 * whole-toolbar or lone-tool grab, and again after every `structure` event,
 * because that is exactly when the DOM moved) — never per pointer move. */
type SlideFrame = {
	/** Slide axis: the axis of the dragged toolbar's own track. */
	readonly axis: 'horizontal' | 'vertical'
	/** Free span of the slot: leading gap's edge → trailing gap's end. */
	readonly start: number
	readonly available: number
	/** Toolbar's resting leading edge − `start` (the leading gap's width). */
	readonly resting: number
	/** Cursor offset inside the toolbar, captured at grab time. */
	readonly grab: number
}

/** Two raw client numbers, passed on every hover. No measurement, no axis. */
type PointerSample = { readonly clientX: number; readonly clientY: number }

/** What was grabbed. `catalog` has no container — it is a creation. */
type GrabTarget =
	| { readonly kind: 'tool'; readonly toolbar: Toolbar; readonly item: ToolbarItem }
	| { readonly kind: 'toolbar'; readonly toolbar: Toolbar }
	| { readonly kind: 'catalog'; readonly item: ToolbarItem }

type DropZone =
	| { readonly kind: 'item-gap'; readonly toolbar: Toolbar; readonly gap: number }
	| { readonly kind: 'track-gap'; readonly track: Track; readonly gap: number }
	| { readonly kind: 'stack-gap'; readonly border: Border; readonly gap: number }
	| { readonly kind: 'parking-gap'; readonly parking: Parking; readonly gap: number }
	/** Beside `border`, aligned with its stack gap `gap` (same index space). */
	| { readonly kind: 'outside'; readonly border: Border; readonly gap: number }

type Hoverable =
	| { readonly kind: 'toolbar'; readonly toolbar: Toolbar; readonly activeItem?: number }
	| { readonly kind: 'tool'; readonly toolbar: Toolbar; readonly item: ToolbarItem }
	| DropZone

/** `off` clears the gap; `double` is the directly-hovered parallel stack DZ
 * (CSS `.highlighted.hovered`, doubled `--palette-dz-size`). */
type HighlightState = 'off' | 'on' | 'double'

type DragEvent =
	| { readonly type: 'highlight'; readonly dz: DropZone; readonly state: HighlightState }
	| { readonly type: 'slide'; readonly toolbar: Toolbar; readonly delta: number }
	| { readonly type: 'clearSlide'; readonly toolbar: Toolbar }
	/** Slide release: the two flanking `space` values were written by core. */
	| {
			readonly type: 'resize'
			readonly track: Track
			readonly index: number
			readonly split: number
		}
	| { readonly type: 'structure'; readonly op: LayoutOp }

/** One gesture. Created by `layout.createDrag(target)`; `this.layout` is the
 * live tree, so no method ever takes a layout parameter. */
interface ToolbarDrag {
	readonly layout: PaletteLayoutTree
	/** `null` = the pointer left every container: all lit DZs flip `off`. */
	over(hover: Hoverable | null, sample: PointerSample): void
	/** Push the measured frame when slide-follow (re)arms; `undefined` disarms. */
	measure(frame: SlideFrame | undefined): void
	end(): void
}

/** Created by the tree, not free-standing: `createDrag` resolves the grab
 * target against `this.layout` and throws when it is not there (a drawer
 * child) — so the adapter gets a session only for a real drag. */
function createDrag(target: GrabTarget): ToolbarDrag
```

Core never receives a coordinate *system*, only numbers it is told how to
read. `SlideFrame` is already projected onto the slide axis by the adapter;
`PointerSample` is raw (both client px) and core picks the component matching
the frame's own `axis` — the region the session resolved at `createDrag()`, so an
adapter cannot disagree with core about which way is "along". That is the
whole geometry budget: **one measurement per arm** — a handful per gesture,
not per pointer move — plus core arithmetic (`clampSlideDelta`, pure, lives in
core, single copy with the release commit) and a hit-test-free switch on
`Hoverable.kind`.

`resting` is defined once — *the toolbar's resting leading edge minus `start`*
— and must be re-measured on every re-arm (a re-render changes it).
`clampSlideDelta` returns a shift *from resting*, which is exactly what the
adapter writes as `translate3d`. `available: 0` is a legitimate measurement
meaning "cannot slide right now"; it is distinct from `measure(undefined)`
("not armed"), and core emits no `slide` while unarmed.

`isWholeToolbar` and `mode` are **internal** to the session: they decide
whether a track-gap commit relocates the toolbar or extracts a singleton, and
they are recomputed after every structure event. They are never communicated —
the wire vocabulary is `Hoverable` in, `DragEvent` out.

## Methods

- `createDrag(target)` — the only creator. `tool` (single-item selection; a
  lone item in its toolbar is a whole-toolbar slide from the start), `toolbar`
  (whole-content slide from the start) or `catalog` (creation: no origin, no
  mode — the first placement inserts). Core resolves the origin from
  `this.layout` by `===` scan, derives `isWholeToolbar`/`mode` once, picks the
  region (hence the axis), resets the dwell and the paint baseline. Grabbing a
  gap is an error; a toolbar outside `this.layout` (a drawer child) throws, so
  the adapter never gets a session. `editing` is not a parameter: the adapter
  only creates a session while editing and calls `end()` when the flag flips.
  There is no separate `start()`, because the grab *is* the creation — one
  thing to call, one thing to make fail.
- `over(hover, sample)` — the single place restructure, sliding and dwell
  arming happen. Core computes paint + optional structure + slide delta in one
  atomic step and emits the events in apply order: **structure first, then
  highlight flips, then `slide` / `clearSlide`** — structure first is what lets
  the adapter create/remove nodes and paint them in the same pass. Dark gaps
  emit no structure event and no `on` (restructure happens only on highlighted
  DZs); a structure event resets the paint baseline and is followed by fresh
  paint for the live nodes.
  - `tool` hover paints the active-item fallback (no commit): the nearest free
    gap scanning back from the item and the nearest free one scanning forward.
  - `toolbar` hover does the same anchored on the pointer's item
    (`activeItem`), and while a *whole toolbar* is dragged it instead paints
    the neighbour TB edges (last gap of the previous toolbar, first gap of the
    next one, same track only) — a whole-toolbar drag never paints neighbour
    track gaps.
  - Every hover resolving inside a border track *additionally* paints that
    track's two flanking stack gaps (no commit, emptied veto applies) — the
    stack-gap discovery path. When an item-space side runs dry (every
    candidate touches a dragged item — ABCD with D dragged), the candidate
    moves out to the flanking **track** gap (`slotIndex` / `slotIndex + 1`).
  - While sliding, the two track gaps flanking the moved toolbar are not
    destinations: no paint and no commit (one shared veto).
  - `item-gap` commits a merge: into a border toolbar, or an ownership
    transfer when the located container is parking — the container decides,
    the kind is the same.
  - `track-gap` commits on hover: a slide relocates the toolbar itself, a
    restructure extracts the items into a fresh singleton.
  - `stack-gap` and `outside` paint only; the dwell fires the commit that
    creates a track at that stack.
  - `parking-gap` paints only; the dwell fires the commit that creates a row.
  - Directly hovered stack/parking gaps paint `double`; flanking paints are
    `on`.
- `measure(frame)` — see the geometry note above. Core keeps the frame for the
  whole sliding phase, so per-move cost is arithmetic only.
- `end()` — finalises, geometry-free (the split was computed per move and
  cached). Emits, in apply order: the **`resize`** event when a slide is armed
  (core has already written the two flanking `space` values, so the gaps take
  over exactly where the transform left the toolbar — nothing visibly moves),
  `clearSlide` for the sliding toolbar, then `highlight off` for every lit DZ;
  then drops the session and cancels the dwell. A gesture with no slide emits
  only the highlight clears.

`clearSlide` is the inverse of `slide`: it drops the live `transform`
(write `''`) and disarms the adapter's follow loop for that toolbar. Emitted
whenever the slide stops applying — mode flips slide → restructure on merge,
`measure(undefined)`, the sliding toolbar was pruned/moved so there is nothing
to follow — and always on `end()`. A `slide` with `delta: 0` would leave the
transform attribute and the rAF loop armed; `clearSlide` is the explicit
teardown.

## Adapter responsibilities

- **Hit-test** the element under the cursor from the event target
  (`event.target.closest(...)` + its own node map keyed by `===`) and report a
  tagged `Hoverable`: a tool or toolbar, an `item-gap` on a toolbar, a
  `track-gap` on a track, a `stack-gap` / `outside` on a border, a
  `parking-gap` on the parking stack. Tracks need no separate hit — any
  toolbar/tool/gap inside a track implies its containing track. `null` when the
  pointer is over none of them.
- **Resolve `outside`** for a pointer beyond a border: project it onto the
  border's stack axis and map it to the nearest stack gap of that border (a
  span alongside track *i* resolves to the nearer of gaps *i* / *i+1*), so the
  index space is the border's own.
- **Own the mask and the console panel affordances**: paint the inner end gap
  of each border while the pointer is over the dimmed work zone / overlay
  background, and the parking end gap above/below the parking rect while it is
  over the panel background — applying the core-exported veto predicates
  (`draggingEmptiesTrackIndex` / `draggingEmptiesParkingRow`) yourself. When
  the position maps to a real container (parking end gap), report the normal
  `parking-gap` hover instead of painting privately, so dwell and commit stay
  core's. This is paint-only and consequence-free: it is the "a modal is open"
  affordance, not drag behaviour, which is why it lives here.
- **Measure** a `SlideFrame` when slide-follow arms (at grab time for a
  whole-toolbar or lone-tool grab) and re-measure it after every `structure`
  event (the DOM moved), then push it with `measure()`. Never measure on a
  plain pointer move.
- **Apply** events in emission order with minimal DOM work: `highlight` →
  toggle classes (`on` → `highlighted`, `double` → `highlighted hovered`, `off`
  → neither); `structure` → re-render exactly the tracks named by the
  `move-toolbar` op (`from`/`to`/`pruned`), falling back to one border sync
  only when the track list itself changed (create/prune), and to the console
  pass only for parking-side ops; `resize` → re-read the two gaps' `space`
  and update their flex; `slide` →
  write `transform` (rAF-coalesced); `clearSlide` → drop it.
- **Own** the `pointerup` / `pointercancel` / `blur` / `visibilitychange`
  listeners and call `end()`; mirror the `.dragging` / `data-dragged`
  chrome from the grab target it passed to `createDrag()`.
- **Never derive** mode, whole-toolbar flags, flanks, vetoes, deltas, or
  above/under.

---

## Plan (execution order)

**Gate, stated once — every phase ends here.**

- `pnpm --filter @palettable/core check` + `test`
- `pnpm --filter @palettable/vanilla check` + `test`
- `npx biome check packages/core packages/vanilla tests/e2e`
- `pnpm test:e2e` — the **vanilla** project must be green; the **svelte**
  project may keep its known failures (frozen oracle) but must **gain none**.
  Record the fail set per run (see Phase 0).
- `git status --porcelain packages/svelte` clean.

Core first, vanilla follows, svelte untouched.

### Phase 0 — baseline lock (no behaviour change)

- [x] Measured 2026-09-16: core **282** unit tests / 16 files, vanilla **45** /
  8 files, svelte **179** / 17 files; e2e **57** tests (15 specs; 28 shared ×
  2 projects + `vanilla.spec.ts`).
- [x] e2e result: **53 passed, 4 failed** — every failure is the **svelte**
  project: `edge-stay` (×2), `reorder-forward`, `whole-toolbar`. Those specs
  encode the *new* rules (dry-side track-gap fallback, same-toolbar forward
  index shift, whole-toolbar neighbour TB edges) which vanilla implements and
  the frozen svelte oracle does not. **Decide now**: add those three specs to
  the svelte project's `testIgnore` until Phase 12, or accept the known-fail
  set. Recommendation: `testIgnore` — a gate that is red on a clean tree
  trains everyone to ignore red.
- [x] No test to add: the e2e suite already pins the behaviour. The dual-run in
  Phase 2 covers the wire change.

### Phase 1 — mount the session on the existing stream

The load-bearing phase: it removes the double-apply hazard and the manual
re-render, with **no new behaviour**.

Landed 2026-09-16: `core/drag.ts` (`GrabTarget` / `Hoverable` / `DropZone` /
`PointerSample` / `SlideFrame` / `ToolbarDrag` + `createToolbarDrag`,
`layout.createDrag` a real method taking the engine by injection — no import
cycle), `core/drag.test.ts` (18 session tests), vanilla `ide.ts` on
`createDrag` + `session.over()` (single `toHoverable` hit-test, `overItemGap`
bridge, `sessionState` escape hatch). Gates: core 282, vanilla 45, e2e 53/4
(svelte fail set unchanged), svelte clean, `core build` warning-free.

Review fixes (2026-09-16, same day — three real regressions found by probing):

- **Parking item-gap drops were dead.** `toDragElement` bailed on any toolbar
  not in a border, so an `item-gap` on a parking row committed nothing and
  painted nothing. Now `locateContainerOf` resolves borders **and** parking,
  and a parking row maps to the legacy `parking-row-gap` element (ownership
  transfer). Covered by `drag.test.ts` + new `tests/e2e/parking-drop.spec.ts`.
- **Track background painted one gap instead of two.** The adapter passed the
  track index as a `stack-gap`, which paints only that gap; the legacy `track`
  element paints the flanking pair. `Hoverable` regains a `track` kind (the
  spec's Phase 5 deletion target) and the adapter uses it.
  `stack-highlight.spec.ts` now asserts **exactly 2** gaps (it only asserted
  `> 0`, which is why the regression slipped through).- **Stale paint re-applied.** `over()` returned early on `null` / unmappable
  hovers without clearing `lastDecision`, so the adapter re-applied the
  previous paint. Both paths now clear it, as does `end()`.
- Also: `measure` typed `SlideFrame | undefined` (was `unknown`); the
  `toolbar` + `activeItem` hover is now actually used (it was dead code);
  `paintItemSpaces`'s unused `_fallback` param dropped; one `ZERO_SAMPLE`
  constant instead of two inline literals; the prototype patch replaced by a
  real method with the engine injected (`DragEngine`), removing the rollup
  circular-dependency warning.

- [x] `PaletteLayoutTree.createDrag(target: GrabTarget): ToolbarDrag` —
  `over` / `measure` / `end`, all `void`, `this.layout` held by the session.
  The grab target is passed at creation, so there is no separate `start`.
  Keep `DragElement` as a deprecated alias until Phase 7.
- [x] Route every drag commit through the tree so `LayoutOp` is emitted **and**
- [x] `PaletteLayoutTree.createDrag(target: GrabTarget): ToolbarDrag` —
  `over` / `measure` / `end`, all `void`, `this.layout` held by the session.
  The grab target is passed at creation, so there is no separate `start`.
  Keep `DragElement` as a deprecated alias until Phase 7.
- [x] Route every drag commit through the session so `structure` is emitted
  **and** not re-emitted: inline `item-gap` / `track-gap` commits and the dwell
  stack/parking commits all raise `structure`; the adapter applies the same
  `applyOp` path it already has. `over()` delegates to today's `dragOver`
  internally for the *decision* only — the return-value path (`DragOverDecision`)
  is deleted and the adapter reads nothing back.
- [x] Emission order: **structure first, then highlight flips, then slide** —
  what lets the adapter create/remove nodes and paint them in the same pass.
- [x] Session drops the paint baseline on `structure` (no `off` for nodes a
  re-render destroyed) and re-paints the live nodes from the same `over()`
  pass; vanilla routes `structure` through the existing `applyOp` node-map
  path (prune victims drop nodes) and re-arms slide-follow for the placed
  toolbar (slide geometry moves to core in Phase 4).
- [x] Assert single-writer: no `moveItem` / `moveToolbar` / `insertItem` /
  `removeItem` call from inside a drag session; unit test asserting the tree
  op stream stays silent during a drag and each commit raises exactly one
  `structure` event (`drag.test.ts` "event completeness").
- [x] The session refuses to start when the toolbar is not in the tree
  (replaces the `try/catch` around `dragStart` in
  `startToolDrag`/`startToolbarDrag`).
- [x] Vanilla: one `toHoverable(event): Hoverable | null` helper (`closest(...)`
  + node-map `===` lookup); `paintItemSpaces` / track / stack handlers become
  `over()` calls.
- [x] Verify: reorder-forward / track-drop / stack-highlight e2e green.

### Phase 2 — `highlight` diffs

Landed 2026-09-17: session diffs against its baseline and emits
`highlight off/on` only on change; vanilla applies per-gap toggles directly
(no full-container re-sync — the session already diffed). `applyDragDecision`
return path deleted. Gate: core 300, vanilla 45, `drag-highlight` +
`no-drag-highlight` + `parking-drop` + `stack-highlight` + `track-space` +
`edge-stay` e2e green, biome clean.

- [x] `HighlightState` (`off` / `on` / `double`) + `DragEvent['highlight']`; the
  session diffs against its baseline and emits only on change; a `structure`
  event drops the baseline (the adapter rebuilt those nodes) and the same
  `over()` pass re-emits `on` for what is still live.
- [x] Vanilla subscribes once (per session) and applies:
  `on` → `highlighted`, `double` → `highlighted hovered`, `off` → neither.
- [x] Dual-run one phase: assert the emitted `on` set equals the engine
  decision's paint in unit tests, then flip vanilla to events-only and delete
  `applyDragDecision`'s return path.
- [x] Verify: `drag-highlight` + `no-drag-highlight` + `stack-highlight` e2e green.

Review fixes (2026-09-17 — correctness pass after the Phase 1–3 review):

- **Inline commits emitted no `structure` event.** Only the dwell path did, so
  the adapter still needed a `decision.moved` escape hatch plus a manual
  `syncBorder`/`syncStructure`. Now every commit raises `structure`; the shim
  is deleted from core and the adapter reads nothing back.
- **`stack-highlight` was red on vanilla.** The tightened `toBe(2)` assertion
  landed in Phase 2 but the behaviour it pins (in-track flank derivation) was
  Phase 5 scope — the final pointer step lands on an `item-item-guard`, and the
  `toolbar`/`tool` hover cleared the flanks that the old adapter left alone.
  Fixed here rather than deferred: `over()` now merges the containing track's
  flanking stack gaps (`stackFlanks`, emptied veto) into every in-track hover.
- **`afterStructure()` only cleared the baseline** — it did not re-paint, and
  the plan claimed it did. It now runs the same `paintZones` diff as the
  normal path, so a commit never leaves the UI one event behind.
- Peak-risk note: the e2e web server is `reuseExistingServer`, so a dev server
  started *before* a core change serves stale code. All measurements here used
  a freshly started server.

### Phase 3 — time is core's (dwell home)

Landed 2026-09-17: the dwell lifecycle lives in the session —
arms on a directly hovered `stack-gap` / `outside` / `parking-gap`, cancels
on gap change / `null` hover / `end()`, fires the commit itself as a
`structure` event (`configuration.stackDzHoverMs` unchanged). Vanilla
`pointerup`/`pointercancel`/`blur`/`visibilitychange` only call
`end()` (via `startDragSession`'s `onStop`); editing-flip `end()` landed as
a Phase 6 low-hanging fruit (see below). Core unit tests pin
arm/cancel/fire/latch/veto with fake timers (7 tests in `drag.test.ts`
"session dwell"). Dwell commits route through the tree (`structure` with a
fresh snapshot), and `tests/e2e/dwell-stack.spec.ts` asserts the model
change directly (stack fire, parking fire, leave-cancels).

- [x] `GapDwell` lifecycle moves into the session: arms on a directly hovered
  `stack-gap` / `outside` / `parking-gap`, cancels on gap change / `null`
  hover / `end()`, fires the commit itself as a `structure` event
  (`configuration.stackDzHoverMs` unchanged).
- [x] Vanilla: `pointerup` / `pointercancel` / `blur` / `visibilitychange` +
  editing-flip-false only call `end()`.
- [x] New e2e coverage (`tests/e2e/dwell-stack.spec.ts`, vanilla + svelte
  green): stack creation via hover dwell, parking creation via hover dwell,
  leaving the armed gap cancels the pending fire. Gap→gap retarget is the
  same session path (any non-dwellable hover cancels — pinned by the
  `drag.test.ts` "gap change cancels" unit test); it is not e2e-hittable
  because a non-hovered stack gap is zero-size until painted. One-shot latch
  after a fire is pinned by the `drag.test.ts` latch unit test.
- [x] Core unit test for arm/cancel/fire without timers leaking (fake timers).
- [x] `core/gap-dwell.ts` is session-internal: the session owns the timer
  inline (`drag.ts`); the module stays only for the frozen svelte oracle
  (its own copy is untouched) plus the `phase2.test.ts` pins, and is marked
  `@deprecated Phase 7`.

### Phase 4 — slide geometry home

Landed 2026-09-17: `SlideFrame` + `PointerSample` are the wire types;
`measure(frame | undefined)` stores the frame (`undefined` disarms, never
measured per move); `clampSlideDelta` lives in core (pure, single copy —
`vanilla/slide.ts` is a thin deprecated wrapper, deleted in Phase 7);
the session emits `slide` / `clearSlide` and caches the pending split, so
`end()` is geometry-free (`resize` → `clearSlide` → `highlight off`).
Vanilla `armSlide` measures once per arm, re-measures after every
`structure` event, pushes via `measure()`; the rAF loop only writes what
`slide` events say; `resize` updates the two gaps' flex; `clearSlide` drops
the transform. Unit tests pin `clampSlideDelta`, `slide`/`clearSlide` on
disarm, `available: 0` vs `measure(undefined)`, re-arm across a structure
event, `resize` split equals the
last `slide` delta's position, and subset-drags never sliding
(`drag.test.ts` "slide geometry home", 6 tests + vanilla single-copy
check). Verified: `dark-gap-no-move` + `edge-stay` + `reorder-forward` e2e
green.

- [x] `SlideFrame` + `PointerSample` types; `measure(frame | undefined)` stores the
  frame (`undefined` disarms); never measured per move.
- [x] `clampSlideDelta` moves to core (pure); `getBoundingClientRect` projection
  (`toolbarSlideBounds` / `toolbarGrabOffset`) stays in vanilla. One copy of
  the arithmetic, shared by the per-move delta and the release split
  (plus `layout.commitSlide` for the release write).
- [x] Session emits `slide` / `clearSlide` and caches the pending split, so
  `end()` is geometry-free: `resize` → `clearSlide` → `highlight off`.
- [x] Vanilla: `armSlide` measures once per arm, re-measures after every
  `structure` event, pushes via `measure()`; the rAF loop only writes what
  `slide` events say; `resize` updates the two gaps' flex; `clearSlide` drops
  the transform. The `vanilla/slide.ts` clamp is a deprecated wrapper over
  core (deleted in Phase 7).
- [x] Pin with unit tests: `available: 0` vs `measure(undefined)`, re-arm after a
  structure event, `resize` split equals the last `slide` delta's position.
- [x] Verify: `dark-gap-no-move` + `edge-stay` + `reorder-forward` e2e green
  (slide vetoes + release commit covered).

Low-hanging fruits of Phases 5–6 (landed 2026-09-17, kept, not undone):

- [x] Parking-gap hover wiring in vanilla `renderParking` (`pointermove` →
  `session.over({ kind: 'parking-gap', ... })`, `pointerleave` → `over(null)`)
  — what lets the parking dwell e2e fire.
- [x] Editing-flip `end()`: `syncEditing()` ends the session when editing
  flips false mid-gesture (Phase 6 chrome scope, landed early).

Review fixes (2026-09-17 — from the Phases 3–4 review, kept, not undone):

- **Dwell commits left the UI one event behind.** `fireDwell` (timer
  callback) emitted `structure` + `afterStructure()` with no following
  `paintZones`, unlike the `over()` path. It now re-derives the zones for
  the still-hovered gap against the live layout (`repaintAfterDwell`,
  reusing the last pointer sample for the slide delta). Pinned by two
  `drag.test.ts` tests: parking re-paints live (no `off` after `structure`),
  stack stays dark when the armed gap is veto-adjacent post-commit.
- **A slideless gesture committed a `resize`.** `updateSlide` cached
  `pendingSplit` even at `delta: 0`, so `end()` wrote `space` for a
  toolbar that never moved. Resting now leaves `pendingSplit` undefined
  (pinned: "a gesture with no slide emits no resize").
- **Vanilla never reached the core `resize` path.** `endToolDrag()` called
  `disarmSlide()` (`measure(undefined)` clears `pendingSplit`) *before*
  `session.end()`. Now `end()` runs first (events drive the DOM), then
  `disarmSlide()` drops the rAF loop.
- **Spurious `slide` from paint-only hovers.** `paintItemSpaces` and the
  `pointerleave`/`null` paths passed `ZERO_SAMPLE` while a frame could be
  armed — `clampSlideDelta(frame, 0)` is a large negative delta, not
  inert. All `over()` calls now carry the real `pointerSample(event)`
  (`ZERO_SAMPLE` deleted).
- Gate after fix: core **309**, vanilla 46, e2e **59 passed / 4 failed**
  (all 4 svelte = Phase-0 fail set), biome clean, svelte clean.

Human bug 1 — extraction grab jump (2026-09-17): taking a tool out of a
toolbar shifted the fresh singleton by the width difference ("far too
right / far too left"). Root cause: the re-arm measured the grab off the
fresh toolbar (`pointer − freshLeft`), freezing a gap-sized offset into
every later delta. Fix: capture the mousedown point within the dragged
button at grab time (`slideItemGrab`, off the button wrapper — never the
guard, which bleeds 3px via `inset: -3px`); the re-arm adds it to the
button's fresh offset inside its new toolbar (`extractionGrabOffset` in
`vanilla/slide.ts`, middle fallback mirroring svelte `recenter`). Pinned
by 3 `drag.test.ts` tests; e2e `track-drop` + `whole-toolbar` +
`dwell-stack` green.

### Phase 5 — vocabulary cleanup

**Partially landed 2026-09-17** (kept, not undone): every in-track hover now
derives the containing track's two flanking stack gaps (`stackFlanks` in
`layout.ts`, emptied veto), which is what let `stack-highlight` go green on
vanilla. `track` is therefore no longer the *only* path that paints the
flanks — it is now redundant.

- [x] Delete `track` (no `track-background`). The flank derivation that
  `track` used to own is already in `over()` for every in-track hover, so the
  kind is gone: the vanilla border handler reports a `track-gap` hover for
  track-space targets (commit + flanks in one event), and the
  `stack-highlight` e2e now hovers a real track gap. *(landed 2026-09-19;
  `parking-row-gap` stays — it is the legacy engine's element kind for the
  parking ownership-transfer commit, removed with the engine in Phase 7.)*
- [x] Every in-track hover paints the containing track's two flanking stack gaps
  (emptied veto). *(landed early — see the Phase 2 review fixes)*
- [x] A dry item-space side falls back to the flanking *track* gap; a
  whole-toolbar drag paints neighbour TB edges only; sliding flanks veto paint
  and commit through one shared predicate. *(landed 2026-09-19 as
  session-level pins in `drag.test.ts` "vocabulary cleanup (Phase 5)": ABCD
  with D dragged paints free gap 2 + track gap 1 + both stacks; forward
  hover paints free gaps 0 + 3; whole-toolbar hover paints the neighbour TB
  edge and no track gap; direct flank hover is dark with no commit. The
  engine rules already lived in `layout.ts` (`itemSpaceHighlight` /
  `trackSpaceHighlight` / `wholeToolbarNeighbourEdges` / `isSlidingFlank`,
  pinned in `layout.test.ts`); these pins assert the same rules through the
  session `highlight` event stream.)*
- [x] Directly-hovered stack/parking gaps paint `double`; flanking paints are `on`.
  *(landed 2026-09-17 as human bug 2: the session's `paintZones` takes the
  hover, derives the dwell target, and emits `double` for it / `on` for the
  rest — including `on` ↔ `double` flips on the same gap; the vanilla
  adapter already mapped `double` → `highlighted hovered`. Pinned by 4
  `drag.test.ts` tests + the `dwell-stack` e2e `.highlighted.hovered`
  assertion.)*
- [x] Keep the ABCD-with-D-dragged and same-toolbar-forward unit tests green —
  they are the spec for this phase. *(done 2026-09-19: the session-level
  pins above plus the `layout.test.ts` engine pins and the `edge-stay` /
  `reorder-forward` / `whole-toolbar` e2e specs, all green on vanilla.)*
- [x] Verify: `no-drag-highlight` + `stack-highlight` + `track-space` e2e green.
  (`stack-highlight` already is — full vanilla project 31/31 on 2026-09-19.)

### Phase 6 — `outside`, `catalog`, affordances (last)

Deliberately last: none of it is needed for the core invariant, so a stall
here cannot block Phase 12.

Landed 2026-09-19: core `outside` + `catalog` session support (329 tests),
vanilla `outside` hit-test + mask/panel + catalog source (54 tests), full
vanilla e2e 31 green, svelte fail set unchanged (4 Phase-0). Deferred:
`data-dragged` / `palette-dragging` chrome mirror — setting `data-dragged`
adds `2 × --palette-dz-size` padding to the dragged toolbar (CSS already
has the rules), which shifts every `getBoundingClientRect` the slide +
outside measurements read; wire it only with e2e pins proving the shift is
compensated. `editing`-flip `end()` already landed in Phase 4.

- [x] `outside`: adapter projects beside-border pointers onto the border's stack
  axis (alongside track *i* → nearer of gaps *i* / *i+1*; pure
  `vanilla/outside.ts:outsideGapForTrack`, unit-pinned); core paints and
  dwells it exactly like `stack-gap` (one index space: unified
  `dropZoneKey` `stack:region:gap`, so cross-flips keep `double` without
  `off` + `on`).
- [x] `catalog`: grab with no origin/mode until the first placement inserts
  (detached singleton + `catalogPending`; `item-gap` merges, `track-gap`
  extracts a singleton, stack/parking gaps dwell-create; `from` absent on
  the creation op, subsequent hovers move normally); vanilla builds the
  item via `add-item.ts:itemFromAddSelection` (same factory as the
  discrete flow) on add-panel variant `pointerdown`. The discrete
  `insertItem` console path stays as it is.
- [x] Mask + panel: adapter-owned paint-only, using the core-exported veto
  predicates; the parking end gap reports a normal `parking-gap` hover so
  dwell and commit stay core's, the border mask toggles its own end-gap
  classes directly (never through the session — a mask position maps to
  nothing, so `over(null)` would clear the session's own paint).
- [ ] Chrome: mirror `.dragging` / `data-dragged` from the grab target
  (deferred — see above); an `editing` flip false mid-gesture calls `end()`
  (already landed Phase 4).
- [x] Verify: full vanilla e2e green (31/31); console add/delete flows unaffected.

### Phase 7 — close-out (AGENTS.md protocol)

- [ ] Delete the legacy surface: `dragStart` / `dragOver` → `DragOverDecision`,
  `DragElement`, `DragPointer`, `startDraggingState` / `refreshDragMode` /
  `resolveDragMode` (now session internals), the `wholeToolbarNeighbourEdges`
  return-value form, the `vanilla/slide.ts` leftovers, the Phase-2 dual-run shim.
- [ ] `isWholeToolbar` / `mode` internal to the session — wire vocabulary is
  `Hoverable` in, `DragEvent` out.
- [ ] Migrate the permanent rules to `docs/` per `AGENTS.md`: session contract +
  adapter hit-test/measure/apply duties → `layout-and-drag.md`; event stream +
  single-writer decisions → `architecture.md` §21; then delete this file.
- [ ] Final verification (all green): core check/build/test, vanilla
  check/build/test, `npx biome check`, `pnpm test:e2e`.

## Acceptance

- Vanilla e2e green on all specs, including the new `dwell-stack` specs from Phase 3.
- Svelte project fail set unchanged (the Phase-0 four) and `packages/svelte`
  byte-identical.
- Core unit suite covers: session creation + refusal, `over` per hover kind,
  dwell arm/cancel/fire (fake timers), one `structure` event per commit
  (plus: no stray tree op during a drag), `slide` / `clearSlide` / `resize`
  lifecycle, geometry-free `end()`.
- **Every model→UI transition is an event.** The adapter holds painted and
  measured state only — never a decision, never a return value. No caller of
  `moveItem` / `moveToolbar` / `insertItem` / `removeItem` inside a drag
  session (asserted by test, not by review).

## References

- `packages/core/src/layout.ts` — `PaletteLayoutTree`, `DraggingState`,
  `dragStart`/`dragOver`, `DragOverDecision`, `commitDraggedTo*`, highlight +
  veto helpers (the surface being replaced).
- `packages/core/src/gap-dwell.ts` — timer/latch moving into the session
  (Phase 3).
- `packages/vanilla/src/ide.ts` — `startToolDrag`/`startToolbarDrag`,
  `paintItemSpaces`, `applyDragDecision`, `armSlide`/`disarmSlide`,
  `hoveredTrackSpace` memo (the adapter being rewired).
- `packages/vanilla/src/slide.ts` — clamp/bounds moving to core (Phase 4).
- `packages/vanilla/src/drag-session.ts` — window move/up + blur/hidden
  listeners (kept; they only call `end()` from Phase 3 on).
- `plans/mitosis.md` — svelte stays the frozen oracle until vue parity.
- `plans/phase10.md` — last green baseline + verification commands.

## To see

Read , lines 300 to 509

Read , lines 1 to 80

Searched for files matching `**/tests/e2e/*.spec.ts`, 14 matches

Manual browser tests per phase — all on the vanilla demo (`http://localhost:4174/`). Setup every time: load page, click `Terminal` (opens console → edit mode), use the **left** border (clear of the centered overlay). Use devtools element inspector to check `.highlighted` / `.hovered` classes and `transform` styles.

## Phase 0 — baseline (already locked)

- Tool drag paints: `pointerdown` on item-guard 0, hover item 1 → nearest free item-space gaps get `.highlighted`.
- Hover with no drag paints nothing.
- Dark gap no-move: drag D in ABCD onto gap touching D → stays dark, tools do not reorder.
- Track-gap extract: drag a tool onto a `.toolbar-track-space` → fresh singleton toolbar appears.

## Phase 1 — session shell (landed, test now)

No new behaviour — same as Phase 0, proving the session did not break anything:

- Reorder forward: drag tool B onto gap 3 → lands between C and D, not after D.
- Track-drop: drag onto track gap → new toolbar, keeps dragging as whole-toolbar slide.
- Stack-highlight: hover a track body → two flanking `.toolbar-stack-space` gaps light.
- Drawer-child grab: `pointerdown` on a tool inside an open drawer popup → no crash, no session.
- Release anywhere / `Escape` → all highlights clear, no stuck `.dragging` class.

## Phase 2 — `highlight` diffs

- Move slowly across item gaps: each gap lights on enter, clears on leave — no stuck highlights, no flicker.
- Directly-hovered stack/parking gap shows `.highlighted.hovered` (`double`); flanking-only paints show `.highlighted` alone.
- After a mid-drag restructure (tools jump), paint follows the **new** nodes — no highlight left on a detached node.
- `pointerleave` of every container → all gaps `off`.

## Phase 3 — dwell (new feature, not a refactor)

- Hover a `stack-gap` directly, hold still ~500 ms → new single-toolbar track created at that stack.
- Same on a parking gap → new parking row created.
- Retarget to another gap before the timeout → pending fire cancelled, no track created.
- Stay on the gap after a fire → fires once only (one-shot latch); leave and re-enter → arms again.
- `pointerup` mid-dwell → no fire.

## Phase 4 — slide geometry

- Grab a whole toolbar (bar background) or a lone tool: bar follows the pointer via `transform: translate3d(...)`, gaps untouched.
- Release mid-track → bar snaps to gaps with no visible jump (`resize` wrote the two flanking `space` values); `transform` attribute removed (`clearSlide`).
- Sliding flanks: the two track gaps directly beside the dragged bar never paint and never commit.
- `available: 0` case (bar fills the track): no follow, no `slide`.

## Phase 5 — vocabulary cleanup

- Parking row item gaps behave exactly like border item gaps (merge on hover).
- Every in-track hover (tool, toolbar, item-gap, track-gap) also paints the containing track's two flanking stack gaps.
- ABCD with D dragged, hover D: item gaps beside D stay dark, flanking **track** gap paints instead.
- Whole-toolbar drag: only neighbour TB edges paint (last gap of previous bar, first gap of next bar) — never neighbour track gaps.

## Phase 6 — `outside`, `catalog`, affordances

- `outside`: pointer just beside a border, aligned with a track → nearest stack gap paints + dwells like an in-border `stack-gap`.
- `catalog`: drag from console add-panel → first placement inserts, subsequent hovers move it.
- Mask: pointer over dimmed work zone → inner end gap of each border paints, nothing commits.
- Panel: pointer over console panel background above/below parking → parking end gap paints; parking end gap still dwells + commits.
- `editing` flip to false mid-drag (close console / toggle to run) → session ends, highlights + transform cleared.
- `.dragging` / `data-dragged` chrome mirrors the grabbed tool/toolbar for the whole gesture.

## Phase 7 — close-out

No user-visible change — full regression pass:

- Repeat Phases 1–6 spot checks (highlight, dwell, slide, vocabulary, affordances).
- Console add-flow (add-panel → toolbar) and parking row delete (× button) unaffected.
