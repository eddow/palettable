# Layout and drag (historical svelte reference + live core engine)

> Frozen svelte paths (`src/lib/palette/*`, `DrawerEditor.svelte`) are kept
> verbatim as the port reference. The live engine is `packages/core/src/layout.ts`
> + `drag.ts`, the live renderer `packages/vanilla/src/ide.ts`.

Engine: `src/lib/palette/layout.svelte.ts` (pure helpers + Svelte actions).
Session helper: `src/lib/palette/drag-session.ts` (pointer capture + window
move/up, blur/cancel cleanup; no preview element). Components:
`src/lib/palette/components/` (`Ide`, `ToolbarBorder`, `ToolbarTrack`,
`Toolbar`, `PaletteItem`, `Parking`, `DrawerEditor`, `DrawerPopup`).

## Borders, tracks, toolbars, parking

`PaletteBorders` = `{ top, right, bottom, left }`. A border is a list of tracks;
a track is a list of `{ space, toolbar }` slots; a toolbar is a list of items.
`PaletteParking` is an independent stack of toolbars outside the borders — it
owns its toolbars outright (single ownership: no object is ever shared with a
border) and persists via `serialize`/`hydrate`.

### Track spacing invariant

Each toolbar in a track carries a `space` — the proportion of *the track's free
space (everything not taken by toolbars)* allotted to the gap **before** that
toolbar. A track of `N` toolbars therefore stores `N` `space` values, plus one
**implicit trailing gap** `space[N]` (the gap after the last toolbar). The full
gap array is:

```
spaces[0..N] = [space₀, space₁, …, spaceₙ₋₁, 1 − Σ space₀..ₙ₋₁]
```

so the sum of all gaps (stored + implicit) is always exactly `1`. Every
`space` is clamped to unit (`clampUnit`), and the trailing gap is whatever
remains of the total — never stored, always derived.

- `actualTrackSpaceAt(track, i)` — the gap at position `i` (`i ≤ N`).
- `actualTrackSpaces(track)` — the full `spaces[0..N]` array (sums to 1).
- `insertToolbar` / `removeToolbar` / `resizeToolbar` splice this array and
  rewrite the `N` stored slots via `applyTrackSpaces`; the trailing gap stays
  implicit, so the total is conserved across every mutation.

- `Ide` takes four optional borders + center slot, publishes `{ palette }` scope.
- `ToolbarBorder` renders one region (`inverse` reverses track order for
  right/bottom); direction `horizontal` (top/bottom) or `vertical` (left/right).
- `ToolbarTrack` renders slots + spacing; `Toolbar` renders one toolbar with
  item spaces (between items) and a toolbar space at index 0. It takes either
  a border location (`border`/`track`/`trackIndex`/`region`) or a parking
  location (`parking`/`parkingIndex`) — never both — and drags, commits,
  and highlights as that container only.
- `PaletteItem` binds the resolved control component with its context.
- `Parking` owns the independent `parking` stack, always rendered (bordered
  empty strip with a hint when empty), with a delete button per row while
  editing (`removeParkedToolbar`) plus dwell-drop stack gaps mirroring a
  border's stack gaps (flanking gaps on row hover via `parkingFlanks`, single gap on direct
  hover, whole-row neighbour suppression via `draggingWholeParkingRow`, `commitDraggedToParkingRow`
  on `configuration.stackDzHoverMs`); drops also land via the toolbar
  item-space DZs (`commitDraggedToParking`), never by hovering a gap alone.

## Drawer toolbar drag (live vanilla)

Drawer content is one child `Track` per drawer item (several toolbars along
the child axis, perpendicular to the parent). Drawer toolbars are full drag
participants in edit mode:

- **Locations**: `DrawerToolbarLocation` (`container: 'drawer'`, root
  border/parking location + drawer-item `path` + `slotIndex`) resolves by
  `===` identity (`toolbarLocationOf` / `drawerLocationOf`); `DragOrigin`
  has a matching `kind: 'drawer'` variant carrying the child track + path.
- **Hover-open**: while editing + dragging, hovering a drawer trigger or its
  popup opens it (any `config.open` mode; `head.ts` `renderDrawer` threads
  `isEditing`/`isDragging` from the adapter). Outside a drag,
  `config.open` (`hover`/`toggle`) behaves as before.
- **Hierarchy close**: in edit mode drawers never close on mouseleave —
  every drag hover (`renderToolbarElement` bar moves + `renderDrawerTrack`
  moves) calls `closeDrawersOutside(target)`, which closes only popups whose
  wrapper does NOT contain the hovered element. Ancestors stay open,
  siblings close. Run mode keeps click/Escape/outside-click close.
- **Gap highlight**: drawer item-spaces route through the same `item-gap`
  session path as borders (`renderDrawerTrack` `pointermove` →
  `session.over({ kind: 'item-gap', ... })`); the session resolves the
  drawer container itself (`locateContainerOf` drawer scan) and commits via
  `commitDraggedToDrawer` (engine `drawer-gap` element). No track/stack gaps
  inside drawers — plain stacked toolbars only.
