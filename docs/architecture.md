# Architecture — palettable

Start with `README.md`, then `docs/getting-started.md`. Topic guides:
`core-concepts.md` (points, tools, registry, scope), `layout-and-drag.md`,
`command-box.md`, `theming.md`, `testing.md`, `using-the-default-head.md`,
`creating-a-head.md`. This file keeps the decisions, runtime mapping, and
phase history.

## 1. Identity

- **@palettable/core** = the headless layer: points, values store, layout tree,
  movement commits, command-box builders, console state, presenters, SSR render
  model, context bags, global CSS.
- **Adapters** render the core: `@palettable/vanilla` (plain DOM, the reference
  adapter + demo), `@palettable/vue` and `@palettable/svelte` (created in
  `plans/extraction.md` Phases 11–12). Each imports `core` only — never the
  reverse, never each other.
- **Headless** contract: the palette owns state, a11y semantics, tool
  resolution, editing, and drag/drop — **not** styling. Adapters own markup and
  CSS.
- The original reference UI (a Sursaut-based implementation) has been retired;
  it is no longer available to consult. What was extracted from it is recorded
  below — treat **this document + `packages/core`** as the spec.
- Read-only reference source lives in `ui/` (symlink) where the original
  upstream is still present. Never edit it.
- **Out of scope:** the rest of the original reference UI — the `*Model` functions
  (button/checkbox/select/…), directives, and the `uiComponent` variant factory
  (styled variants + dot-syntax accessors). The palette has no model layer and
  no variant layer.

## 2. Toolchain

| Tool | Version |
|------|---------|
| Node | 24.x |
| pnpm | 11.x |
| Vite | `^8.2.2` |
| TypeScript | `^6.0.3` |
| Biome | `^2.5.12` |
| Vitest | `^5.0.0` (node for `core`, jsdom for adapters) |
| Playwright | `^1.62.1` |

Adapters add their own framework deps (`vue`, `svelte` + its vite plugin) —
they are not root dependencies, since only the adapter being built needs them.

## 3. Runtime mapping (original reference → core)

The table below is the mapping the extraction applied. It is kept because it
explains *why* the core API has its shape: every reactive/component-only
construct had to become plain data + pure functions, with the reactivity pushed
into adapters.

| Original reference | Core / adapter split |
|--------------------|----------------------|
| `mutts.reactive(x)` | core: plain values + `PaletteStateStore`; adapter: `$state(x)`, `ref()`, … |
| `mutts.effect(fn)` | adapter-owned (`$effect(fn)`, `watch(...)`) |
| `mutts.unwrap(x)` | direct reads (core never proxies) |
| `mutts.lift(fn)` | core: pure derived builders; adapter: `$derived` / `computed` |
| `JSX.Element` | core: `IconToken = string`; adapter: its own renderer |
| `options.iconFactory` | adapter-side icon resolution (`resolveIcon`) |
| directive (`use:`) | adapter-owned (`$effect` in an action, `onMounted`, …) |
| portal latch | adapter-owned DOM portal (drawer popups into `document.body`) |
| ambient env / scope | explicit parameters (`scope`, `surface`, `HeadContext`) |
| `componentStyle.css` | global `styles/palette.css` (no scoping, no injection) |
| global options object | explicit options records per entry point |

## 4. Module layout

- Core is **plain TypeScript** with no reactive primitives and no DOM
  (compiler-enforced, see §21). One module = one concern — the module
  inventory is in §21.
- Adapters mirror the same concern split in their own idiom: keys /
  layout rendering / drag session / head renderers / strings.
- Every adapter keeps the same public shape: a barrel, an IDE entry point that
  takes a container element, and a set of `render*` functions per control id.

## 5. Controls are components — no model / variant layer

The palette does **not** use the retired reference UI's `*Model` lazy-getter pattern
(`buttonModel`, `checkboxModel`, …). That pattern belongs to the general UI
library, which is out of scope.

- A **control** is rendered by the adapter from a presenter view-model: core
  resolves a control id to pure render data, the adapter maps that id to its own
  rendering primitive (a plain-DOM `render*` function, a component, …).
- No grouped-attribute objects to spread (`model.button`, `model.input`), no
  self-referential getters.
- No `uiComponent` variant factory and no styled variants. The palette is
  headless; any visual styling belongs to the adapter/head, never the core.
- A registry entry holds a control id plus a configurator id — never a
  component. Adapters resolve ids to their own renderers.

## 6. Shared runtime state (adapter-owned)

Exactly one palette is *editable* at a time, and exactly one drag is live.

- Core owns the semantics: which palette is being edited, which session is
  running, which item is being inspected — as plain state + subscribe channels.
- Each adapter mirrors that state in its own reactivity so its own render pass
  can react to it (the reference adapter re-renders structurally on an editing
  flip and reads live session state).
- The drawer collapse signal is a version counter: consumers bump it to close
  all open drawers synchronously.

## 7. Control registry

- Registries are keyed **family → control** (`run`, `boolean`, `number`, `enum`,
  `nothing`).
- Resolution is `resolveControl()`: explicit item `control` → family default →
  first eligible → compact fallback for an ineligible explicit → `undefined`
  (§21, Phase 5 status).
- A control id is an opaque string to core; the presenter turns
  (definition, value, config, surface) into render data and the adapter decides
  what to draw.
- The render context carries `point`, `value`, `control`, `scope`, `flags`, and
  `surface` (axis + region).
- `surface.axis` derives from region: `top`/`bottom` → `horizontal`,
  `left`/`right` → `vertical`.

## 8. Icons

The reference UI was **not** hardcoded to a glyph library: the palette only carries an icon
value and never renders it itself. Rendering is delegated to a pluggable `options.iconFactory`;
the `pure-glyf` package (a separate optional Vite-plugin + adapter, `registerGlyfIconFactory()`)
is merely *one* such factory.

The extraction keeps that split:

- **Palette core stays icon-agnostic.** `IconToken = string` flows through
  points / entries / toolbar items to the control. Core never imports an icon
  factory and never renders anything.
- **String-name resolution is an adapter concern.** `packages/vanilla/src/head.ts`
  exposes `resolveIcon(...)`; an adapter may also accept richer icon values
  (components, nodes) in its own types — core only ever sees the token.

We do **not** port `pure-glyf`; a demo can use emoji strings or register a
factory that maps names to CSS classes.

## 9. Portal pattern (drawer)

A drawer renders a popup perpendicular to its parent axis, portaled into
`document.body` (the adapter owns the portal). The popup re-inherits the
context it needs — root location + region — so nested toolbars resolve their
points and nested drawers invert their child axis correctly. `core` supplies the
geometry decisions (`drawerChildAxis` / `drawerChildRegion`, §21 Phase 5) and the
placements; the adapter only moves nodes.

## 10. Serialization

- `snapshotLayout` / `validateSerializedLayout` / `fromSerializedLayout` are pure
  (`core/src/layout.ts`).
- A **serialized** region carries a *nested* track list (`version: 1` is the
  discriminator); hydrate rebuilds the live form where each serialized slot
  becomes its own single-slot track. Never share one normalizer between the two
  forms — that double-wraps and `getLayout()` throws.
- Adapters own the reactive rebuild: they read the plain hydrated structure and
  wrap it in their own reactivity at the call site, during init (never from a
  late handler).

## 11. Styling — global CSS, never scoped or injected

- CSS is **always global** unless true component scoping is required. Palette
  styles live in `packages/core/styles/`:
  - `palette.css` — layout + edit chrome + drawer shell (core-owned selectors).
  - `head-default.css` — the default visual theme (dark base + light override),
    plus `head-dark.css` / `head-light.css` token sheets.
  All are imported once by the host app (the reference demo imports all four in
  `packages/vanilla/demo/main.ts`) — never injected at runtime, never duplicated
  per instance.
