# Phase 10 — vanilla demo parity (handoff, landed 2026-09-14)

First parity gate. Status: **core + vanilla**, green. `packages/svelte/src` is
**out of scope** (frozen oracle, per mitosis).

## Goal

Vanilla demo = same Stellar Outpost demo as svelte. Both demos run the same
`tests/e2e/` suite. Unlocks Phase 11, not Phase 12.

## Delivered

| File | Contents |
| ---- | -------- |
| `packages/vanilla/src/keys.ts` | Adapter-side `KeyboardEvent` ownership: `normalizeKeystroke`, `keystrokeFromEvent`, `createVanillaKeys` + `isEditableTarget`. |
| `packages/vanilla/src/head.ts` | Plain-DOM head editors: `renderButton/Toggle/Select/Segmented/Slider/Stepper/Stars/Status/CommandBox/Drawer` + `renderHeadItem` + `surfaceForRegion`. |
| `packages/vanilla/src/ide.ts` | `createIDE(container, options)` — `palette-ide` + tabindex, work-zone wrap, 4 borders + parking + console overlay. |
| `packages/vanilla/src/nodes.ts` | `NodeRegistry` — live object → `HTMLElement`, keyed by `===`. |
| `packages/vanilla/src/highlight.ts` | `syncGapClasses` / `clearGapClasses` — gap-class diffing. |
| `packages/vanilla/demo/palette.ts` | Plain-data port of the svelte demo (15 points, `demoKeys`, 3 configs + layouts). |
| `packages/vanilla/demo/main.ts` | Parity page (demo-bar, `createIDE`, values→`demoState` sync, localStorage persistence). |

## Core surface landed (do not re-open)

- **Identity contract** — `getLayout()` live + read-only; `setLayout()` for
  whole loads; `getSnapshot()` for save. Deep-clone test updated.
- **Op stream** — `LayoutOp` + `subscribeOps`, `from?`/`to?` convention
  (no `from` = creation, no `to` = deletion), prune-cascade victims.
- **Movement commits + veto helpers + gap-highlight decisions** — all in
  `core/layout.ts`, all taking an explicit `DraggingState` param (no global
  reads).
- **Drawer content is one `Track`** — `DrawerToolbarItem.toolbar: Track`,
  `ResolvedDrawerSlot[]` in `render.ts`, vanilla renders it.
- **Editing chrome / value sync / console isolation** — landed in `ide.ts`
  (`syncEditing` + `applyEditing`, `bindTool` + `updateToolNode`,
  `setInspecting` + `renderConsoleDetails`).
- **`can` flips** — `subscribeCan` → `disabled` in place.

## Remaining — core + vanilla

### A. Vanilla drag session (landed)

- [x] Pointer session: `startDragSession` (`drag-session.ts`) — `pointerdown` →
      session, window `pointermove`/`pointerup`/`pointercancel`/`blur` +
      `visibilitychange`, `GapDwell` hover → `commitDraggedTo*` (`ide.ts`:
      `startSession`, `attachTrackDrag`, `paintStackGaps`/`paintParkingGaps`/
      `paintItemSpaces`).
- [x] Commit results feed `NodeRegistry` op-driven, not rebuild (`applyOp` →
      `syncBorder` per region + `nodes.delete` for moved items/victims).
- [x] Drag-end: `dragDirty` → single `getSnapshot()` → one `onLayoutChange`
      call (`endDragSession`; demo persists). No core batching API — vanilla
      owns it.

### B. Track sliding with rAF (landed)

- [x] `pointermove` writes `latestPointer` + enqueues `flushSlideTransform` in
      `slideCallbacks` + `dirty = true` only (`startSession.onMove`).
- [x] Persistent `requestAnimationFrame` loop drains the `Set` + clears per
      frame, writes `toolbarElement.style.transform = translate3d(...)`. Gaps
      untouched during the slide; single `resizeToolbar` commit on release,
      then `transform = ''` (`slideLoopTick`/`flushSlideTransform`/
      `endDragSession`).
- [x] Dirty generalized to `Set<callback>` drained + cleared per frame
      (`slideCallbacks`; `Set` dedupes repeated moves before a frame).
- [x] Mid-drag re-target: `rearmSlideAfterCommit` → `retargetSlide` over the
      new element (re-measure bounds, keep grab delta; `recenter` on
      restructure promote).
- [x] `hoveredTrackSpace` idempotency memo (same gap = no-op; kept after
      commit so the fresh toolbar under the pointer does not double-commit).

### C. Per-node delta (landed)

- [x] `diffBorder`/`diffTrack`: create/drop delta nodes only, move existing
      nodes with `insertBefore`, update track-space `flexBasis`/`flexGrow` in
      place (`actualTrackSpaceAt` + `trackGapMinGrow` floor). `renderBorder`
      tries the diff first, rebuilds only when framing disagrees.
- [x] `applyOp` consumes `LayoutOp` prune victims (`nodes.delete` + victim
      regions re-sync, parking-side → console pass).

### D. Slide math home (landed — adapter-owned)

- [x] `slide.ts`: `toolbarSlideBounds` + `clampSlideDelta` +
      `toolbarGrabOffset` live in vanilla (need `getBoundingClientRect`;
      never in core). Single-copy rule: rAF write + release commit share
      `clampSlideDelta`.
- [x] Commit on release is `resizeToolbar` (gaps untouched during slide); no
      `commitSlide` — rejected as over-engineering.

### E. Configurator rebuild (landed)

- [x] `patchLive(path, patch, rebuildTool?)`: value/label/icon/hint/tone
      mutate live + `updateToolNode` in place + `renderConsoleDetails` (no
      border rebuild per keystroke). Editor-type swap passes `rebuildTool`
      → full tool rebuild with initial values. "No `updateItem` in core"
      holds.

### F. Console add flow (landed)

- [x] Add-panel insert wired: `renderAddPanel` → `itemFromAddSelection`
      (`add-item.ts` via `resolveEditorVariant`) → `moveToolbar` (empty top)
      / `moveItem` (append) + clear selection.
- [x] Delete via `moveItem(from, undefined)` → op diff prunes empty
      toolbars/tracks + `setInspecting(undefined)` refreshes details.

### G. Drawer popups (landed)

- [x] `repositionDrawers()` on every `applyOp` path (triggers may have
      moved); drops detached popups.
- [x] Drawer children render via `renderDrawerTrack` sharing the border
      `NodeRegistry` (`===` keys, same `moveItem`/`moveToolbar` ops).

## Verification (green 2026-09-15)

- `pnpm --filter @palettable/core check/build/test` — 242/15.
- `pnpm --filter @palettable/vanilla check/build/test` — 22/6.
- `npx biome check packages/core packages/vanilla tests/e2e playwright.config.ts` — clean.
- `pnpm test:e2e` — 35 passed (incl. `drag-highlight`: tool drag paints a
  free item-space DZ on both demos).

## References

- Permanent record: `docs/architecture.md` §19 + §21 ("Phase 10 status",
  "Layout mutation, identity and the op stream", "Vanilla adapter —
  reconciliation and DOM identity"), `docs/movements.md`.
- Retired checklist: `plans/mitosis.md` "Phase 10".