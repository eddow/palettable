# Architecture — palettable
Note: `svelette` has become `@palettable/svelte` + `@palettable/core`
Foundational decisions for the Svelte 5 re-implementation of `@sursaut/ui/palette`.
Start with `README.md`, then `docs/getting-started.md`. Topic guides:
`core-concepts.md` (tools, registry, scope), `layout-and-drag.md`,
`command-box.md`, `theming.md`, `testing.md`, `using-the-default-head.md`,
`creating-a-head.md`, `head-extraction.md` (what was done). This file keeps the decisions,
runtime mapping, and phase history.

## 1. Identity

- **@palettable/svelte** = the Svelte 5 (runes) adapter for `@palettable/core` — a port of `@sursaut/ui/palette` (headless palette subsystem **only**).
- **Headless** contract is preserved: the palette owns state, a11y semantics, tool resolution,
  editing, and drag/drop — **not** styling. Adapters (demo editors) own markup and CSS.
- Read-only reference source lives in `ui/` (symlink). Never edit it; treat it as the spec.
- **Out of scope:** the rest of `@sursaut/ui` — the `*Model` functions (button/checkbox/select/…),
  directives, and the `uiComponent` variant factory (styled variants + dot-syntax accessors). The
  palette has no model layer and no variant layer.

## 2. Toolchain (locked)

| Tool | Version |
|------|---------|
| Node | 24.x |
| npm | 11.x |
| Svelte | `^5.57.0` (runes mode) |
| SvelteKit | `^2.70.3` |
| Vite | `^8.2.2` |
| `@sveltejs/vite-plugin-svelte` | `^7.3.0` |
| TypeScript | `^6.0.3` (TS 7 native compiler is **not** supported by `svelte-check`) |
| Biome | `^2.5.12` |
| Vitest | `^5.0.0` (+ `@testing-library/svelte`, jsdom) |
| Playwright | `^1.62.1` |

## 3. Runtime mapping

| Sursaut | Svelte 5 |
|---------|----------|
| `mutts.reactive(x)` | `$state(x)` |
| `mutts.effect(fn)` | `$effect(fn)` |
| `mutts.unwrap(x)` | `x` (proxies are transparent) |
| `mutts.lift(fn)` | `$derived` / `$derived.by` |
| `JSX.Element` / `() => JSX.Element` | `Component` (`Snippet` excluded — no runtime discriminator) |
| `options.iconFactory` | module-level `$state` icon factory |
| Sursaut `use:directive` | Svelte `use:` action |
| `latch()` portal | `mount(Component, { target })` from `svelte` |
| `env` / scope | Svelte context or props |
| `componentStyle.css` | global `styles/palette.css` (no scoping, no injection) |
| `options` global config | module-level `$state` |

## 4. File & naming rules

- Runes (`$state` / `$derived` / `$effect`) **only** compile in `.svelte.ts` / `.svelte.js`.
- Pure algorithms → `.ts`; reactive modules → `.svelte.ts`; UI → `.svelte`.
- One module = one concern, mirroring the reference source map (`types`, `keys`, `palette`,
  `command-box`, `components/*`, `drawer-editor`, `styles/*`).
- Public entry points: `src/lib/palette/core.svelte.ts` (read-only display + run),
  `src/lib/palette/edition.svelte.ts` (mutation surface, re-exports `core`).

## 5. Editors are components — no model / variant layer

The palette does **not** use `@sursaut/ui`'s `*Model` lazy-getter pattern (`buttonModel`,
`checkboxModel`, …). That pattern belongs to the general UI library, which is out of scope.

- A palette **editor** is a plain Svelte component that receives a `PaletteEditorContext`
  (`item`, `tool`, `scope`, `flags`, `surface`) and renders itself.
- No grouped-attribute objects to spread (`model.button`, `model.input`), no self-referential
  getters.
- No `uiComponent` variant factory and no styled variants. The palette is headless; any visual
  styling belongs to the demo/adapter, never the palette core.
- `PaletteEditorSpec.editor` / `.configure` hold a component (or a function returning one), not a
  JSX factory.

## 6. Shared runtime state

- A single module-level `$state` object (`palettes`) owns `catalogDrag`, `dragging`, `editing`,
  `inspecting` — exactly one palette editable at a time.
- The drawer collapse signal (`paletteDrawerCollapse`) is a `$state({ version: 0 })`; consumers bump
  `version` to close all open drawers synchronously.
- Both live in `.svelte.ts` modules so any importer reacts to changes.

## 7. Editor registry

- Registries are keyed **family → variant** (`run`, `boolean`, `number`, `enum`, `item`).
- A `PaletteEditorSpec.editor` is a Svelte **component** (not a JSX factory). Rendering resolves the
  spec then mounts it dynamically (`svelte:component` or `mount`).
- `PaletteEditorContext` carries `item`, `tool`, `scope`, `flags`, and `surface` (axis + region).
- `surface.axis` derives from region: `top`/`bottom` → `horizontal`, `left`/`right` → `vertical`.

## 8. Icons

Sursaut's `@sursaut/ui` is **not** hardcoded to a glyph library: the palette only carries an icon
value and never renders it itself. Rendering is delegated to a pluggable `options.iconFactory`;
the `pure-glyf` package (a separate optional Vite-plugin + adapter, `registerGlyfIconFactory()`)
is merely *one* such factory.

@palettable/svelte mirrors that split, in a Svelte-idiomatic way:

- **Palette core stays icon-agnostic.** `PaletteIcon = string | Component` flows through
  tools / entries / toolbar items to the editor, which is the *only* thing that renders it.
  (`Snippet` is excluded: `Component` and `Snippet` are both callables with no runtime
  discriminator, so the `Icon` helper could never render a `Snippet` member. Callers with
  inline markup wrap it in a component or render it directly with `{@render}`.)
