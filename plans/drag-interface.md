# Drag interface refactor — session + events (active plan)

> Status: **active plan — not started.** Normative spec is below
> (`Decisions` / `Types` / `Methods` / `Adapter responsibilities`);
> the execution checklist is `Plan` (this file tracks only what is left).
> `packages/svelte/src` is **out of scope** (frozen oracle, per mitosis).
> Order: `core` first, then `vanilla`. The gate is **vanilla green + svelte
> fail-set unchanged**, not "everything green" — see `Plan`.

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
- **Paint events are diffs; structure events are whole ops.** `highlight` is
  emitted only when a gap's paint actually changed (`off` / `on` / `double`),
  and `structure` carries a `LayoutOp` verbatim. A structure event resets the
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
  → neither); `structure` → create/move/remove nodes via the node map;
  `resize` → re-read the two gaps' `space` and update their flex; `slide` →
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

- [ ] Measured 2026-09-16: core **264** unit tests / 15 files, vanilla **45** /
  8 files, svelte **179** / 17 files; e2e **55** tests (14 specs; 27 shared ×
  2 projects + `vanilla.spec.ts`).
- [ ] e2e result: **51 passed, 4 failed** — every failure is the **svelte**
  project: `edge-stay` (×2), `reorder-forward`, `whole-toolbar`. Those specs
  encode the *new* rules (dry-side track-gap fallback, same-toolbar forward
  index shift, whole-toolbar neighbour TB edges) which vanilla implements and
  the frozen svelte oracle does not. **Decide now**: add those three specs to
  the svelte project's `testIgnore` until Phase 12, or accept the known-fail
  set. Recommendation: `testIgnore` — a gate that is red on a clean tree
  trains everyone to ignore red.
- [ ] No test to add: the e2e suite already pins the behaviour. The dual-run in
  Phase 2 covers the wire change.

### Phase 1 — mount the session on the existing stream

The load-bearing phase: it removes the double-apply hazard and the manual
re-render, with **no new behaviour**.

- [ ] `PaletteLayoutTree.createDrag(target: GrabTarget): ToolbarDrag` —
  `over` / `measure` / `end`, all `void`, `this.layout` held by the session.
  The grab target is passed at creation, so there is no separate `start`.
  Keep `DragElement` as a deprecated alias until Phase 7.
- [ ] Route every drag commit through the tree so `LayoutOp` is emitted **and**
  not re-emitted: the session owns the emit, the adapter applies the same
  `applyOp` path it already has. `over()` delegates to today's `dragOver`
  internally and emits `structure` when it moved; delete the return-value
  path (`DragOverDecision`) once the stream carries it.
- [ ] Emission order: **structure first, then highlight flips, then slide** —
  what lets the adapter create/remove nodes and paint them in the same pass.
- [ ] Session resets paint baseline on `structure` + re-paints the live toolbar
  (incl. re-emitting `slide` for the element that now exists); vanilla replaces
  manual `syncBorder`/`syncStructure` after `moved` with the existing `applyOp`
  node-map path (prune victims drop nodes).
- [ ] Assert single-writer: no `moveItem` / `moveToolbar` / `insertItem` /
  `removeItem` call from inside a drag session; unit test that a drag emits
  exactly one op per commit.
- [ ] The session refuses to start when the toolbar is not in the tree
  (replaces the `try/catch` around `dragStart` in
  `startToolDrag`/`startToolbarDrag`).
- [ ] Vanilla: one `toHoverable(event): Hoverable | null` helper (`closest(...)`
  + node-map `===` lookup); `paintItemSpaces` / track / stack handlers become
  `over()` calls.
- [ ] Verify: reorder-forward / track-drop / stack-highlight e2e green.

### Phase 2 — `highlight` diffs

- [ ] `HighlightState` (`off` / `on` / `double`) + `DragEvent['highlight']`; the
  session diffs against its baseline and emits only on change; a `structure`
  event resets the baseline and is followed by fresh paint for the live nodes.
- [ ] Vanilla subscribes once (layout stream, next to `subscribeOps`) and applies:
  `on` → `highlighted`, `double` → `highlighted hovered`, `off` → neither.
- [ ] Dual-run one phase: assert event-applied paint === return-applied paint in
  unit tests, then flip vanilla to events-only and delete
  `applyDragDecision`'s return path.
- [ ] Verify: `drag-highlight` + `no-drag-highlight` e2e green.

### Phase 3 — time is core's (dwell home)