- Selectors stay specific through class hierarchy (`.palette-ide.editing .toolbar:hover::before`),
  never bare names (`.active {`). No `data-palette-id` scoping: only one palette is editable at
  a time, so per-instance `<style>` elements are pure overhead.
- No runtime style injection exists anywhere: the CSS is plain files the app
  imports once.
- Edit-mode hover states are live, not just unblocked: entering edit mode toggles
  `editing`/`palette-editing` classes + `data-editing` on the IDE root, and the
  ported `.palette-ide.editing .toolbar…` / `.toolbar-item-guard…` rules render the
  hover/active chrome.
- Drawer popup classes use the `palettable-` prefix (`.palettable-drawer__popup`).

## 12. Palette runtime (Phase 3 — implemented, review fixes applied)

The permanent surface is documented in §21 ("Phase 3 status" and the module
inventory). What matters architecturally:

- `PaletteCore` owns the registry, the values store, the layout tree, virtual
  resolution and command execution. It deliberately **does not** re-implement
  get/set/subscribe — the store is exposed as `core.values`.
- `run()` is synchronous; `PaletteError`s are thrown, not rejected. An action
  point's `run()` may return a promise — core does not await it.
- Palette identity is plain `===` (no proxying anywhere in core), so
  "which palette is editing" is an identity comparison.
- `resolveEditablePoint` rejects unknown ids, action points and family
  mismatches; `readSetterValue` is the single coercion path.
- Adapters must build their reactive mirror during init, never from a late
  handler or after `await` — the same constraint applies to command-box models
  and layout hydration.

## 13. Command box (Phase 4 — implemented)

- Builders live in `packages/core/src/command-box.ts`, pure over descriptors +
  a plain-data context; entries carry `run` **spec strings** adapters execute
  via `PaletteCore.run`, never closures.
- The query model is plain functions (`(entries, query) => results`), so an
  adapter can wrap them in its own reactivity or call them imperatively.
- `commandRunner` throws `PaletteError` (not plain `Error`) for non-runnable
  specs, matching the palette error taxonomy.
- The console state machine lives in `packages/core/src/console.ts`
  (`ConsoleStore` + `consolePointDescriptor`); the modal markup is adapter-side.

## 15. Layout rendering (Phase 5 — implemented)

Core owns the **decisions and commits**; adapters own the **geometry and DOM**:

- Core (`packages/core/src/layout.ts`): track spacing math, toolbar moves,
  the veto predicates, the gap-highlight decisions, and the structural commits
  (`commitDraggedToTrackSpace` / `ItemSpace` / `StackSpace` / `Parking…`,
  `insertTrackWithToolbar`, `moveToolbarToTrack` / `Stack`). All take an
  explicit drag-state parameter — no module-level reactive reads.
- The drag **session** (`packages/core/src/drag.ts`): `Hoverable` in,
  `DragEvent` out (`highlight` diffs + `slide` / `clearSlide` / `resize` +
  `structure` ops), owning the paint baseline, the dwell timer, the slide frame
  and the catalog creation.
- Adapters own hit-testing inputs (pointer coordinates, rects), the pointer
  session wiring (`startDragSession`), rAF slide transforms (`slide.ts`), the
  node registry, and re-rendering on `structure` events.
- Adapters re-render surgically per op (`diffBorder` / `diffTrack` /
  `applyOp`) rather than rebuilding the tree; a full-branch `replace` op is the
  whole-load escape hatch.
- Adapters must build their reactive mirror during init, never from a late
  handler.
- Actions/effect-style entry points return the adapter's own cleanup contract.

## 16. Head controls & configurators

- The shipped head renders one control per point family, bound to core
  presenters: `renderButton` / `renderToggle` / `renderSelect` /
  `renderSegmented` / `renderSlider` / `renderStepper` / `renderStars` /
  `renderStatus` / `renderCommandBox` / `renderDrawer` /
  `renderTheme` in `packages/vanilla/src/head.ts`.
- A demo can **replace** a control (same control id, richer rendering) and
  **extend** the head with a new control id — the reference demo does both for
  the `number` family.
- Configurators read the control choices injected into their scope by core
  (`controlChoicesFor`), so the panel offers exactly the controls that are
  eligible for the item's family.
- Unknown tools render nothing (defensive): a broken item stays inert in edit
  mode instead of crashing the toolbar.

## 17. Drawer (Phase 7 — implemented)

- Core owns the geometry and cabinet rules: child axis inverts the parent axis
  (`drawerChildAxis` / `drawerChildRegion`), `open` (`hover` | `toggle`) and
  `placement` come from the item `config`, and a **close-on-click** chain closes
  the clicked tool's drawer plus its `hover` ancestors
  (`drawerCloseChainIndices`).
- The adapter owns the portal: the popup mounts into `document.body`, re-inherits
  the root location + region so nested toolbars resolve their points and nested
  drawers invert correctly, and `Escape` closes it.
- A collapse signal (a version counter) closes all open drawers synchronously.
- A drawer's content is **one child `Track`** — several toolbars along the
  perpendicular axis with track spaces between them — so drawer toolbars are
  full drag participants; see `docs/layout-and-drag.md`.

## 18. Demo page (Stellar Outpost — current)

The demo lives in `packages/vanilla/demo/` (setup demo):
`palette.ts` (points, keys, three configurations + live layouts, ship roster),
`main.ts` (page, `PaletteCore` + `createIDE`, persistence), `i18n.ts` (FR
bundle), `icons.ts`.