- **One small `Icon.svelte` helper** (demo/adapter layer, not core) resolves the two cases:
  - `Component` → `<svelte:component this={...} />`
  - `string` → a registered string resolver, else `<span data-icon="name">name</span>`
- **String-name resolution** is a consumer concern, provided as a module-level `$state` factory
  (the Svelte equivalent of `options.iconFactory`), e.g. `icons.factory = (name) => <i class={name} />`.

We do **not** port `pure-glyf`; the demo can use `Component` directly, emoji strings, or
register a factory that maps names to CSS classes.

## 9. Portal pattern (drawer)

Drawers render a popup perpendicular to their parent axis into `document.body` via
`mount()`. The popup root receives a new scope carrying `palette` and `region` so nested
`Toolbar`s resolve tools and nested drawers invert their axis correctly.

## 10. Serialization

- `serializePaletteLayout` / `validatePaletteLayout` are pure (`.ts`).
- `hydratePaletteLayout` rebuilds deeply reactive structures with `$state` (`.svelte.ts`).

## 11. Styling — global CSS, never scoped or injected

- CSS is **always global** unless true component scoping is required. Palette styles live in
  `src/lib/palette/styles/` (`palette.css` headless layout + edit-mode affordances);
  the default visual theme lives in the head (`src/lib/head/styles/head-default.css`).
  Both are imported once by the app — never injected at runtime, never duplicated per instance.
- Selectors stay specific through class hierarchy (`.palette-ide.editing .toolbar:hover::before`),
  never bare names (`.active {`). No `data-palette-id` scoping: only one palette is editable at
  a time (`palettes.editing`), so per-instance `<style>` elements are pure overhead.
- The reference `componentStyle.css` injection (`paletteInstanceStyle` + `#disposeStyle`) was
  deleted. `Palette.dispose()` is a no-op kept for API parity.
- Edit-mode hover states are live, not just unblocked: `paletteRoot` toggles
  `editing`/`palette-editing` classes + `data-editing` from `palette.editing`, and the
  ported `.palette-ide.editing .toolbar…` / `.toolbar-item-guard…` rules render the
  hover/active chrome. Verified in the Phase 9 demo (edit toggle → hover a toolbar).
- Drawer popup classes use the `palettable-` prefix (`.palettable-drawer__popup`), not
  `sursaut-`.

## 12. Palette runtime (Phase 3 — implemented, review fixes applied)

- `src/lib/palette/palette.svelte.ts` ports `ui/src/palette/palette.ts` verbatim except for the
  Sursaut runtime swaps below; `src/lib/palette/core.svelte.ts` / `edition.svelte.ts` are the barrel entry points.
- `mutts.reactive(x)` → `$state(x)`; `mutts.unwrap` → direct reads. Svelte `$state` never
  proxies class instances, so palette identity is plain `===` (`palettes.editing === this`).
- `mutts.effect` in `setter()` is omitted: module scope has no effect context, the `WeakMap`
  restore entry is GC-hygienic on its own. Verified divergence: with two setters on one tool
  (`fontSize|11`, `fontSize|12`), the second `run()` overwrites the first's stored restore
  value without sursaut's effect cleanup, so re-running the second setter restores the stale
  value instead of `default`. Single-setter behaviour is identical. (The `fontSize`
  example is the historical unit-test fixture name; the demo now uses colony tools.)
- `renderEditor` / `renderConfigurator` **return** the editor/configurator component (the adapter
  renders it with a `context` prop built by `resolveEditorContext`) instead of invoking a JSX
  factory. `Palette.Toolbar` / `Palette.Ide` factories are omitted here — layout components land
  in `components/` (Phase 5).
- `resolveConfiguratorScope` computes sursaut's `augmentedScope` (`scope` + `editorChoices`)
  for **both** configurator paths: the `configurator` fallback receives it as its `scope`
  argument, and adapters rendering a registry `spec.configure` component bind it as
  `context.scope` (via `resolveConfiguratorContext`). `surfaceContextFromScope` centralizes
  region→axis derivation; `setPaletteScope` / `getPaletteScope` carry the scope record through
  Svelte context (drawer portals propagate `palette` + `region` through it).
- `$state` is only legal as a variable initializer, so `hydratePaletteLayout` builds a plain
  layout first and wraps it once (`const borders: PaletteBorders = $state(plain)`); nesting
  becomes reactive via deep `$state` proxying. Call it during component/module init, not from
  late event handlers or async callbacks. The native `dragend` listener stays a boolean-guarded
  `window.addEventListener` (capture): `svelte` exposes no `effectRoot`, and module scope has
  no effect context; the handler delegates to `clearPaletteCatalogDragOnNativeDragEnd` (tested).
- Tests: `tests/palette/palette.test.ts` (17) + `tests/palette/serialization.test.ts` (15) +
  `tests/palette/command-box.test.ts` (25) port `palette.spec.tsx` + `serialization.spec.ts` +
  `command-box.spec.ts`; JSX-factory assertions become component-identity assertions,
  `mutts.reactive` fixtures become plain objects, and the `configure`-call-count assertion is
  dropped (spec components are returned, not invoked). Added: configurator-scope injection,
  surface-axis derivation, `dragend` clearing, multi-setter divergence, and hydrated
  reactivity (`HydratedBordersProbe.svelte`).

## 13. Command box (Phase 4 — implemented)

- `src/lib/palette/command-box.svelte.ts` ports `ui/src/palette/command-box.ts` verbatim except
  for the Svelte runtime swaps: `mutts.reactive` → `$state`, `mutts.lift` → `$derived.by`,
  `string | JSX.Element | (() => JSX.Element)` icons → `PaletteIcon`.