Not a refactor: vanilla stack/parking dwell-drop **does not exist today**, so
this phase adds the feature the spec promises.

- [ ] `GapDwell` lifecycle moves into the session: arms on a directly hovered
  `stack-gap` / `outside` / `parking-gap`, cancels on gap change / `null`
  hover / `end()`, fires the commit itself as a `structure` event
  (`configuration.stackDzHoverMs` unchanged).
- [ ] Vanilla: `pointerup` / `pointercancel` / `blur` / `visibilitychange` +
  editing-flip-false only call `end()`.
- [ ] New e2e coverage (this phase cannot be "kept green", it must go green):
  stack creation via hover dwell, parking creation via hover dwell, retarget
  cancels the pending fire, one-shot latch after a fire.
- [ ] Core unit test for arm/cancel/fire without timers leaking (fake timers).
- [ ] `core/gap-dwell.ts` becomes session-internal: keep it as the timer the
  session uses (svelte's own copy stays untouched).

### Phase 4 — slide geometry home

- [ ] `SlideFrame` + `PointerSample` types; `measure(frame | undefined)` stores the
  frame (`undefined` disarms); never measured per move.
- [ ] `clampSlideDelta` moves to core (pure); `getBoundingClientRect` projection
  (`toolbarSlideBounds` / `toolbarGrabOffset`) stays in vanilla. One copy of
  the arithmetic, shared by the per-move delta and the release split.
- [ ] Session emits `slide` / `clearSlide` and caches the pending split, so
  `end()` is geometry-free: `resize` → `clearSlide` → `highlight off`.
- [ ] Vanilla: `armSlide` measures once per arm, re-measures after every
  `structure` event, pushes via `measure()`; the rAF loop only writes what
  `slide` events say; `resize` updates the two gaps' flex; `clearSlide` drops
  the transform. Delete the `vanilla/slide.ts` clamp copy.
- [ ] Pin with unit tests: `available: 0` vs `measure(undefined)`, re-arm after a
  structure event, `resize` split equals the last `slide` delta's position.
- [ ] Verify: `dark-gap-no-move` + `edge-stay` + `reorder-forward` e2e green
  (slide vetoes + release commit covered).

### Phase 5 — vocabulary cleanup

- [ ] Delete `parking-row-gap` (parking item gaps are plain `item-gap`; core
  resolves the container) and `track` (no `track-background`).
- [ ] Every in-track hover paints the containing track's two flanking stack gaps
  (emptied veto); a dry item-space side falls back to the flanking *track*
  gap; a whole-toolbar drag paints neighbour TB edges only; sliding flanks
  veto paint and commit through one shared predicate.
- [ ] Directly-hovered stack/parking gaps paint `double`; flanking paints are `on`.
- [ ] Keep the ABCD-with-D-dragged and same-toolbar-forward unit tests green —
  they are the spec for this phase.
- [ ] Verify: `no-drag-highlight` + `stack-highlight` + `track-space` e2e green.

### Phase 6 — `outside`, `catalog`, affordances (last)

Deliberately last: none of it is needed for the core invariant, so a stall
here cannot block Phase 12.

- [ ] `outside`: adapter projects beside-border pointers onto the border's stack
  axis (alongside track *i* → nearer of gaps *i* / *i+1*); core paints and
  dwells it exactly like `stack-gap`.
- [ ] `catalog`: grab with no origin/mode until the first placement inserts; the
  discrete `insertItem` console path stays as it is.
- [ ] Mask + panel: adapter-owned paint-only, using the core-exported veto
  predicates; the parking end gap reports a normal `parking-gap` hover so
  dwell and commit stay core's, everything else reports `null`.
- [ ] Chrome: mirror `.dragging` / `data-dragged` from the grab target; an
  `editing` flip false mid-gesture calls `end()`.
- [ ] Verify: full vanilla e2e green; console add/delete flows unaffected.

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

- Vanilla e2e green on all 14 specs, plus the new dwell specs from Phase 3.
- Svelte project fail set unchanged (or those three specs ignored until
  Phase 12) and `packages/svelte` byte-identical.
- Core unit suite covers: session creation + refusal, `over` per hover kind,
  dwell arm/cancel/fire (fake timers), one `structure` event per commit,
  `slide` / `clearSlide` / `resize` lifecycle, geometry-free `end()`.
- No caller of `moveItem` / `moveToolbar` / `insertItem` / `removeItem` inside
  a drag session (asserted by test, not by review).

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