- **Persistent empty toolbar**: `pruneEmptyToolbar` + `pruneDragOrigin` never
  prune drawer toolbars — dragging the last tool out leaves a zero-item bar
  whose single DZ renders large (square, toolbar-scale, dashed when idle;
  `palette.css` drawer empty rules). Border/parking prune is unchanged.
- **Cross-container**: border ↔ drawer ↔ parking ↔ catalog all merge through
  the item-space path; the session origin follows into the drawer
  (`kind: 'drawer'`). Whole-toolbar drawer slides relocate the bar object
  within its child track (no prune victims).
- **Adapter sync**: drawer-side `structure` events re-render open popups in
  place (`syncOpenDrawerTracks` — inner track rebuild, popup stays open);
  border-side moves still take the surgical `syncTrack`/`syncBorder` path.

Helpers: `actualTrackSpaceAt`, `insertToolbar` (split a gap), `removeToolbar`
(merge surrounding gaps), `removeParkedToolbar` (parking rows, no spacing),
`draggingWholeParkingRow` (parking analogue of `draggingEmptiesTrackIndex`,
whole-row scope),
`insertTrackWithToolbar`, `removeEmptyTrack`,
`resizeToolbar`,
`resolveItemPlacementTarget` (linear cross-region placement). Instance
identity: `canonicalItemTool` / `itemFingerprint` /
`findOwnershipViolations` (same object in two containers is a bug).

## Svelte actions

| Action                | Element              | Behaviour                                              |
| --------------------- | -------------------- | ------------------------------------------------------ |
| `paletteRoot`         | IDE root             | tabindex, editing/dragging classes + data flags, keydown tool resolution, clears `inspecting` when edit ends |
| `paletteToolbarDrag`  | toolbar (border)     | edit-mode `pointerdown` starts a toolbar drag (`mode: 'slide'`, origin `kind: 'border'`) |
| `paletteParkingToolbarDrag` | toolbar (parking) | edit-mode `pointerdown` starts a whole-row drag (origin `kind: 'parking'`, no slide-follow) |
| `paletteItemDrag`     | item guard (border, edit) | `pointerdown` inspects the item, then starts a tool-set drag (`kind: 'border'`) |
| `paletteParkingItemDrag` | item guard (parking, edit) | `pointerdown` inspects the item, then starts a tool-set drag (`kind: 'parking'`) |
| `paletteItemShield`   | item content         | blocks interaction while editing                       |

Actions return `{ destroy() }` (Svelte action contract). `paletteRoot` runs
`$effect`s inside the action body — legal because actions execute in component
init context.

Gaps are hit-tested by the components' own `pointermove` handlers, not by
actions: `ToolbarTrack` reads `[data-track-space-index]` and `Toolbar` reads
`[data-item-space-index]` / `[data-item-index]`. The former
`paletteToolbarSpace` / `paletteTrackSpace` / `paletteStackSpace` stubs
registered nothing and were removed.

## Pointer drag sessions

`startPaletteDragSession({ event, onMove, onStop })`: listens on `window`
(`pointermove`/`pointerup`/`pointercancel`, `blur`, `visibilitychange`),
ignores foreign `pointerId`s, stops when `buttons === 0`. There is no pointer
capture (it would freeze the drop zones on the drag origin) and no activation
threshold (a drag is live from `pointerdown`; commits happen on hover, not on
release). See `docs/movements.md` for the session model, the `phase` field,
and the commit rules.

`$state` proxy hazards (found via e2e — see `docs/architecture.md` §20):

- Previewing on the still-plain session object then assigning
  `palettes.dragging = dragging` breaks shared border/track references — defer
  preview to activation and re-link through the store's own proxies
  (`active.track = active.border[0]`, …) before running `onActivate`.
- Catalogue `onDrop` inserts unconditionally when no preview committed — the old
  seed-border `===` guard fails under `$state` proxies and silently drops inserts.
- A toolbar inserted into a reactive track is a *proxy* of the array that was
  passed in. Reusing the raw local reference makes later identity lookups
  (`findIndex`, `includes`) miss — read the placed toolbar back out of the
  track instead.

## Catalogue (HTML5) drag

`beginPaletteCatalogInsertDrag(palette, item, pointer?)` starts a session on the
same `PaletteDragging` path from `dragstart` (payload resolved via
`paletteToolbarItemFromCatalogPayload`). `notifyPaletteCatalogNativeDragStarted`
marks `palettes.catalogDrag` so drop zones stay hittable; cleared on window
`dragend` (capture). MIME: `PALETTE_CATALOG_DRAG_MIME`
(`application/x-sursaut-palette-catalog`), serialized with
`serializePaletteCatalogDragPayload` / `parsePaletteCatalogDragPayload`.

## Edit mode and inspector

One palette editable at a time (`palettes.editing`). `paletteRoot` toggles
`editing`/`palette-editing` classes + `data-editing`; global CSS renders the
hover/active chrome (see `docs/theming.md`). `paletteItemDrag` sets
`palettes.inspecting = { item, palette, region }` on `pointerdown`; the console
renders the presentation-only inspector (`renderConfigurator` +
`resolveConfiguratorContext` output) in its *Details* panel, and the inspected
item is highlighted (`data-inspected`) on the toolbar. Structural edits
(move/remove) are out of scope — drag reorder is the structural mechanism.