- `paletteCommandBoxModel` must be created during component/module init (same `$state`
  init-time constraint as `hydratePaletteLayout`). `entries` may be a static array or a reader
  function re-read inside `$derived`; a component-owned `$state` source refreshes `results`
  (asserted via `CommandBoxEntriesProbe.svelte`).
- `$derived` values are exposed through getter properties on the returned model object, never
  as shorthand properties — shorthand captures the initial value and breaks reactivity
  (`state_referenced_locally`).
- `commandRunner` throws `PaletteError` (not plain `Error`) for non-runnable specs, matching
  the palette error taxonomy (deliberate divergence from the reference, which throws `Error`).
- Tests: `tests/palette/command-box.test.ts` (26) ports `command-box.spec.ts`; `h()` fixtures
  become stub components, `mutts.reactive` becomes a probe-owned `$state`. Added:
  non-runnable spec throws `PaletteError`.

## 15. Layout components (Phase 5 — implemented)

- `src/lib/palette/layout.svelte.ts` ports `ui/src/palette/components.tsx` headless logic:
  track spacing (`actualTrackSpaceAt`/`insertToolbar`/`removeToolbar`/`resizeToolbar`),
  toolbar moves (`moveToolbarToTrack`/`moveToolbarToStack`), hit-testing
  (`resolveTrackSpaceTarget`/`resolveToolbarSpaceTarget`/`resolveStackSpaceTarget`),
  toolbar preview (`previewToolbarItems`/`finalizeToolbarPreview`), catalogue insert
  (`beginPaletteCatalogInsertDrag` + native `dragover`/`dragend` window listeners), and
  Svelte actions (`paletteRoot`, `paletteTrackSpace`, `paletteStackSpace`,
  `paletteToolbarSpace`, `paletteToolbarDrag`, `paletteItemDrag`, `paletteItemShield`).
- `src/lib/palette/drag-session.ts` ports `startLocalDragSession` trimmed to pointer
  capture + window move/up listeners (no preview element; the 4px activation threshold
  lives in the caller, matching the reference).
- Runtime swaps: `mutts.reactive` → plain arrays (the `$state` `palettes` store proxies the
  session on assignment); `mutts.unwrap` → direct reads; `mutts.effect` in `paletteRoot` →
  `$effect` inside the action body (actions run in component init context — verified with a
  throwaway probe before implementing); `startLocalDragSession` → `startPaletteDragSession`.
- Dropped with rationale: `arranged()` scope classes (no `orientation-*`/`density-*`
  selectors exist in the ported CSS; direction flows through `palette-horizontal` /
  `palette-vertical` + `stack-*`); `use:toolbarsContainer` (no definition anywhere in the
  reference source or its dependencies — layout is fully described by CSS classes).
- `Palette` interface gains `resolveConfiguratorScope` / `resolveEditorContext` (already
  implemented on the class in Phase 3; the interface was missing them and `Toolbar` needs
  them for the `<PaletteItem>` bind step).
- Components (`components/`): `Ide.svelte` (four optional borders + center slot, `$derived`
  scope record published via `setPaletteScope`), `Toolbar.svelte` (toolbar + item spaces, edit-guard
  overlay, click-to-inspect; border or parking location, never both), `ToolbarTrack.svelte`
  (slots + spacing), `ToolbarBorder.svelte`
  (region border, `inverse` reverses track order), `Parking.svelte` (owns the independent
  `parking` stack, delete-button per row), `PaletteItem.svelte` (binds
  `resolveEditorContext` output to `<Editor context={...} />`).
- Components take `palette` (runtime class) + `scope` as props instead of Sursaut's ambient
  scope/second-arg; `Toolbar` computes `dragTarget`/`spaceTarget` via functions (not `$derived`
  shorthand) so space registration always sees current props.
- Actions return `ReturnType<Action>` (`{ destroy() }`), not bare cleanups — Svelte's action
  contract requires the object shape.
- Tests: `tests/palette/components.test.ts` (13) ports `components.spec.ts` via
  `PaletteRootProbe`/`PaletteItemDragProbe`/`IdeProbe`/`ParkingProbe` + `ParkingEditorStub`
  (`rootEnv` directives become `use:` actions; `$state` proxies force `toStrictEqual` over
  `toBe` for `inspecting.item` and the catalogue seed border); `tests/palette/item-movement.test.ts`
  (13) is a verbatim port of `item-movement.spec.ts` locking the Phase 3
  `resolveItemPlacementTarget` contract.

## 16. Demo editors & configurators (Phase 6 — implemented)

- `src/lib/demo/editors/` holds two plain Svelte editor components (no model layer,
  no variant factory): `SliderEditor` (same-key `number.slider` override adding a
  value badge) and `StarsEditor` (`number.stars` extension, a play/rating row of
  "▶"/"▷" triangles). Each takes `context: PaletteEditorContext` and mutates the
  `$state` tool via `sliderPresenter` (`view.set`).
- Shared helpers live in `editors/meta.ts` (`toolbarMeta` / `tooltip` / `layoutFromSurface` /
  `regionFromScope` / `menuChevron` / enum-subset filtering + display). Helpers accept the
  generic `PaletteToolbarItem<string, string, unknown>` (`AnyItem`) so demo components stay
  assignable at the `Toolbar` render boundary without per-schema generics.
- Split/menu editors (`SplitButton`, `SplitRadio`) use local `$state` open flags + plain
  `{#if open}` menus (no `*Model` popover helpers); `Stars` renders `maximum` buttons with
  `role="radio"`; `Slider` binds `min`/`max`/`step` from the number tool; `CommandBox` builds
  its own `paletteCommandBoxModel` from `context.scope.palette` at init (editors receive only
  `context`, so the box cannot be injected as a prop; seeding is deliberate and
  `state_referenced_locally` is suppressed).
- Configurators (`BaseConfigurator` label/icon/hint/editor/tone) read
  `context.scope.editorChoices` injected by `resolveConfiguratorScope`;
  `registry.ts` wires `spec(editor, configure, footprint)` per family → variant,
  mirroring the reference `demoEditors` registry.
