# Toolbar movement & reorganisation

Engine: `src/lib/palette/layout.svelte.ts` (layout primitives + drag actions).
For the data model itself see `docs/layout-and-drag.md` and
`docs/architecture.md`.

## Principles

1. **Previewing is moving.** A drag session cannot be escaped or cancelled:
   once activated, releasing commits whatever is on screen. The moved element
   is removed from its origin **only when it has been added elsewhere**.
2. **Toolbar** moves between stacks and tracks.
3. **Tool → track/stack** creates a singleton toolbar; **tool → toolbar**
   merges.
4. **Emptying a toolbar removes it** (and its track, if that empties too).
5. **Candidate targets mini-expand** when the pointer gets near.
6. **Deletion is not drag.** The only ways to remove an editor are editing the
   editor (a "delete" button on its edit surface) or moving it to parking and
   removing it from there.

## The drag session

`palettes.dragging` holds the live session:

| Field | Meaning |
| ----- | ------- |
| `palette` | The palette instance the drag belongs to. |
| `tools` | The selected tools (one tool, or a whole toolbar's content). |
| `origin` | `{ kind: 'border', toolbar, track, border }` or `{ kind: 'parking', toolbar, parking, index }` — where those tools currently live. Refreshed after every commit. |
| `mode` | `'restructure'` or `'slide'` — what the selection *means right now*. |
| `grabOffset` | Pixel delta of the cursor within the dragged toolbar. Absent for a restructure drag (its toolbar does not exist yet). |

### Mode is derived, cached, and recomputed on structural change

One question drives the whole engine: **"is there anything else than my
dragged tools left in my toolbar?"**

- **no** → `'slide'`: the selection is the toolbar's entire content, so the
  toolbar itself is what moves. True whether the grab was a whole toolbar or a
  single tool that happens to be its only item.
- **yes** → `'restructure'`: the tools are a subset, so the origin toolbar stays
  behind and a track-gap commit extracts them into a fresh singleton toolbar.

The mode is recomputed after **every structural commit** (`refreshDragMode`),
never re-derived per pointer move. Two consequences:

- A restructure *becomes* a slide once its tools have been placed in their own
  toolbar — so later gap hovers relocate that toolbar instead of re-extracting.
- A slide *becomes* a restructure as soon as a merge puts other tools back
  beside the selection — which is what stops sliding the instant a toolbar is
  cast into another one (`ToolbarTrack`'s arming `$effect` no longer matches and
  actively calls `clearToolbarSlide`).

Without a recorded mode, a drag that started inside a multi-tool toolbar reads
as "partial" forever and each new gap hover builds *another* toolbar holding the
same tools. A recomputed-per-move predicate is also *unstable across commits*,
which is why the mode is cached rather than derived on demand.

### Commits

- **Item space** (`commitDraggedToItemSpace`): the dragged tools are spliced
  into the target border toolbar at the given item-space index, from either
  origin container via `pruneDragOrigin` (a parking drag becomes a border
  drag after landing). The mode is then recomputed; a merge into a populated
  toolbar ends sliding.
- **Parking row** (`commitDraggedToParking`): ownership-transfer move into a
  parking toolbar — the tools leave the origin container (border toolbar
  pruned when emptied, parking row pruned when emptied) and the session
  origin becomes `{ kind: 'parking', … }`. Parking is a plain
  `Stack<Toolbar>`: its stack gaps dwell-drop like border stack gaps (see
  below), drops also land via the toolbar item-space DZs — never by
  hovering a gap alone.
- **Track gap** (`commitDraggedToTrackSpace`): one branch on the mode read
  *before* mutating, for either origin container (a parked row slides out of
  its stack into the track; a parked subset extracts into a fresh toolbar).
  - `'restructure'`: extract the tools into a fresh singleton toolbar at the
    gap (splitting it 50/50), prune the origin if it emptied.
  - `'slide'`: relocate `origin.toolbar` **itself** — identity preserved,
    never cloned, tools never re-extracted.
  - While *sliding*, the two gaps flanking the moved toolbar are a no-op:
    hovering them is just continuing to move the toolbar. The guard lives
    inside the commit, so callers need no geometry of their own. It is
    deliberately **not** applied to a restructure — pulling a tool out and
    dropping it into the gap right beside its own toolbar is a valid move.
    A parking origin never shares the target track, so the flanking guard
    and the index-shift adjustment only apply to border origins.

Both refresh `dragging.origin` so the next hover moves from the new location,
and both adjust the gap index for the shift caused by pruning the origin from
a shared track.

### Stack gaps

Gaps between tracks (stack DZs, `data-stack-index`) accept drops via a hover
dwell — unlike track gaps, they never commit on hover alone. A *directly*
hovered stack DZ (`hoveredStack` in `ToolbarBorder`) arms a one-shot
`configuration.stackDzHoverMs` timer; on fire
`commitDraggedToStackSpace(targetBorder, stackIndex)` creates a new
single-toolbar track at that stack. Track-hover flanking highlights and the
modal-mask inner DZ (`maskActive`) never arm — direct hover only.

Cancel rules: the timer cancels on stack change (moving to another DZ
restarts it), border leave, or drag end (mouse-up clears `palettes.dragging`,
which the arming `$effect` observes). It fires exactly once per hover:
leaving the DZ resets the latch, so holding the pointer still after a fire
builds no second track.

Mode branches mirror `commitDraggedToTrackSpace`: `'slide'` relocates
`origin.toolbar` itself (identity preserved), `'restructure'` extracts the
subset into a fresh singleton in the new track. Either origin container works
(a parked row slides out of its stack; a parked subset extracts into the
border), and cross-border moves are allowed — the commit takes the target
border, so west-to-north lands in the north border. The emptied-track veto
(`draggingEmptiesTrackIndex` against the *target* border) lives in the commit
as well as the highlight, and the origin is pruned when emptied
(`pruneDragOrigin` / `removeToolbar` + `removeEmptyTrack`). The stack index is
adjusted for a same-border prune (`prunedTrack < stack → stack − 1`), and the
placed track is read back out of the border (proxy hazard, same as track
gaps). The commit promotes a restructure into a slide (`refreshDragMode`),
and the border arms slide-follow over the fresh toolbar immediately
(`retargetToolbarSlide` with `recenter` when the drag has no grab delta yet),
so the new toolbar sticks under the cursor and moves along the track gaps —
the track's declarative `$effect` takes over once the DOM flushes.

### Identity and reactive state

An instantiated tool is `tool + editor + config + position`: the same
tool+config object must never live in two containers (single ownership).
`canonicalItemTool` strips setter (`=`/`|`)/action (`:`) suffixes,
`itemFingerprint` hashes canonical tool + editor + stable-stringified config,
and `findOwnershipViolations({ borders, parking })` flags shared `===`
references and structural duplicates. Position is part of instance identity:
`isDraggingWholeToolbar` only matches the session's own origin toolbar and
`isDraggedToolbarAt` additionally compares the container (`border` track +
border vs `parking` stack + index) — so a parking row can never light up as
the dragged toolbar of a border drag, even holding the same object.

Parking is an independent stack (`PaletteParking`), never a view over a
border — a plain `Stack<Toolbar>`: its stack gaps dwell-drop like a border's
(`commitDraggedToParkingRow` on `configuration.stackDzHoverMs`, direct hover
only, same cancel/once rules), and drops also land via the toolbar
item-space DZs through `commitDraggedToParking`. `Console` always renders `parking` (persisted via
`serialize`/`hydrate`) — empty parking stays visible as a bordered strip with
a hint, so its single gap stays hittable. Rows commit through the parking
path and prune via `removeParkedToolbar`.

Parking gaps react like a border's stack gaps: zero-size until highlighted,
`highlighted` (to `--palette-dz-size`) while editing + dragging, doubled with
`hovered` on direct hover. Hovering a row highlights its two flanking gaps;
hovering a gap directly highlights only that one. Gaps flanking a row the
drag would empty stay dark (`draggingEmptiesParkingRow`, the parking analogue
of `draggingEmptiesTrackIndex`). While a drag is active and the pointer is
over the console panel background (outside rows/gaps/popups), the end gap
stays lit via the `maskActive` prop — the console analogue of `Ide`'s mask
hover. Gap indices are real stack indices, never filtered-view positions, so
hidden commandBox-only rows never collapse the numbering.

The border is `$state`, so a toolbar stored in a track is a *proxy* of the
array that was inserted. The commit therefore reads the placed toolbar back
out of the track (`targetTrack[index].toolbar`) instead of reusing its local
reference — otherwise every later identity lookup (`findIndex`, `includes`)
misses, which is exactly what allowed a duplicate toolbar to be built.

## Track gaps

Gaps between toolbars are drop zones. Hovering one commits immediately; the
newly created toolbar *is* the visual feedback, so gaps are deliberately
**never highlighted** (there is no `highlighted` class on track gaps).

The hover memo (`hoveredTrackSpace`) is the idempotency guard: the pointer is
usually still over the same physical gap on the next move, with the committed
toolbar now under it. Two rules keep that safe:

- After a commit the memo records the committed gap — it is **not** reset to
  `undefined`.
- Moving inside a toolbar does **not** clear the memo (the fresh toolbar sits
  under the pointer right after a commit).

## Toolbar slide

Sliding a whole toolbar must feel like grabbing it at a fixed point: the
cursor stays at the same spot on the toolbar while it moves. Toolbars have
fixed pixel widths, so the slide is computed in **pixels**, not track
fractions — the gaps absorb all motion and the toolbar span is constant.

Notation (pixels, horizontal; swap axes for vertical):

- `G` — total free gap width: `G = trackWidth − Σ toolbar[n].width`.
- `budget = (spaces[i] + spaces[i+1]) × G` — the two gaps around toolbar `i`,
  constant during the drag, so the neighbours never move.
- `left = Σ_{n<i} (spaces[n] × G + toolbar[n].width)` — fixed left boundary;
  `right = left + budget`.
- `x₀`, `t₀` — cursor and toolbar left-edge positions captured on mousedown.

Per move, keep the cursor at its fixed offset on the toolbar and clip the
leading gap to its budget:

```
x    = clamp(x − x₀ + t₀, left, right)
spaces[i]   = (x − left) / G
spaces[i+1] = budget − spaces[i]
```

`left`/`right` are read directly from the `.toolbar-track-slot` siblings
(leading/trailing gap elements), which sit between the two gaps — no registry
or width bookkeeping is needed.

**Neighbour invariant.** `resizeToolbar` rebalances only `space[i]` and
`space[i+1]`, whose sum is constant, and the per-frame `transform` never
touches layout. A toolbar to the right of `[left-gap + TBx + right-gap]`
therefore cannot move on its own.

During the drag the gaps are never resized: the toolbar follows the pointer
via `element.style.transform = translate3d(...)` (compositor only), and a
single `resizeToolbar` commit lands on release. `clampSlideDelta` is the one
copy of the slide math, shared by the per-frame write and the release commit,
so the visual position and the committed `space` can never disagree.

Slide-follow is armed **declaratively**: an `$effect` in `ToolbarTrack` keyed
on `mode === 'slide' && origin.track === track` reads the sliding toolbar's
live element and arms `retargetToolbarSlide`; when the mode is no longer
`'slide'` the same effect **disarms** (`clearToolbarSlide`). It is the only
disarm path for a mode change. `$effect` runs after Svelte flushes the DOM, so
a freshly committed toolbar is already measurable — no manual `tick()`, no
attribute-selector lookup from the pointer handler.

### The slide anchor

`bounds.start` is the **leading gap's** edge, but the toolbar rests one
leading-gap further in (`start + leadingGapWidth`). The anchor is that resting
offset, so `clampSlideDelta` returns a shift *from the resting position* —
which is what `transform` is relative to:

```
offset0 = rect.left − bounds.start            (the leading gap's width)
delta   = clamp(pointer − grabOffset − bounds.start) − offset0
transform = translate3d(delta, 0, 0)
```

Anchoring on `bounds.start` instead leaves the toolbar out by one
leading-gap (observed as "roughly a toolbar size" of error after a restructure
lands in a gap). For a whole-toolbar grab the shift is `0` at arm time (no
jump); for a recentered restructure it is measured from the toolbar's resting
spot, so the toolbar lands centered on the cursor.

## Session lifecycle

`startPaletteDragSession` (`drag-session.ts`) installs window-level
`pointermove`/`pointerup`/`pointercancel`/`blur` listeners plus a document
`visibilitychange` listener. There is deliberately **no pointer capture**:
capturing on the drag-origin element retargets every subsequent move to that
element, so `target` never leaves the origin and the drop zones freeze.

There is also deliberately **no activation threshold**: a drag is live from
`pointerdown`, and a commit happens on hover, not on release. A zero-pixel
click is therefore a legitimate no-op drag rather than a cancelled one.

## Invariants

- **Conservation** — a move never loses or duplicates a tool.
- **Cleanup** — an emptied toolbar is removed, and its track too when that
  empties.
- **Deletion is not drag** — see principle 6.
- **Gap total** — stored spaces plus the implicit trailing gap always sum to
  `1` (see `docs/layout-and-drag.md`).
