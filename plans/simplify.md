# Simplification pass — findings

Prune (remove items) when solved - do not add log, only `TODO`s appear here

## Layer rule (done 2026-09-13)

- `palette/*` refers nothing (self-contained: `configuration.ts` moved in, `defineEditorSpec` lives in `palette.svelte.ts`, `Ide`/`Parking` exported from edition barrel).
- `head/*` refers palette barrel only (`core.svelte.ts` / `edition.svelte.ts`; `Console.svelte` no longer imports `components/Parking.svelte` directly).
- `demo/*` refers palette barrel + head barrel only (`demo/editors/registry.ts` uses `BaseConfigurator`/`defineEditorSpec` from head barrel; demo slider/icons duplicates deleted).


## 2. Dead code (no `src` caller)

- HTML5 catalogue: `PALETTE_CATALOG_DRAG_MIME`, `serialize/parseCatalogDragPayload`, `paletteToolbarItemFromCatalogPayload`, `paletteCatalogEntries`. Zero `draggable=` in `src`. Delete (tests only).
- `commandBoxEnumCommands` / `per-value`: never set by demo/tools. Delete branch.
- Capabilities `flip`, `splitRadio`, `splitButton`, `radio`: no registry entry, no component. Delete from `paletteDefaultEditorCapabilities` + `configuratorPresenter.setEditor()` allow-list. Prune matching CSS (`radio-group`, `split-radio`, `stars-row` extras).
- `PaletteItemMoveContract`, `footprint` (`PaletteEditorFootprint`, all `flags` writes): written, never read. Delete.
- `resolveItemPlacementTarget`: UI never calls it (drag commits directly). Move to test helper or delete.
- `hydratePaletteBorders` wrapper, `popupAddList`, `PaletteItemStructureSection.moveTargets/showText/compact`, `bindings.editable`, `capability.inline/hidden/requiresConfigSurface`: unreferenced. Delete.
- `demoEditors = {boolean:{}, enum:{}, item:{}, run:{}}` (`src/demo/palette.svelte.ts`): empty spreads only for comment. Use top-level spread.
- `editorCapabilities` + `accepts`/`supportedAxes` fallback in `Palette.resolveEditor()`: over-general. Keep static family→variant lookup.

## 3. Generalise

- `draggingEmptiesTrackIndex` + `draggingEmptiesParkingRow` → `draggingEmptiesContainer()`.
- `nearestFreeItemSpaceBefore/After` + `isItemSpaceFree` → single `nearestFreeItemSpace(toolbar, from, dir)`.
- `isDraggingWholeToolbar` ⊂ `isDraggedToolbarAt`. Keep latter.
- `regionDirection` vs `surfaceContextFromScope` vs `headLayoutFromSurface` vs `headRegionFromScope` (last used once): one `axisFromRegion()`.
- `itemFingerprint`/`canonicalItemTool`/`stableStringify`: `JSON.stringify` per hover. Replace with index key or memoised id.
- `findOwnershipViolations`: test-only. Move to `tests` helper, drop from edition barrel.

## 4. CSS instead of JS

- `src/lib/palette/components/Ide.svelte:maskHover`, `Console.svelte:parkingMaskHover` + `closest()` hit-tests → CSS `:hover`/`:has()` on center/panel. Deletes ~60 lines + 2 handlers.
- `hoveredItemSpace/activeItem`, `hoveredTrackSpace`, `hoveredStack/activeTrack`, `hoveredGap/activeRow` highlight state → CSS `:hover` on DZ. JS keeps only `pointerenter` commit. Halves 4 components.
- `paletteItemShield` (`element.inert = active`) → CSS `pointer-events:none`. Delete action.
- `paletteRoot` class/data mirroring (`setPaletteRootClass/Data/Id` + 2 `$effect` in `src/lib/palette/layout.svelte.ts`) → `class:editing` / `data-editing` bindings in `Ide.svelte`. Action keeps only `keydown`.
- `trackGapMinGrow` floor + inline `flex-basis/grow` → CSS `min-width/height: var(--palette-dz-size)` on gaps.
- Slide engine (~150 lines: `toolbarSlideBounds`, `clampSlideDelta`, rAF loop, `grabOffset`/`recenter`/`bounds`) → write `transform` directly on `pointermove`, or fixed-position ghost. Drop rAF + bounds re-measure.
- Drawer `syncPopup()` rect math + `resize/scroll` listeners → CSS anchor/`popover` or placement classes.
- `Toolbar::before` overlay + `content:none` overrides: single border rule suffices.
- `Console.svelte:<style>` mode-button block → `head-default.css`.

## Proposed order

1. Deletions (dead caps, catalogue, footprint, move-contract) — ~400 lines, zero behaviour change.
2. CSS conversions (mask, shield, root classes, DZ highlight).