- `palette.ts` defines the **Stellar Outpost** space-colony sim: colony values
  (`autoOxygen`, `shieldGenerator`, `fastMode`, `colonyTheme`, `alertLevel`,
  `powerPriority`, `gameSpeed`, `taxRate`, `solarEfficiency`, `satisfaction`) +
  the mission clock + system `theme`/`locale` + `lastAction`, with run tools
  (`emergencyProtocol` — disabled at green, `saveGame`, `resetSimulation`,
  `console`). Keys: `` ` `` console, `N`/`S`/`E`, `Ctrl+S`, `+`/`-`, `1/2/3`.
- The initial layout avoids duplicate point/control pairs across borders and adds
  a nested drawer on the left and the **fleet** tools on the bottom border (bound
  to the host-owned `ship` bag).
- The work-zone shows every colony variable as pills + a status panel + an
  `mm:ss` chip; the open console dims it (quake-style modal), and in edit mode
  toolbar item content is `inert`.
- `main.ts` persists the layout through `localStorage` (validated with
  `validateSerializedLayout`) and binds a value proxy so the page follows live
  values.
- While `palette.editing`, `paletteRoot` suppresses tool key bindings (early
  `if (palette.editing) return`) so keys are free to be re-bound (press-to-rebind), mirroring
  the pointer side where `paletteItemShield` sets `element.inert` on item content.
- Add-to-toolbar flow: selected add entry expands via `paletteDerivedVariants` into variant
  cards (boolean/number/enum value inputs, enum allowed-values/keyword filters mirroring the
  reference `popupAddItem`). The add-box results (`console-results`, seeded from
  `paletteAddItemEntries`) render draggable rows — the single drag surface. Native HTML5 drags
  (`PALETTE_CATALOG_DRAG_MIME` + `serializePaletteCatalogDragPayload` on `dataTransfer`,
  `beginPaletteCatalogInsertDrag` + `notifyPaletteCatalogNativeDragStarted` on `dragstart`);
  drops land in the existing `bindPaletteCatalogDrop` toolbar/track/stack zones.catalog
- `Parking` renders the independent `parking` stack at the top of the console minus the
  command-box item (mirrors the reference `popupParkingToolbars`); parked toolbars are
  removed via `removeParkedToolbar`, and border/parking exchange tools through
  ownership-transfer commits (`commitDraggedToParking` + parking stack gaps).
  Drag origins carry `kind: 'border' | 'parking'` so a top-bar drag can never
  light up a parking row as dragged (position is part of instance identity;
  the session exposes the live origin toolbar, never a container scan).
- Persistence (reference demo): `main.ts` seeds a clone of the chosen layout at
  init (first render identical everywhere, no hydration mismatch; also avoids
  mutating the shared module objects), then splices a validated stored snapshot
  into the live structure once mounted — each stored flat slot is re-nested as
  its own single-slot track, the shape hydration produces. Parking rows splice
  into their own stack. `snapshotLayout`/`fromSerializedLayout` round-trip
  parking alongside borders. The demo ships three **configurations**
  (`demoConfigs` in `packages/vanilla/demo/palette.ts`): `rw-combobox`,
  `rw-command-first`, `ro-combobox` — each loaded by a plain preset command
  button (no toggle state); `demoLayoutFor(id)` flips the reactive
  `demoEditable` flag. A "Save layout" / "Load layout" button group round-trips
  through localStorage.
- **Edit-mode inert:** item content becomes `inert` (unfocusable, unclickable)
  while editing, leaving only the drag guard to own pointer events
  (select-for-edition / move).
- Inspector structural actions: resolving the item's live configuration
  (by item identity across all four borders) drives move-backward/move-forward
  (splice within the toolbar) + remove buttons and the `bindings.shortcut` display
  (`findByTool`).
- Init-time constraint respected: all `paletteCommandBoxModel` instances are created during
  component init; stored-layout restore splices plain data in `onMount`, never in handlers.
- Gates: `check` 0/0, `lint` clean, `test` 117 pass, `build` ok.

## 19. E2E coverage (Phase 10 — conformance suite)

One Playwright project per adapter demo, each on its own port; all run the same
`tests/e2e/*.spec.ts` — that shared suite **is** the adapter conformance
contract. The reference demo is at `:4174`, with a `vanilla-smoke` project for
the vanilla-only spec.

- `e2e/palette.spec.ts` (7): command-box combobox runs commands inline +
  `.palette-ide.editing` chrome, drawer open with axis inversion (left drawer →
  `is-horizontal` popup) + Escape close, presentation-only inspector via
  `pointerdown` on the edit-mode `.toolbar-item-guard` (highlighted item +
  configurator in the console details panel), layout save → reload → "restored"
  badge → preset switch → load.
- `e2e/console.spec.ts` (9): backtick opens the edit-only console (Ide root
  focused first — the IDE listens on the root `keydown`, so a bare
  body-level press never reaches it), Terminal button open + Escape close
  (+ work-zone `is-dimmed` while open), **command-first mode** (no combobox →
  console command-first + square edit button toggles to edit), **read-only mode**
  (no edit button, stays command-first), **edit-inert** (toolbar item content is
  `inert` while editing), no mode button when a `commandBox` tool is displayed,
  add flow (Life Support entry → variant card → value select in the single
  details panel), add-box rows are click-to-select (not draggable — catalogue
  drag was stripped for the movement restart, locked by `console.spec.ts`).
- `e2e/drag-invariants.spec.ts` (1): movement stripped — locks the static
  edit-mode layout (5 top tools, no empty toolbars/tracks).
- `e2e/drag-highlight.spec.ts` (1): dragging a tool highlights a free
  item-space DZ (left border — the centered console panel covers the top
  toolbar's right-hand tools; hovers a tool, never a zero-size gap; steps
  the pointer; JS-clicks the Terminal button since edit guards cover it).
- `e2e/smoke.spec.ts` (1) + `e2e/vanilla.spec.ts` (vanilla-only smoke):
  heading + IDE chrome + combobox + work-zone on first paint.
- Conformance: the suite has since grown well past the Phase 10 gate (adaptive
  axis specs, dwell, parking, drawer drag, whole-toolbar slide, ship context) —
  see `docs/testing.md` for the current inventory.
- E2E lessons: the item drag inspects on `pointerdown`, so tests dispatch
  `pointerdown`/`pointerup` on the guard instead of `click({ force: true })`; keyboard
  shortcut tests must focus `.palette-ide` (tabindex=0) before pressing. Trusted
  Playwright `mouse`/`pointerdown` events carry `isPrimary: false` / `buttons: 0` on
  the first move, which the drag session ignores — drag tests use synthetic
  `PointerEvent`s with an explicit `pointerId`/`isPrimary`. Gaps are zero-width until
  proximity chrome expands them, so drop points target the gap edge (`rect.left`),
  never a `+2px` nudge (which lands outside and resolves to a track/stack move).
  `new DragEvent(..., { dataTransfer })` rejects non-native transfers — catalogue
  tests fire plain `Event`s with a shadowed `dataTransfer` stub instead.
- Drag-engine fixes found via e2e (see §20): deferred item preview to activation +
  proxy re-link + unconditional catalogue seed insert.
- Flake note: toolbar command-box e2e failed once under 11-worker `fullyParallel`
  (result `toBeVisible` timeout; green in 2 full + 3 isolated reruns) — mitigated by
  waiting for `.palette-default-command-popover` before asserting the result (the
  140ms `inline-size` transition delays popover visibility vs. actionability).
- Gates: `check` 0/0, `lint` clean, `test` 113 pass, `test:e2e` 12 pass, `build` ok.

## 20. Drag-engine proxy hazards (found via e2e — reactive-adapter lesson)

Recorded because every reactive adapter will hit the same class of bug: if the
adapter **proxies** live layout objects, identity comparisons inside a drag
session silently break. Core compares objects by `===`, so a proxied border is
never the plain border.

- `createItemDragging` detaches the item on `pointerdown` but defers the re-insertion
  preview to drag activation: previewing on the still-plain session object stores the
  live source toolbar in the preview, and the subsequent proxying of the session
  breaks the shared ephemeral border/track references — the next move's preview
  no-ops (`border.indexOf(track)` misses) while the removal stands, so the item
  vanishes. A plain click (no activation) restores the item at its origin.
- Activation must re-link the ephemeral shell through the store's own proxies
  (`active.track = active.border[0]`, `active.toolbar = track[0].toolbar`) before
  running the activation callback: without this, `indexOf` still misses even for
  the deferred preview (proxied border vs. plain track).
- The catalogue drop inserts the session item unconditionally when no preview was
  committed: the old seed-border `===` guard fails under proxies even when the
  session never moved, silently dropping the insert. Double-insert is impossible
  (a spent session makes a second drop fall through to the MIME path).

**Lesson for new adapters:** keep core-owned layout objects unproxied, or route
all identity checks through core helpers rather than through proxied references.

## 14. Tooling conventions

- Lint/format: `pnpm lint` / `pnpm lint:fix` (Biome — tabs, single quotes,
  `asNeeded` semicolons, width 100).
- Type-check: `pnpm check` (per-package `tsc --noEmit`, via `pnpm --recursive`).
- Unit: `pnpm test` (Vitest — `core` runs in `node`, adapters in `jsdom`).
- E2E: `pnpm test:e2e` (Playwright dev server on `:4174`).
- Scratch files go in `sandbox/` (git-ignored), never `/tmp`.

### Gotchas (recorded)

- Biome 2.x has no `files.ignores`; exclusions are `!`-prefixed entries in `files.includes`.
- A `vite` dev server started **before** a `core` change serves stale code and
  produces phantom e2e failures — restart it before measuring.

## 21. `@palettable/core` — headless package

`packages/core` is the framework-agnostic headless layer. Every adapter
(`packages/vanilla` today; `packages/vue` and `packages/svelte` in
`plans/extraction.md` Phases 11–12) imports core, never the reverse and never
each other. Core stays DOM-free and demo-free.

### DOM-free rule — **decided: strictly DOM-free, compiler-enforced**

Core is **vanilla TS with zero DOM and zero framework**. This is not a convention
but a build guarantee:

- `packages/core/tsconfig.json` sets `lib: ["ES2022"]` — **no `DOM`**. Any
  accidental `document`, `HTMLElement`, `KeyboardEvent` or `window` reference
  fails `tsc` (`error TS2584: Cannot find name 'document'`).
- `packages/core/src/globals.ts` is the single escape hatch: it resolves
  host globals through `globalThis` — `queueMicrotask` (used to re-throw
  listener errors off the notify stack) plus `setTimeout` / `clearTimeout`
  (used by the `GapDwell` hover-dwell timer). Timers exist in every target
  host (browsers, Node, workers) but are not part of the ES2022 lib, so they
  are resolved here rather than pulling in `DOM` or `@types/node`. All are
  resolved **per call**, not captured at module load, so tests can stub the
  host globals. Timer handles stay opaque (`unknown`) — pass them back to
  `clearHostTimeout`.
- Consequence for Phase 2: `drag-session.ts` (`HTMLElement`, pointer events) does
  **not** move into core. Drag sessions live in the adapters (`packages/vanilla`,
  `packages/vanilla`); core exposes only structural commits
  (`PaletteLayoutTree.moveItem` / `moveToolbar` / `insertItem` / `removeItem`).

### Core contracts

- **Icons are opaque tokens** (`IconToken = string`). Resolution to a component or
  glyph is an adapter concern; core never imports an icon factory.
- **Keystrokes are normalized strings** (`"Ctrl+Shift+S"`). Core owns only the
  headless lookup (`findKeystrokesFor`, `findKeystrokesForTarget`); adapters
  own `KeyboardEvent` → keystroke normalization (`normalizePaletteKeystroke`,
  `paletteKeystrokeFromEvent`). `KeyBindings` values are strings (references
  by name); inline virtual definitions live on toolbar items, never in this
  map — a key bound to an inline enum-from uses the virtual's `id`.
- **Virtual points** (`virtual.ts`) are end-user-defined derived points over a
  source point: `enum-from` (present any value as an enum / enum subset).
  Matching uses `Object.is`, the same contract as `PaletteStateStore.set`.
  A spec may also carry a virtual **inline** (`PointTarget = string |
  VirtualPoint` in `specs.ts`): the definition object lives directly in
  `ToolToolbarItem` / `SerializedToolbarItem` `tool`, behaves like the same
  definition registered under its `id` (validated via `assertValidVirtual`,
  resolved via `PaletteCore.resolveTargetVirtual`), but its lifetime is the
  spec — no registry entry, no id-collision check.
- **Layout is pure data.** `PaletteLayoutTree` holds borders / tracks / toolbars /
  items and emits a fresh `SerializedLayout` snapshot per mutation via
  `subscribe`. Two structurally different forms exist and must not be conflated:
  a **serialized** region is a *nested* track list (track boundaries are
  persisted), a **live** region is a list of *tracks*. `version: 1` is the
  marker; a live layout carries no
  `version` marker, so the marker discriminates serialized from live. Cloning
  preserves track boundaries. Preset/demo layouts are live `Borders` — pass
  them directly, never via `.flat()`/serialized (that drops boundaries).
- **Teardown**: `PaletteCore.dispose()` drops value **and** layout listeners
  (`PaletteStateStore.clearListeners` + `PaletteLayoutTree.clearListeners`).
  Values and layout are kept.
- **Build**: `tsconfig.build.json` excludes `src/**/*.test.ts`, so tests never
  land in `dist`.

### Layout mutation, identity and the op stream

`PaletteLayoutTree` is the single writer for structural change; adapters never
clone-mutate a layout. Four contracts hold it together:

- **Identity contract.** `getLayout()` returns the **live** layout object by
  reference (adapters key DOM nodes and drag sessions by `===`, which must
  survive across calls). The result is read-only in spirit: commit through the
  structural methods, never by mutating it. `getSnapshot()` is the save path
  (already flat + JSON-safe — the `JSON.stringify` moment). `setLayout()` is
  reserved for *whole-layout* loads (storage hydration, demo presets) and is
  the only path that invalidates every node identity.
- **Structural methods.** `moveItem(location?, location?, item?)` and
  `moveToolbar(location?, location?, toolbar?)` implement the **`from?`/`to?`
  convention**: no `from` = creation, no `to` = deletion, both = a move where
  `to` is interpreted *post-deletion* (so same-container forward indices adjust
  for the removal). `insertItem` / `removeItem` are the discrete-edit
  equivalents. All of them `splice` the **same** objects — a toolbar or item
  relocated keeps its identity, so an adapter's node map stays valid.
- **Op stream.** `subscribeOps` (via `PaletteCore.subscribeLayoutOps`) emits one
  `LayoutOp` per mutation — `move-item` / `move-toolbar` / `insert-item` /
  `remove-item` / `replace` — carrying the live object references, the
  `from`/`to` locations, and the **prune cascade** (`pruned: LayoutPruneVictim[]`:
  `toolbar` / `track` / `row` entries with the container they were removed
  from). This is what lets an adapter re-render only the affected region: a
  `move-toolbar` deletion reports both the vacated slot *and* the emptied track;
  `replace` is the whole-load escape hatch. The per-mutation snapshot
  (`subscribe`) is still emitted — it is the persistence signal, while the op
  stream is the reconciliation signal.
- **No batching API.** There is deliberately no `begin/end`, `silent` or
  `flushLayout`. Mid-drag commits emit like any other mutation; the *adapter*
  owns the dirty flag and makes the single "it changed, save it" call on
  drag-end. Discrete edits emit immediately.

Drag-state helpers (`DraggingState`, the veto predicates, the commit
functions, the gap-highlight decisions) also live in `layout.ts` and take the
session as an **explicit parameter** — no module-global reads, so core stays
adapter-agnostic. See `docs/movements.md` for the engine spec.

### Module inventory (`packages/core/src/`)

One module per concern — the 980-line `palette/types.ts` was split, not copied:

| Module | Contents |
|--------|----------|
| `index.ts` | barrel — re-exports every module below |
| `identifiers.ts` | `IconToken`, `Keystroke`, `Unsubscribe`, listener types |
| `type.ts` | `EnumOption`, `DefaultTypeMap`, `TypeMap`, constraints (declaration-merging extension point) |
| `points.ts` | `PointBase`, `ActionPoint`, `ValuedPoint` (no `defaultValue` — core holds no defaults; absent key = skeleton) + per-type aliases, `NothingPoint` (`type: 'nothing'` — context + enablement only; `isNothingPoint` guard), `isActionPoint` / `isValuedPoint` (type-guarded, `false` for nothing-points), `ROOT_CONTEXT` + `isRootContext` (`''` value, `'root'` alias); `PointBase.uses` (optional bags, load-bearing in Phase 8) + functional `can(...bags)` on all kinds (omitted = enabled) |
| `specs.ts` | `PointSpec`, `PointTarget`, `isInlineSpec`, `canonicalSpecId`, `parsePointSpec`, `canonicalPointId` |
| `store.ts` | `PaletteStateStore` (single source of truth, starts empty — no hydration from definitions, no defaults; `has`/`require` strict helpers, `get` lenient skeleton probe) + `setTree` batching (all writes land before any listener runs, returns changed keys). Phase 9 removed the dead `getOr` / `update` helpers (tests-only, zero production callers). Data-owning removed `reset`/`resetAll` (consumer resets via `setMany`). |
| `layout.ts` | layout data types, `PaletteLayoutTree`, `defaultLayoutFromPoints`, `validateSerializedLayout`, `isDrawerItem`, `snapshotLayout` (exported canonical live→serialized serializer — the SSR snapshot path routes through it, no private duplicate), pure track-space math (`clampUnit`, `actualTrackSpaceAt`, `insert/remove/resizeToolbar`, `insertTrackWithToolbar`, `removeEmptyTrack`, `removeParkedToolbar`, `canonicalItemTool`, `itemFingerprint`, `findOwnershipViolations`), the **op stream** (`LayoutOp` / `LayoutPruneVictim` / `subscribeOps`), the **drag-state surface** (`DraggingState` / `DragOrigin` / `DragMode`, the veto predicates `isItemSpaceFree`, `nearestFreeItemSpaceBefore/After`, `isDraggingWholeToolbar`, `draggingEmptiesTrackIndex`, `draggingWholeParkingRow`, the commits `commitDraggedToItemSpace` / `commitDraggedToTrackSpace` / `commitDraggedToStackSpace` / `commitDraggedToParking(Row)`, `commitDraggedToDrawer`), and the pure gap-highlight decisions (`borderStackHighlight`, `itemSpaceHighlight`, `trackSpaceHighlight`, `parkingFlanks` / `stackFlanks` → `GapHighlight`); item `tool` is `PointTarget` (string ref or inline virtual), serialized `tool` is `string \| VirtualPoint`, clone/serialize deep-copy inline definitions. A **drawer's content is one `Track`** (`DrawerToolbarItem.toolbar: Track` — several toolbars in line along the perpendicular child axis, with track spaces between them), so drawer toolbars participate in `moveItem`/`moveToolbar` like any other |
| `configuration.ts` | `configuration` magic numbers + `PaletteConfiguration` (Phase 2, verbatim) |
| `drag.ts` | drag session (`GrabTarget` / `Hoverable` / `DropZone` / `PointerSample` / `SlideFrame` / `ToolbarDrag` + `createToolbarDrag`): `Hoverable` in, `DragEvent` out (`highlight` diffs + `slide` / `clearSlide` / `resize` + `structure` ops, emission order structure → highlight → slide); owns the paint baseline, the dwell timer (`configuration.stackDzHoverMs`), the slide frame + pending split, and the catalog `catalogPending` creation — delegates decisions + commits to the `layout.ts` engine via the injected `DragEngine` (no module cycle); `isWholeToolbar` / `mode` stay session-internal |
| `controls.ts` | `PointFamily`, `ControlCapability`, `ControlChoice`, `familyOfPoint`, `controlChoicesFor` |
| `keys.ts` | `KeyBindings`, `findKeystrokesFor`, `findKeystrokesForTarget` (headless lookup only) |
| `virtual.ts` | `enum-from` derived points (option key ↔ source value, `Object.is` matching) |
| `errors.ts` | `PaletteError` + `PaletteWriteError` (thrown by locked-bag `set`/`setTree`; adapters catch for UI feedback) |
| `globals.ts` | `scheduleMicrotask` + `scheduleHostTimeout` / `clearHostTimeout` + `cloneValue` — the only host globals |
| `core.ts` | `PaletteCore`, `PaletteCoreOptions` (+ `initialValues` one-shot SSR/hydration fill, Phase 3), `values` (`PaletteStateStore` — the single value surface, not re-implemented), `points` / `virtualPoints` (cached arrays, invalidated on `defineVirtual` / `removeVirtual`), `resolveTargetVirtual`, `setMany`, `resolveEditablePoint`, `readActionCan` (functional-`can` read), `canRunStep` (bounds-checked step `can`, strict on skeleton), sync `run` (strict setter/toggle/step on skeleton; number steps clamped to min/max), context registry (`setContext`/`removeContext` replace-never-append via forward map, root name throws, `getBag`/`resolveBags` accept `ROOT_CONTEXT`/`'root'` alias, `evaluateCan`, `subscribeContext`, `subscribeCan` flip-only), `dispose` (drops value + layout + context listeners). No `resetAll` (consumer `setMany` round-trip). |
| `palette.ts` | `ServerPointDescriptor` (action/valued/nothing — no `run`, no functional `can`) + `to/fromServerDescriptor` (action rebuild by name via `runners`; nothing-points round-trip), `validateInitialValues` (rejects actions + nothing-points), `readSetterValue` (headless `valueReader` port; the single setter-coercion path) (Phase 3, SSR §4.1–§4.2) |
| `command-box.ts` | `paletteCommandEntries` (toggle + step `can` bounds-aware from values context, lenient without) / `paletteAddItemEntries` / `paletteDerivedVariants` / `paletteEnumSubsetValues` + `tokenizeQuery` / `trimLastToken` / `filterCommandEntries` / `suggestCommandKeywords` / `parseCommandInput` / availability helpers (Phase 4; pure over descriptors, `run` = spec string, entries carry `uses`) |
| `console.ts` | `ConsoleStore` (open/close/toggle + add-state + listener set) + `consolePointDescriptor` run-point descriptor (Phase 4; adapters wrap it in their own reactivity) |
| `presenters.ts` | `button`/`toggle`/`select`/`slider`/`status`/`configurator` presenters (pure over definitions + values + config; skeleton-propagating: `toggle.pressed`, `select.value`, `slider.value` are `undefined` when absent — no `false`/`0`/`''` coercion), `resolveControl` (single-id fallback chain), `axisForRegion` + drawer perpendicular rule, enum-from display helper (Phase 5; `BoundDisplay.bags` load-bearing in Phase 8 — `buttonPresenter` evaluates functional `can` against bound bags) |
| `render.ts` | `resolveRenderTree` (pure definitions + virtuals + layout + values → render tree; pinned `trackGapMinGrow` floor applied to slot `space`, no `run`/`set`/timers/DOM), `snapshotPalette` (atomic layout + values + virtuals + pinned config; live layouts serialize via canonical `snapshotLayout`), `ValueCodec` registry (`register/clear/serialize/deserializeValue(s)` — custom types SSR-unsafe-by-default), `RENDER_MAX_DEPTH` (Phase 7, SSR §4.3–§4.8; import-graph rule: never imports `globals`/`umd`). Drawer children resolve to `ResolvedDrawerSlot[]` (one track, recursive, depth-bounded as `children`) |
| `context.ts` | `ValuesBag` (flat key/value storage: frozen `get`, `set`/`setTree` one-notify, global + per-key `subscribe`, `clearListeners`, `lock`/`unlock` → `PaletteWriteError`), `ContextName` (`ROOT_CONTEXT` = root), `BagListener`/`BagKeyListener` (Phase 8; same Map + `Object.is` + snapshot-iteration + async re-throw discipline as the store) |
| `context-display.ts` | pure `(boundValues, boundBags)` resolvers: `BoundValues` / `BoundBags` types (folded in from `context-display-types.ts` in Phase 9 — a type-only import tree-shakes identically in one file), `dualSourceValue` (selection-bag-wins precedence), `boundValueAt`/`boundBagAt`/`readBoundBagKey` (never throw on missing context), `missingContext` sentinel (no mirroring, no virtual chaining) |
| `styles/palette.css` | layout + edit chrome (Phase 6, extracted verbatim; global selectors unchanged) |
| `theme/head-default.css` (`head-dark.css`, `head-light.css`) | dark base + light override (Phase 6, extracted verbatim; stay in sync per `docs/theming.md`) |

### Phase 7 status (SSR render model — landed 2026-09-14)

`core/render.ts` (+ `render.test.ts`) implements the SSR render model
(§4.3–§4.8 of the retired SSR plan) on the Phases 3–5 surface:

- `resolveRenderTree()` — pure, synchronous, allocation-explicit resolver:
  definitions + virtuals + layout + values → `ResolvedPalette` (canonical
  point id, descriptor without `run`/`can` closures, value / enum-from key,
  single control id + capabilities, keystrokes,
  drawer children recursive depth-bounded by `RENDER_MAX_DEPTH = 8`).
  Guarantees: no subscriptions, no timers, no `run()`, no `set()`, no DOM;
  same input → `JSON.stringify`-identical output (golden test).
- `snapshotPalette()` — atomic layout + values + virtuals + pinned
  `configuration` (no layout/values tear; values by reference like
  `asObject()` — the adapter clones before crossing the wire).
- Configuration pinning (SSR §4.5 option 1): the resolver takes
  `configuration` as an argument, defaulting to the singleton for
  back-compat; pinned input ignores later singleton mutations (test).
- `ValueCodec` registry (SSR §4.6): built-ins use identity; custom types
  are SSR-unsafe-by-default (loud `PaletteError`, never silent mismatch).
- Hygiene (SSR §4.7–§4.8): the render path never imports `globals.ts`
  or `umd.ts` (import-graph test reads `render.ts` source);
  determinism (no `Math.random`/`Date.now`, unknown-version rejection) tested.
- Render-model tests (SSR §6, node, no jsdom): Node-only import (no
  `setTimeout`/`queueMicrotask` during build + resolve), golden snapshot,
  hydration round-trip (server → serialize → client → identical output),
  action isolation (throwing `run` never called, descriptor has no `run`),
  config-pinning, import-graph, codecs.
- Virtuals resolve against an `enum` family-point stand-in so `resolveControl` agrees server/client.

### Phase 8 status (context — landed 2026-09-14)

`core/context.ts` + `core/context-display.ts` (+ `context.test.ts`) implement
the context core (§§1–4 step 6 of the retired context plan; steps 7–8 are
adapter work, step 9 is this doc):

- `ValuesBag` — same discipline as the store, plus frozen `get`,
  `(changedKeys[])` global notify, `lock`/`unlock` (→ `PaletteWriteError`).
- `NothingPoint` (`type: 'nothing'`) + `isNothingPoint`; `isValuedPoint` /
  `isActionPoint` return `false` for it. `AnyPoint` is the three-kind union.
- Functional `can(...bags)` on **all** kinds (omitted = enabled);
  `PaletteCore.evaluateCan` + `readActionCan` (now a functional read) +
  `buttonPresenter` (evaluates against `BoundDisplay.bags` unless an explicit
  `can` override is passed). Static `can: boolean` readers switch to
  `evaluateCan` — the wire descriptors strip `can` (rebuilt client-side).
- Registry: `setContext`/`removeContext` (replace-never-append, §1.3;
  per-name forward map — only core's own forward is dropped, host direct
  subscribers survive; root name throws), `getBag`/`resolveBags` (missing →
  `undefined`; `ROOT_CONTEXT` / `'root'` alias always resolves to the `values`
  store), `subscribeContext` (`(bagName, changedKeys)`; identity change emits
  `[]`), `subscribeCan` (flips only), `subscribeDefinitions` (per-point id;
  fires on `defineEnumOptions` + `defineVirtual`/`removeVirtual` so adapters
  reconcile enum rows in place). The root bag is core-owned (`values`
  store); context bags are host-owned. `dispose()` clears context forwards +
  listeners.
- `context-display.ts` — `dualSourceValue` (selection-wins precedence),
  `boundValueAt`/`boundBagAt`/`readBoundBagKey` (never throw),
  `missingContext` sentinel. No mirroring, no virtual chaining.
- `validateInitialValues` rejects nothing-points (like actions);
  `fromServerDescriptor` round-trips nothing-points; nothing-point bindings
  serialize, values never do.
- Command-box context pass (step 8) is already shaped: entries carry `uses`,
  filter at render; nothing-point commands with `uses: []`/`undefined` are
  always present. The vanilla adapter context pass (step 7) landed with the
  Phase 10 demo work — see the Phase 10 status section below.

### Phase 9 status (optimization — landed 2026-09-14)

Internal cleanup, no API-surface changes, no new modules, no adapter edits.
Net: −2 files (`context-display-types.ts` folded,
`liveToSnapshot`/`liveItemToSerialized` deleted), −2 dead methods
(`store.getOr`/`update`), −1 dead field (`snapshotPalette.points?`), −1 dead
map (`bagForwards`):

- JSDoc: `readActionCan` docstring fixed (functional-`can` read, not a static
  flag); stale "Phase N" markers refreshed across `command-box` / `console` /
  `errors` / `palette` / `points` / `presenters` / `render` (`palette.test.ts`
  suite renamed to "uses contract + write errors").
- Dead code: `PaletteStateStore.getOr` + `update` deleted (tests-only, zero
  production callers — verified by grep across `packages/*/src`); their tests
  deleted. `snapshotPalette` `input.points?` removed (accepted, never read).
- Config wiring: `resolveRenderTree` now reads the pinned
  `trackGapMinGrow` floor (`Math.max(slot.space, gapFloor)`) instead of
  `void config` — the pinning test asserts the floor applies and ignores
  later singleton mutations. `trackGapSplit` stays adapter-side
  (`insertToolbar` param, adapter track renderers).
- Allocations: `points` / `virtualPoints` getters cache (invalidated on
  `defineVirtual` / `removeVirtual`); test updated to cached-identity +
  invalidation. Listener `[...set]` snapshot iteration kept deliberately —
  `Set` iteration during deletion skips not-yet-visited entries the adapter
  still expects to be notified, and typical adapters have ≤ 3 listeners.
- Structure: `context-display-types.ts` folded into `context-display.ts`
  (type-only import tree-shakes identically); `liveToSnapshot` /
  `liveItemToSerialized` deleted in favour of the canonical exported
  `layout.snapshotLayout` (same nested-track serialization + `cloneValue` on
  inline definitions); `bagForwards` map dropped — `setContext` /
  `removeContext` / `dispose` rely on `clearListeners()` (the forward was
  stored but never invoked as a subscription).

### Phase 10 status (reference demo + first conformance gate — landed 2026-09-14)

First conformance gate: the reference demo renders the Stellar Outpost demo and
satisfies `tests/e2e/` — the suite every adapter must pass. One Playwright
project per adapter demo, each on its own port (the reference demo is at
`:4174`, plus a `vanilla-smoke` project for the vanilla-only spec). Net: +4
files (`vanilla/src/keys.ts`, `head.ts`, `ide.ts`, `demo/palette.ts`), demo
page (`demo/main.ts`), 2 stale drag specs retired, 33 e2e green:

- `vanilla/src/keys.ts` — adapter-side `KeyboardEvent` ownership (the Phase 2
  split): `normalizeKeystroke` (Ctrl/Alt/Shift/Meta order + aliases;
  Plus-key aware — lone `'+'` / trailing `'+'` (`'Shift++'`) name the Plus
  key, not a separator, and `'Shift+='` folds to `'+'`), `keystrokeFromEvent`
  (Shift consumed producing a symbol: `Shift+=` / numpad `+` both resolve to
  `'+'`; Shift-letter stays distinct), `createVanillaKeys` (normalized map +
  `findByTool` + `resolve`), `isEditableTarget`. Covered in `keys.test.ts`
  (5 tests).
- `vanilla/src/head.ts` — the plain-DOM head: `renderButton/Toggle/Select/
  Segmented/Slider(showValue badge)/Stepper/Stars(radiogroup)/Status/
  CommandBox/Drawer/Theme` + `renderHeadItem` dispatch + `surfaceForRegion`.
  Drawer: icon-only trigger (label never rendered as text — accessible name +
  tooltip only), chevron ▸/▾, child axis perpendicular, popup `is-${childAxis}`
  + `data-placement=center` + role dialog, body-portaled overlay, Escape closes
  + focus trigger. CommandBox: `command-box-combobox/input/results` testids,
  ✎ open-configurator button → console edit mode, Enter runs first filtered
  entry.
- `vanilla/src/ide.ts` — `createIDE(container, options)` per the Phase 10
  interface note: adds `palette-ide` + tabindex + `data-palette-id`, wraps
  existing children (work-zone) in `palette-ide-middle > palette-ide-center`,
  renders the 4 borders from `core.layout` (direction/inverse, stack/track
  spaces with `actualTrackSpaceAt` + `trackGapMinGrow` floor, slots,
  `toolbar-item-guard` pointerdown→inspect, `inert` content while editing),
  parking (commandBox-filtered rows + 🗑 remove), console overlay
  (`console-overlay/input/results/mode-toggle/details-panel/add-panel`
  testids, `is-dimmed` work-zone, edit-only vs command-first vs read-only,
  click-to-select add flow, presentation-only configurator + delete). Keydown:
  `isEditableTarget` guard, Escape closes, editing suppresses bindings, else
  boolean-toggle or bounds-gated `core.run(spec)` (`canRunAction` no-op at the
  bound — no `preventDefault`, so the keystroke stays free for the host;
  `run` still clamps as a backstop) — listened on the owner window (not the
  container) so shortcuts fire even when focus is outside the IDE (body, demo
  chrome); typing still wins via `isEditableTarget`, consumed events via
  `defaultPrevented`, teardown on `dispose()`. Subscribes values/layout/console.
- `vanilla/demo/palette.ts` — the demo's point definitions: the 15 colony
  points (incl. a `console` run point), `demoKeys`, the 3 configs
  (`rw-combobox` / `rw-command-first` / `ro-combobox`) + layouts, `demoState`
  + `resetColony`/`isColonyDirty`.
- `vanilla/demo/main.ts` — parity page: demo-bar (heading, 3 mode buttons,
  save/load, last-action), `PaletteCore` + `ConsoleStore` +
  `bindConsoleToggle`, `createIDE` + work-zone (hero, pills, status panel,
  hint), `core.values` → `demoState` sync + theme + mm:ss clock, `localStorage`
  persistence (`palettable-demo-layout-v1` + `validateSerializedLayout`).
- E2E: the 2 catalogue-drag specs were stale (movement stripped for restart —
  it is specced in `docs/movements.md`; rows are click-to-select, zero
  `draggable=` in `src`). Replaced with click-to-select assertions; the suite is
  green. This unlocks Phase 11, not Phase 12.
- Drag sessions landed (2026-09-15): `vanilla/src/drag-session.ts`
  (`startDragSession` — window move/up, blur/cancel/hidden cleanup, no pointer
  capture so hover targets stay live) + `slide.ts` (`toolbarSlideBounds` /
  `clampSlideDelta` / `toolbarGrabOffset` — adapter-owned, needs
  `getBoundingClientRect`; single-copy rule with the release `resizeToolbar`
  commit) + `add-item.ts` (`itemFromAddSelection` via `resolveControl`).
  `ide.ts` wires `pointerdown` → `startSession` (tool vs whole-toolbar grab),
  `pointermove` → `GapDwell` → `commitDraggedTo*` + `syncGapClasses`, rAF loop
  (`latestPointer` + `Set<callback>` drained/cleared per frame →
  `translate3d`), mid-drag `retargetSlide` re-arm, `hoveredTrackSpace` memo,
  drag-end `dragDirty` → one `onLayoutChange`. `applyOp` routes ops through
  `diffBorder`/`diffTrack` (per-node create/move/remove + flex in place) and
  repositions open drawers; `patchLive` updates tools in place (full rebuild
  only on control-type swap); add-panel insert + delete-refresh wired.
  `syncEditing` re-renders structurally on an editing flip (drag listeners
  bind at render time — the chrome-only `applyEditing` pass adds inspect-only
  guards, so the `diffBorder` path is skipped when the rendered `editing`
  flag disagrees, via `data-editing` on the border element). Item-space hover
  over a tool (not a gap) paints the nearest free flanking gaps
  (active-item fallback). `startSession` / `endDragSession` mirror the
  `.dragging` class + `data-dragging`.
  Gates: core `check`/`build`/`test` green, vanilla `check`/`test` green,
  `biome check` clean, `test:e2e` green (incl. the `drag-highlight` tool-drag
  DZ spec).

### Phase 2 status (landed 2026-09-14)
`configuration.ts` and the pure track-space math now live in core
(`configuration.ts`, `layout.ts` additions). Notes:

- The hover dwell lives in the drag session (`drag.ts`, timers via the
  `globals.ts` escape hatch so the DOM-free rule stays compiler-enforced):
  arms on a directly-hovered stack/parking gap, cancels on gap change /
  `null` hover / `end()`, one-shot latch, retarget, reset — covered by
  `drag.test.ts` session-dwell tests (node, fake timers).
- `findOwnershipViolations` stays a **core export** (not a test helper):
  adapters and conformance checks reuse the single-ownership invariant at
  runtime, so one implementation in core beats a copy in each test dir.
- `insertTrackWithToolbar` was **not** moved: it is a one-line `splice`
  the movement engine (Phase 5) will rebuild against an explicit drag-state
  param. Moving it now would freeze the old slide-engine shape in core.
- `regionDirection` was **not** moved: it maps a region to an adapter
  orientation string (`horizontal` / `vertical`), which is a rendering concern.
  Core's equivalent is `SurfaceContext.axis` (already in `layout.ts`).
- `removePaletteItem` was **not** moved: it coupled item removal to a
  border/track prune in the reference adapter's own terms. The core equivalent
  is `PaletteLayoutTree.removeItem` (location-based, prunes emptied
  toolbars/tracks the same way).
- `isEditableTarget` was **not** moved: it touches `HTMLElement` /
  `HTMLInputElement` and stays adapter-owned per the DOM-free rule.

### Packaging

- Core is **library-only**: no `demo/`, no `index.html`, no `vite.config.ts`, no
  `vite` devDep. Rollup emits esm/cjs (`dist/index.mjs`, `dist/index.cjs`,
  `dist/index.js`).
- `packages/vanilla` is the vanilla-DOM adapter **with** its own vite demo
  (`demo/main.ts` + `index.html`); it declares `external: ['@palettable/core']`
  and a `workspace:*` dep on core.
- Unit tests run in **node** (`vitest.config.ts`, `environment: 'node'`), not
  jsdom — core has no DOM to test against.
- `packages/vanilla/src/` module inventory: `adapter.ts` (minimal
  `<ul>`-renderer — predates the IDE, kept for the barrel smoke test),
  `keys.ts` / `head.ts` / `ide.ts` (`keys` + `head` + `ide` are the real
  adapter surface), `nodes.ts` (`NodeRegistry`), `highlight.ts`
  (gap-class diffing), `templates.ts` (static HTML shells — IDE skeleton,
  border/track/toolbar/item + parking shells, console overlay + result rows +
  details/add-panel shells, drawer + command-box shells; all interpolation
  through `escapeHtml`, parsed via `elementFromHtml`/`elementsFromHtml`),
  `value-proxy.ts` (adapter-owned plain-object lens over a bag —
  `createValueProxy(bag, target?, onChange?)`: proxy-set → `bag.set()`,
  bag-notify → target write-through; `Object.is` echo-loop guard both
  directions; the bag stays the single source of truth, the proxy is a lens),
  `keys.test.ts` + `adapter.test.ts` + `nodes.test.ts` +
  `highlight.test.ts` + `value-sync.test.ts` + `templates.test.ts` +
  `value-proxy.test.ts`.

### Data owning (single source in core — landed 2026-09-15)

Ownership is no longer split between `core.values` and consumer state:

- **Root value storage** (`PaletteStateStore`, a.k.a. bag `ROOT_CONTEXT`) is
  core-owned: the single source of truth, no defaults inside, starts empty.
  Absent key = skeleton (`undefined`). `reset`/`resetAll` (store) and
  `resetAll` (core) are deleted — the consumer resets via `setMany`.
- **Domain defaults + reset intent** are consumer-owned (demo
  `CONSUMER_DEFAULTS`): one defaults object used only for `setMany` hydration
  + `isColonyDirtyValues` diff. Point definitions carry no `defaultValue`;
  `isValuedPoint` guards on `type` (`action`/`nothing` excluded).
- **Plain-object lens** (`myValues.alertLevel` get/set) is adapter-owned
  (`vanilla/src/value-proxy.ts`): `createValueProxy(bag, target?, onChange?,
  options?)` with a single render path — every HTML update flows from the
  `onChange` event, never from the setter. Bag keys: proxy-set → `bag.set()`
  → bag-notify → target write-through + `onChange` (one bag write = one
  `onChange`; the setter never calls it). Local keys (`isBagKey` → false,
  e.g. UI-only `lastAction`/`missionElapsed`): proxy-set writes `target` +
  fires `onChange` directly, never touching the bag. `Object.is` echo-loop
  guard both directions. The adapter never owns the store.
- **Root name**: core exports `ROOT_CONTEXT` (`''` value, `'root'` alias via
  `isRootContext`); no bare `''` literals in adapters/demos.
- **Strictness**: `get(id)` stays lenient (absent → `undefined`, the skeleton
  probe). Strict paths throw on absent: `run` setter / toggle / step.
  New `require(id)` helper for those.
- **Skeleton**: `resolveRenderTree({ points, values: {} })` renders every tool
  (descriptor + control + keystrokes, `value: undefined`). Presenters propagate
  `undefined` (`toggle.pressed`, `select.value`, `slider.value`) instead of
  coercing (`false` / `0` / `''`); vanilla head/IDE render the unset state
  (`aria-pressed="mixed"`, empty select, `min`-parked slider).
- **`initialValues` / `setMany`** keep `validateInitialValues` strictness
  (unknown id / action / nothing id throw); docs no longer say "applied after
  defaults". `initialValues` stays the one-shot SSR/hydration constructor
  fill; the demo uses live `setMany` + proxy instead.
- **Wire**: `fromServerDescriptor` no longer rejects valued descriptors
  missing `defaultValue` (absent = skeleton tool).

### Vanilla adapter — reconciliation and DOM identity

The vanilla adapter converges on the live layout instead of rebuilding. The
rules, in one place:

- **One node per live object, keyed by `===`.** `nodes.ts` (`NodeRegistry`)
  maps live toolbars / items / tracks / parking rows to their `HTMLElement`.
  Structural commits preserve identity, so a map lookup survives mutations;
  only `setLayout()` (a `replace` op) invalidates everything. Drawer child
  toolbars share the same map (same keys, same ops) — no separate registry.
- **The op stream drives a per-region sync.** `ide.ts:applyOp` routes each
  `LayoutOp` to the affected border(s) only (`syncBorder`), so untouched
  borders keep their DOM. Parking renders inside the console overlay, so any
  parking-side involvement (including a prune victim) takes the console path.
  During a drag session a `move-toolbar` op applies at track granularity
  (`syncTrack` for exactly the tracks named by `from`/`to`/`pruned`; a
  region whose track list itself changed falls back to `syncBorder` for
  that region only) — unmoved tracks keep DOM identity, paint, and slide
  transforms. Drag `structure` events never carry `replace` (whole-loads
  only); the session derives a precise `move-toolbar` op per commit
  (`drag.ts:commitOp`, `from` = pre-mutation origin, `to` = placed toolbar,
  `pruned` = emptied toolbar/track/row victims).
- **Values never touch the layout.** Each control renderer subscribes per-id
  (`core.values.subscribe(id, …)`) and patches its own node in place
  (`updateToolNode` re-runs the presenter and writes only the changed
  attributes). There is deliberately **no** global
  `values.subscribe(() => refresh())`; the *consumer* may still subscribe
  globally for its own purposes (the demo does, for work-zone pills).
- **Editing and inspecting are chrome flips, not rebuilds.** `syncEditing()`
  reconciles `computeEditing()` against `lastEditing` and runs `applyEditing()`
  — toggling the root `editing`/`palette-editing` classes + `data-editing`,
  flipping `inert` on existing `.toolbar-item-content`, and adding/removing
  `.toolbar-item-guard` nodes and parking `×` buttons. Structural renders stamp
  the same chrome at creation so first paint matches.
  `setInspecting()` is a two-node flip (clear `data-inspected` on the old
  wrapper, set it on the new one) followed by `renderConsoleDetails()`.
- **Console traffic never re-renders borders.** The console listener
  reconciles: an `editing` flip → `syncEditing()`; an `open` flip → full
  `renderConsole()` (overlay mount/unmount); anything else (selection, add-flow)
  → `renderConsoleDetails()` only.
- **Context notifications are split by kind.** A **key** change
  (`changed.length > 0`) needs no border reload — `bindTool` already re-runs
  `updateToolNode` in place for the tools whose id moved. An **identity** change
  (`setContext` / `removeContext` emit `[]`) replaces the bag object itself, so
  the affected borders re-render via `regionsUsingBag`.
- **Gap highlight is a class diff.** `highlight.ts:syncGapClasses` diffs the
  core `GapHighlight` decision against the previous one per root and toggles
  `highlighted`/`hovered` only on changed indices — no re-render, no reactive
  reads of the dwell state. Drag sessions drive it: `pointermove` → `GapDwell`
  → core highlight/commit fn → `syncGapClasses` (`paintStackGaps` /
  `paintParkingGaps` / `paintItemSpaces`), with the one-shot dwell timer
  promoting a directly-hovered stack gap to a new track/row mid-drag.
- **Static structure lives in templates, not builders.** `templates.ts` owns
  every static shell (IDE skeleton, border/track/toolbar/item + gap shells,
  parking stack/row/gap/remove, console overlay + result rows + details +
  config/add-panel shells, drawer trigger/popup, command-box shell).
  `ide.ts`/`head.ts` parse them (`elementFromHtml`/`elementsFromHtml`) and
  attach only data bindings + listeners afterwards — no `createElement` loops
  for static structure, no `innerHTML` with unescaped data (`escapeHtml` on
  every interpolated string). Templates carry the exact classes / datasets /
  roles / testids the e2e suite asserts; `templates.test.ts` locks them.