- Demo palette (`src/lib/demo/palette.svelte.ts`): `$state` colony state + `Palette`
  with key bindings, `editorDefaults` for all families, and
  `initialIdeConfig: PaletteBorders` covering every tool family in every region
  (top command-box-combobox/lockdown/toggles/threat; left sim-speed/atmosphere/
  power + nested drawer; right tax/solar/stars; bottom console/save/reset/
  hyper-tick). `src/routes/+page.svelte` renders `Ide` with `$state` borders;
  the console (head `Console.svelte`) hosts the presentation-only inspector
  (`renderConfigurator` + `resolveConfiguratorContext` → `<Configurator context>`).
- Defensive failure mode confirmed: `Toolbar.svelte` try/catch renders nothing on unknown
  tools/missing editors — desired, keeps broken items inert in edit mode instead of crashing
  the bar.
- Gates: `check` 0/0, `lint` clean, `test` 92 pass, `build` ok.

## 17. Drawer editor (Phase 7 — implemented)

- `src/lib/palette/drawer-editor.svelte.ts` ports `ui/src/palette/drawer-editor.tsx`:
  `paletteDrawerCollapse` is module-level `$state({ version: 0 })` (same pattern as
  `palettes`); `createPaletteDrawerEditor({ portalContainer })` returns a spec whose
  `editor` is the shared `DrawerEditor` component (`flags: { footprint: 'horizontal' }`).
  Dropped with rationale: per-instance `triggerClass` / `overlayClass` / `popupClass` /
  `popupExtraClass` (CSS is global — `palettable-drawer__*` in `styles/palette.css`),
  `renderIcon: JSX.Element` / `renderTrigger` (icons are `PaletteIcon`, trigger is fixed
  icon + label + chevron), `triggerStyle` (no parent-toolbar square-size override to fight).
- `components/DrawerEditor.svelte` (trigger) + `components/DrawerPopup.svelte` (portal root)
  replace `latch(host, jsx, env)`: the trigger holds local `$state` `open` + `popupPos`,
  the portal `$effect` reads `open`/`item` up-front (so close re-runs teardown), then
  `mount(DrawerPopup, { target: host })` into `document.body` (or the factory
  `portalContainer`); teardown removes listeners + `unmount(app)` + `host.remove()`.
  `DrawerPopup` publishes `palette` + child `region` via `setPaletteScope` and binds the
  same scope to the child `Toolbar` — nested drawers resolve tools and invert their own
  axis without prop-drilling.
- Perpendicular-direction contract (verbatim): child direction inverts the parent axis,
  child region follows (`vertical` → `'left'`, `horizontal` → `'top'`).
  `open` (`click` | `hover` | `press`) and `placement` (`start` | `center` | `end`) come
  from the item `config`, defaulting to `click` / `center`.
- Collapse signal: drawers track a plain non-reactive `seenVersion` (seeds on first
  run, closes on later bumps — no `untrack` idiom). `syncPopup()` only assigns
  `popupPos` when the rect actually changed — unconditional writes re-trigger the portal
  effect forever (`effect_update_depth_exceeded`); the whole read sits in try/catch so a
  detached trigger can never break the effect.
- Portal hygiene: the missing-palette guard runs before `appendChild` (no leaked host
  `<div>`); the portal receives the shared `$state` `popupPos` object so resize/scroll
  re-renders in place instead of remounting (nested state preserved). `open: 'hover'`
  uses a 120ms leave-grace: trigger-leave schedules a close that popup-enter cancels,
  so the pointer can travel to the body-portaled popup. Scope flows via props today
  (explicit, serializable); `setPaletteScope`/`getPaletteScope` stay as the documented
  portal-propagation path (`Ide` + `DrawerPopup` publish it).
- `Toolbar.svelte` editor-only fix: `resolveItem` no longer bails on `tool === undefined`,
  so `drawer` / `commandBox` items resolve through the `item` registry (tool-backed items
  still render nothing on unknown tools — desired). `Palette` interface gains the missing
  `resolveConfiguratorContext` (already on the class; `DrawerPopup`'s `Toolbar` needs it
  for the `<PaletteItem>` bind). Demo registry wires `item.drawer`; demo layout adds a
  left nested drawer (atmosphere select + sim-speed stepper).
- Tests: `tests/palette/drawer.test.ts` (6) — factory shape, open-on-click + Escape close,
  collapse-signal close, axis inversion both ways, popup scope publishing, hover travel
  stays open. Gates: `check` 0/0, `lint` clean, `test` 113 pass, `build` ok.

## 18. Demo page (Stellar Outpost — current)

- `src/lib/demo/palette.svelte.ts` is a **Stellar Outpost** space-colony sim:
  `$state` colony state (`autoOxygen`, `shieldGenerator`, `fastMode`,
  `colonyTheme`, `alertLevel`, `powerPriority`, `gameSpeed`, `taxRate`,
  `solarEfficiency`, `satisfaction`) + `missionElapsed` (the mission clock,
  rendered by the work-zone chip only) +
  system `theme` + `lastAction`, with run tools `emergencyProtocol` (disabled at
  green), `saveGame` (localStorage), `resetSimulation` (dirty-gated), `console`
  (quake-style toggle — the core `consoleTool`, with demo label/icon override).
  Keys: `` ` `` console, `N`/`S`/`E` toggles + lockdown, `Ctrl+S` save,
  `+`/`-` sim speed, `1/2/3` threat presets.
- `initialIdeConfig` avoids duplicate tool/editor pairs across borders: top
  (command-box launcher, lockdown, life-support, shields, threat
  segmented), left (sim-speed slider, atmosphere select, power segmented +
  nested drawer), right (tax slider, solar stepper, satisfaction stars),
  bottom (console, save, reset, hyper-tick, pointless status readout). `editorDefaults`
  covers the point families (`run`/`boolean`/`enum`/`number`).
- `src/routes/+page.svelte` renders `Ide` with `$state` borders + a save/load
  layout button group. The work-zone shows every colony variable as pills + a
  colony-status panel + an `mm:ss` elapsed-since-launch chip (the work-zone chip
  reads `demoState.missionElapsed` directly); the open console
  dims + disables it (`.demo-center.is-dimmed`, quake-style modal).
- Console (`src/lib/palette/console.svelte.ts` headless state + `src/lib/head/Console.svelte`
  modal, opened by the core `console` run tool): core owns `consoleState`
  (`open` + `mode: 'run' | 'edit'`), `openConsole`/`closeConsole`/`toggleConsole`,
  `consoleTool` — the **run-mode** surface lives in `core.svelte` (read-only palettes can open
  a command console); the add-to-toolbar UI state (`resetConsoleAddState`, `popupAddList`)
  stays in `edition.svelte`. The head owns the modal markup/CSS/placement (viewport-centred
  fixed box, `max-inline-size: 48rem`, non-blocking backdrop so borders stay interactive in
  edit mode).
  The console **auto-detects** whether a `commandBox` (combobox) is displayed in any border: if
  so it opens in **edit mode** (running already happens inline in the combobox, so the modal is
  for edition only — no edit button); if not it opens **command-first** (run box) and, when the
  palette is R/W (`editable !== false`), offers a **square edit-icon button**
  (`console-mode-toggle`, an `aria-pressed` toggle, `✎`/`✓`) on the left of the command box to
  enter/leave edit mode. A read-only palette gets no edit button and stays in run mode. Adding/removing
  the `commandBox` item changes behaviour live. Edit mode shows a **single** list: the add-box
  results (`console-results`, `Add to toolbar…` — the only draggable surface) and, once an add
  entry is selected, the *Details* panel (`console-details-panel`) with its variants. Run mode
  shows only the run-box results (`Command…`). Edit mode mirrors `consoleState.mode` onto
  `palettes.editing` (so the `inert` shield + drag guard engage on the underlying toolbars);
  closing the console always clears the mirror (plus `palettes.inspecting`), so toolbars never
  stay inert after an edit-mode close.
- The toolbar `commandBox` item is a real **commands-combo-box** (`commandBoxPresenter`): a text
  input + results popup that runs commands inline (Ctrl-Shift-P style). It is a **run** surface,
  independent of the console. When the palette is R/W, the combobox shell also carries a **square
  edit-icon button** (`command-box-open-editor`, `✎` — a plain button, not a toggle) that opens
  the console in **edit mode**. Selecting a toolbar item (`pointerdown` → `palettes.inspecting`)
  highlights it (`data-inspected`) and renders a **presentation-only** configurator in the
  console's single *Details* panel (`console-details-panel`) — the same place shows the add
  variants when an add entry is selected (inspect and add are never used together).
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
  `isDraggedToolbarAt` compares the container, not just the object).
- Persistence: `+page.svelte` seeds `structuredClone(demoLayoutFor('rw-combobox').*)` `$state`
  at init (server + client first render identical, no hydration mismatch; also avoids mutating
  the shared module objects) plus an empty `$state` parking stack, and splices a validated
  stored snapshot in `onMount`
  (`hydratePaletteLayout` can't run post-init — its `$state` is init-only — so each
  stored flat slot is re-nested as its own single-slot track, the same shape
  `hydratePaletteLayout` produces, and spliced into the deep proxies; parking rows
  splice into their own stack). `serialize`/`hydrate` round-trip parking alongside
  borders. The demo ships three
  **configurations** (`demoConfigs` in `src/lib/demo/palette.svelte.ts`): `rw-combobox`,
  `rw-command-first`, `ro-combobox` — each loaded by a plain preset command button
  (no toggle state); `demoLayoutFor(id)` flips
  the reactive `demoEditable` flag (`get editable()` reads it). A "Save layout" /
  "Load layout" button group round-trips through localStorage.
- **Edit-mode inert:** `paletteItemShield` is a Svelte 5 action with an `update()` that sets
  `element.inert` on the item content wrapper — a run button/toggle/combobox becomes inert
  (unfocusable, unclickable) while `palette.editing`, leaving only the `paletteItemDrag` guard
  to own pointer events (select-for-edition / move).
- Inspector structural actions: `describeItemConfiguration` on the live toolbar/index
  (resolved by item identity across all four borders) drives move-backward/move-forward
  (splice within the toolbar) + remove buttons and the `bindings.shortcut` display
  (`findByTool`).
- Init-time constraint respected: all `paletteCommandBoxModel` instances are created during
  component init; stored-layout restore splices plain data in `onMount`, never in handlers.
- Gates: `check` 0/0, `lint` clean, `test` 117 pass, `build` ok.

## 19. E2E coverage (Phase 10 — complete)

- `e2e/palette.spec.ts` (5): command launcher opens the edit-only console +
  `.palette-ide.editing` chrome, drawer open with axis inversion (left drawer →
  `is-horizontal` popup) + Escape close, presentation-only inspector via
  `pointerdown` on the edit-mode `.toolbar-item-guard` (highlighted item +
  configurator in the console details panel), layout save → reload → "restored"
  badge → reset, pointer drag reorder (synthetic `PointerEvent` `pointerdown` on
  the autoOxygen guard + `pointermove`/`pointerup` on `window` with a shared
  `pointerId`, drop on the gap after alertLevel → order flips to `[commandBox,
  emergencyProtocol, shieldGenerator, alertLevel, autoOxygen]`).
- `e2e/console.spec.ts` (8): backtick opens the edit-only console (Ide root
  focused first — `paletteRoot` listens on the root `keydown`, so a bare
  body-level press never reaches it), Console button open + Escape close
  (+ work-zone `is-dimmed` while open), **command-first mode** (no combobox →
  console command-first + square edit button toggles to edit), **read-only mode**
  (no edit button, stays command-first), **edit-inert** (toolbar item content is
  `inert` while editing), no mode button when a `commandBox` tool is displayed,
  add flow (Life Support entry → variant card → value select in the single
  details panel), tools-panel rows carry `draggable="true"`,
  tools-panel drop (synthetic `dragstart`/`dragover`/`drop` with a `dataTransfer`
  stub → session path inserts the row's item into the first toolbar gap,
  count + 1).
- E2E lessons: `paletteItemDrag` inspects on `pointerdown`, so tests dispatch
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
  `$state` proxy re-link + unconditional catalogue seed insert.
- Flake note: toolbar command-box e2e failed once under 11-worker `fullyParallel`
  (result `toBeVisible` timeout; green in 2 full + 3 isolated reruns) — mitigated by
  waiting for `.palette-default-command-popover` before asserting the result (the
  140ms `inline-size` transition delays popover visibility vs. actionability).
- Gates: `check` 0/0, `lint` clean, `test` 113 pass, `test:e2e` 12 pass, `build` ok.

## 20. Drag-engine `$state` proxy hazards (Phase 10 — found via e2e)

- `createItemDragging` detaches the item on `pointerdown` but defers the re-insertion
  preview to drag activation (`onActivate` in `paletteItemDrag`): previewing on the
  still-plain session object stores the live source toolbar in the preview, and the
  subsequent `palettes.dragging = dragging` `$state` assignment breaks the shared
  ephemeral border/track references — the next move's preview no-ops
  (`border.indexOf(track)` misses) while the removal stands, so the item vanishes.
  A plain click (no activation) restores the item at its origin via `onClick`.
- Activation re-links the ephemeral shell through the store's own proxies
  (`active.track = active.border[0]`, `active.toolbar = track[0].toolbar`) before
  running `onActivate`: without this, `indexOf` still misses even for the deferred
  preview (proxied border vs. plain track).
- Catalogue `onDrop` inserts the session item unconditionally when no preview was
  committed: the old seed-border `===` guard fails under `$state` proxies even when
  the session never moved, silently dropping the insert. Double-insert is impossible
  (`delete palettes.dragging` makes a second drop fall through to the spent MIME
  path).

## 14. Tooling conventions

- Lint/format: `pnpm lint` / `pnpm lint:fix` (Biome — tabs, single quotes, `asNeeded`
  semicolons, width 100; Svelte via `html.experimentalFullSupportEnabled`).
- Type-check: `pnpm check` (`svelte-kit sync && svelte-check`).
- Unit: `pnpm test` (Vitest, jsdom, `resolve.conditions: ['browser']` for Svelte client build).
- E2E: `pnpm test:e2e` (Playwright, builds + previews on port 4173).
- Scratch files go in `sandbox/` (git-ignored), never `/tmp`.

### Gotchas (recorded)

- Run `svelte-kit sync` before Vitest — the generated `.svelte-kit/tsconfig.json` is required by
  the resolver (`tsconfig not found`).
- Vitest must set `resolve.conditions: ['browser']`, else Svelte resolves to its server build and
  `mount()` throws `lifecycle_function_unavailable`.
- Biome 2.x has no `files.ignores`; exclusions are `!`-prefixed entries in `files.includes`.

## 21. `@palettable/core` — headless package

`packages/core` is the framework-agnostic headless layer. `packages/vanilla` and
`packages/svelte` are the two DOM adapters; both import core, never the reverse.
See `plans/mitosis.md` for the remaining migration work (Phases 2–7) and the
per-module disposition.

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
  `packages/svelte`); core exposes only structural commits
  (`PaletteLayoutTree.moveItem` / `moveToolbar` / `insertItem` / `removeItem`).

### Core contracts

- **Icons are opaque tokens** (`IconToken = string`). Resolution to a component or
  glyph is an adapter concern; core never imports an icon factory.
- **Keystrokes are normalized strings** (`"Ctrl+Shift+S"`). Core owns only the
  headless lookup (`findKeystrokesFor`, `findKeystrokesForTarget`); adapters
  own `KeyboardEvent` → keystroke normalization (`normalizePaletteKeystroke`,
  `paletteKeystrokeFromEvent`). `KeyBindings` values are strings (references
  by name); inline virtual definitions live on toolbar items, never in this
  map — a key bound to an inline stash uses the stash's `id`.
- **Virtual points** (`virtual.ts`) are end-user-defined derived points over a
  source point: `enum-from` (present any value as an enum / enum subset) and
  `stash` (push-aside / pop-back toggle action, single aside slot — no stack).
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
  a **serialized** region is a *flat* slot list (track boundaries are not
  persisted), a **live** region is a list of *tracks*. `version: 1` is the
  discriminator; hydration wraps each serialized slot in its own single-slot
  track, cloning preserves track boundaries.
- **Teardown**: `PaletteCore.dispose()` drops value **and** layout listeners
  (`PaletteStateStore.clearListeners` + `PaletteLayoutTree.clearListeners`).
  Values and layout are kept.
- **Build**: `tsconfig.build.json` excludes `src/**/*.test.ts`, so tests never
  land in `dist`.

### Module inventory (`packages/core/src/`)

One module per concern — the 980-line `palette/types.ts` was split, not copied:

| Module | Contents |
|--------|----------|
| `index.ts` | barrel — re-exports every module below |
| `identifiers.ts` | `IconToken`, `Keystroke`, `Unsubscribe`, listener types |
| `type.ts` | `EnumOption`, `DefaultTypeMap`, `TypeMap`, constraints (declaration-merging extension point) |
| `points.ts` | `PointBase`, `ActionPoint`, `ValuedPoint` + per-type aliases, `NothingPoint` (`type: 'nothing'` — context + enablement only; `isNothingPoint` guard), `isActionPoint` / `isValuedPoint` (both `false` for nothing-points); `PointBase.uses` (optional bags, load-bearing in Phase 8) + functional `can(...bags)` on all kinds (omitted = enabled) |
| `specs.ts` | `PointSpec`, `PointTarget`, `isInlineSpec`, `canonicalSpecId`, `parsePointSpec`, `canonicalPointId` |
| `store.ts` | `PaletteStateStore` + `setTree` batching (Phase 3: all writes land before any listener runs, returns changed keys) |
| `layout.ts` | layout data types, `PaletteLayoutTree`, `defaultLayoutFromPoints`, `validateSerializedLayout`, `isDrawerItem`, pure track-space math (`clampUnit`, `actualTrackSpaceAt`, `insert/remove/resizeToolbar`, `removeEmptyTrack`, `removeParkedToolbar`, `canonicalItemTool`, `itemFingerprint`, `findOwnershipViolations`); item `tool` is `PointTarget` (string ref or inline virtual), serialized `tool` is `string \| VirtualPoint`, clone/serialize deep-copy inline definitions |
| `configuration.ts` | `configuration` magic numbers + `PaletteConfiguration` (Phase 2, verbatim) |
| `gap-dwell.ts` | `GapDwell` hover-dwell state machine + `GapDwellState` (Phase 2; timers via `globals.ts` so `lib` stays `ES2022`-only) |
| `editors.ts` | `PointFamily`, `EditorCapability`, `EditorChoice`, `familyOfPoint`, `editorChoicesFor` |
| `keys.ts` | `KeyBindings`, `findKeystrokesFor`, `findKeystrokesForTarget` (headless lookup only) |
| `virtual.ts` | `enum-from` / `stash` derived points |
| `errors.ts` | `PaletteError` + `PaletteWriteError` (thrown by locked-bag `set`/`setTree`; adapters catch for UI feedback) |
| `globals.ts` | `scheduleMicrotask` + `scheduleHostTimeout` / `clearHostTimeout` + `cloneValue` — the only host globals |
| `core.ts` | `PaletteCore`, `PaletteCoreOptions` (+ `initialValues` hydration, Phase 3), `values` (`PaletteStateStore` — the single value surface, not re-implemented), `resolveTargetVirtual`, `setMany`, `resolveEditablePoint`, `readActionCan` (functional-`can` read), `canRunAction` (bounds-checked named-action `can`), sync `run` / `runStash`, `resetAll`, context registry (`setContext`/`removeContext` replace-never-append, `getBag`/`resolveBags` never-throw, `evaluateCan`, `subscribeContext`, `subscribeCan` flip-only), `dispose` (drops value + layout + context listeners) |
| `palette.ts` | `ServerPointDescriptor` (action/valued/nothing — no `run`, no functional `can`) + `to/fromServerDescriptor` (action rebuild by name via `runners`; nothing-points round-trip), `validateInitialValues` (rejects actions + nothing-points), `readSetterValue` (headless `valueReader` port; the single setter-coercion path) (Phase 3, SSR §4.1–§4.2) |
| `command-box.ts` | `paletteCommandEntries` / `paletteAddItemEntries` / `paletteDerivedVariants` / `paletteEnumSubsetValues` + `tokenizeQuery` / `trimLastToken` / `filterCommandEntries` / `suggestCommandKeywords` / `parseCommandInput` / availability helpers (Phase 4; pure over descriptors, `run` = spec string, entries carry `uses`) |
| `console.ts` | `ConsoleStore` (vanilla open/close/toggle + add-state + listener set) + `consolePointDescriptor` run-point descriptor (Phase 4; svelte wraps in `$state`) |
| `presenters.ts` | `button`/`toggle`/`select`/`slider`/`status`/`configurator` presenters (pure over definitions + values + config), `resolveEditorVariant` (single-id fallback chain), `axisForRegion` + drawer perpendicular rule, enum-from/stash display helpers (Phase 5; `BoundDisplay.bags` load-bearing in Phase 8 — `buttonPresenter` evaluates functional `can` against bound bags) |
| `render.ts` | `resolveRenderTree` (pure definitions + virtuals + layout + values → render tree; no `run`/`set`/timers/DOM), `snapshotPalette` (atomic layout + values + virtuals + pinned config), `ValueCodec` registry (`register/clear/serialize/deserializeValue(s)` — custom types SSR-unsafe-by-default), `RENDER_MAX_DEPTH` (Phase 7, SSR §4.3–§4.8; import-graph rule: never imports `globals`/`gap-dwell`/`umd`) |
| `context.ts` | `ValuesBag` (flat key/value storage: frozen `get`, `set`/`setTree` one-notify, global + per-key `subscribe`, `clearListeners`, `lock`/`unlock` → `PaletteWriteError`), `ContextName` (`''` = root), `BagListener`/`BagKeyListener` (Phase 8; same Map + `Object.is` + snapshot-iteration + async re-throw discipline as the store) |
| `context-display.ts` (+ `context-display-types.ts`) | pure `(boundValues, boundBags)` resolvers: `dualSourceValue` (selection-bag-wins precedence), `boundValueAt`/`boundBagAt`/`readBoundBagKey` (never throw on missing context), `missingContext` sentinel (Phase 8; no mirroring, no virtual chaining) |
| `styles/palette.css` | layout + edit chrome (Phase 6, verbatim from svelte; global selectors unchanged) |
| `theme/head-default.css` | dark base + light override (Phase 6, verbatim from svelte; stay in sync per `docs/theming.md`) |

### Phase 7 status (SSR render model — landed 2026-09-14)

`core/render.ts` (+ `render.test.ts`, 14 tests) implements `plans/ssr.md`
§4.3–§4.8 on the Phases 3–5 surface:

- `resolveRenderTree()` — pure, synchronous, allocation-explicit resolver:
  definitions + virtuals + layout + values → `ResolvedPalette` (canonical
  point id, descriptor without `run`/`can` closures, value / enum-from key /
  stash pressed-state, single editor variant id + capabilities, keystrokes,
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
- Hygiene (SSR §4.7–§4.8): the render path never imports `globals.ts`,
  `gap-dwell.ts`, or `umd.ts` (import-graph test reads `render.ts` source);
  determinism (no `Math.random`/`Date.now`, `version: 1` rejection) tested.
- Render-model tests (SSR §6, node, no jsdom): Node-only import (no
  `setTimeout`/`queueMicrotask` during build + resolve), golden snapshot,
  hydration round-trip (server → serialize → client → identical output),
  action isolation (throwing `run` never called, descriptor has no `run`),
  config-pinning, import-graph, codecs.
- Virtuals resolve against a family-point stand-in (`enum` for enum-from,
  `action` for stash) so `resolveEditorVariant` agrees server/client.

### Phase 8 status (context — landed 2026-09-14)

`core/context.ts` + `core/context-display.ts` (+ `context.test.ts`, 16 tests)
implement `plans/context.md` §§1–4 step 6 in core (steps 7–8 are adapter work
for Phase 10; step 9 is this doc update):

- `ValuesBag` — same discipline as the store, plus frozen `get`,
  `(changedKeys[])` global notify, `lock`/`unlock` (→ `PaletteWriteError`).
- `NothingPoint` (`type: 'nothing'`) + `isNothingPoint`; `isValuedPoint` /
  `isActionPoint` return `false` for it. `AnyPoint` is the three-kind union.
- Functional `can(...bags)` on **all** kinds (omitted = enabled);
  `PaletteCore.evaluateCan` + `readActionCan` (now a functional read) +
  `buttonPresenter` (evaluates against `BoundDisplay.bags` unless an explicit
  `can` override is passed). Static `can: boolean` readers switch to
  `evaluateCan` — the wire descriptors strip `can` (rebuilt client-side).
- Registry: `setContext`/`removeContext` (replace-never-append, §1.3),
  `getBag`/`resolveBags` (never throw, missing → `undefined`),
  `subscribeContext` (`(bagName, changedKeys)`), `subscribeCan` (flips only).
  `getBag('')` is the `values` store (root core-owned; context bags
  host-owned). `dispose()` clears context forwards + listeners.
- `context-display.ts` — `dualSourceValue` (selection-wins precedence),
  `boundValueAt`/`boundBagAt`/`readBoundBagKey` (never throw),
  `missingContext` sentinel. No mirroring, no virtual chaining.
- `validateInitialValues` rejects nothing-points (like actions);
  `fromServerDescriptor` round-trips nothing-points; nothing-point bindings
  serialize, values never do.
- Command-box context pass (step 8) is already shaped: entries carry `uses`,
  filter at render; nothing-point commands with `uses: []`/`undefined` are
  always present. The vanilla spike (step 7: dirty-set + rAF + one
  context-bound control) rides the Phase 10 demo work.

### Phase 2 status (landed 2026-09-14)
`configuration.ts`, `gap-dwell.ts`, and the pure track-space math in
`layout.svelte.ts` now live in core (`configuration.ts`, `gap-dwell.ts`,
`layout.ts` additions). Notes:

- `gap-dwell.ts` is **not** a byte-verbatim move: the svelte source calls
  `setTimeout` / `clearTimeout` directly, which do not exist under
  `lib: ["ES2022"]`. Core routes timers through the `globals.ts` escape hatch
  (`scheduleHostTimeout` / `clearHostTimeout`, opaque `unknown` handle) so the
  DOM-free rule stays compiler-enforced. Behaviour (dwell, one-shot latch,
  retarget, reset) is unchanged and covered by `phase2.test.ts` (node).
- `findOwnershipViolations` stays a **core export** (not a test helper):
  adapters and e2e parity checks reuse the single-ownership invariant at
  runtime, so one implementation in core beats a copy in each test dir.
- `insertTrackWithToolbar` was **not** moved: it is a one-line `splice`
  the movement engine (Phase 5) will rebuild against an explicit drag-state
  param. Moving it now would freeze the old slide-engine shape in core.
- `regionDirection` was **not** moved: it maps a region to an adapter
  orientation string (`horizontal` / `vertical`), which is a rendering concern.
  Core's equivalent is `SurfaceContext.axis` (already in `layout.ts`).
- `removePaletteItem` was **not** moved: it couples item removal to a
  border/track prune in svelte `PaletteBorder` / `PaletteTrack` terms. The
  core equivalent is `PaletteLayoutTree.removeItem` (location-based, prunes
  emptied toolbars/tracks the same way).
- `isEditableTarget` was **not** moved: it touches `HTMLElement` /
  `HTMLInputElement` and stays adapter-owned per the DOM-free rule.
- Svelte keeps its own copies until Phase 7 (additive-first rule) — the core
  versions are proven by `phase2.test.ts` (21 node tests) while the svelte
  reference tests stay green untouched.

### Packaging

- Core is **library-only**: no `demo/`, no `index.html`, no `vite.config.ts`, no
  `vite` devDep. Rollup emits esm/cjs (`dist/index.mjs`, `dist/index.cjs`,
  `dist/index.js`).
- `packages/vanilla` is the vanilla-DOM adapter **with** its own vite demo
  (`demo/main.ts` + `index.html`); it declares `external: ['@palettable/core']`
  and a `workspace:*` dep on core.
- Unit tests run in **node** (`vitest.config.ts`, `environment: 'node'`), not
  jsdom — core has no DOM to test against.
