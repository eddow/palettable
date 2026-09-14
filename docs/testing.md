# Testing

## Core unit (Vitest, node) — 214 tests, 15 files

Run: `pnpm --filter @palettable/core test`. Config:
`packages/core/vitest.config.ts` (`environment: 'node'`, alias
`@palettable/core` → `src/index.ts`, `include: ['src/**/*.test.ts']`).

| File | Covers |
| ---- | ------ |
| `src/specs.test.ts` | `parsePointSpec` / `canonicalPointId` (setter/action forms) + `PointTarget` (`isInlineSpec`, `canonicalSpecId`) |
| `src/keys.test.ts` | `findKeystrokesFor` (spec-prefix match) + `findKeystrokesForTarget` (inline targets by own id) + `PaletteError` name |
| `src/points.test.ts` | `isActionPoint` / `isValuedPoint` guards + null-safety |
| `src/store.test.ts` | `PaletteStateStore` hydration, `Object.is` no-op, notify/unsubscribe, throwing-listener isolation, `setTree` batching |
| `src/palette.test.ts` | `initialValues` / `setMany` validation + batching, `ServerPointDescriptor` round-trip + action rebuild by name (+ nothing-point round-trip), `readSetterValue` (strict coercion: blank/∞ boolean-token → throw), `resolveEditablePoint` / `readActionCan` (functional), `uses` contract, `PaletteWriteError` |
| `src/virtual.test.ts` | `assertValidVirtual`, enum option matching, `computeStashTransition`, source resolution |
| `src/layout.test.ts` | `defaultLayoutFromPoints`, `validateSerializedLayout` (version/regions/items/inline tools), tree construction/clone, `moveItem`/`moveToolbar`, `insertItem`/`removeItem`, subscribe/`clearListeners`, inline-virtual snapshot round-trip |
| `src/editors.test.ts` | `familyOfPoint`, `editorChoicesFor` (axis filter, defaults, pointless items) |
| `src/core.test.ts` | `PaletteCore` registry, `values` store (raw, virtual-unaware), sync `run` (setters/actions/virtuals/stash), `canRunAction` (bounds-checked), `resolveTargetVirtual` (registered + inline), `subscribeLayout`, `resetAll`, `dispose` |
| `src/command-box.test.ts` | builders (`paletteCommandEntries` run/catalog, `paletteAddItemEntries`, `paletteDerivedVariants`, `paletteEnumSubsetValues`), query model (`tokenizeQuery`/`trimLastToken`/`filterCommandEntries`/`suggestCommandKeywords`/`parseCommandInput`/availability) |
| `src/console.test.ts` | `ConsoleStore` open/close/toggle + add-state + listeners, `consolePointDescriptor` |
| `src/presenters.test.ts` | `axisForRegion`/drawer rules, `resolveEditorVariant` fallback chain, button/toggle/status/select/slider view-models, configurator pure parts, enum-from/stash display helpers |
| `src/phase2.test.ts` | track-space math, `canonicalItemTool` (incl. inline ids) / `itemFingerprint`, ownership, `configuration`, `GapDwell` |
| `src/render.test.ts` | Node-only import (no timers), golden render model (byte-identical + JSON round-trip), values/descriptors/editors/keystrokes, virtuals (enum-from key/setter/stash pressed), drawers (recursion + depth bound), version/unknown-point rejection, hydration round-trip, action isolation, config-pinning, import-graph + determinism, value codecs |
| `src/context.test.ts` | `ValuesBag` (frozen get, `setTree` batching, per-key notify, lock → `PaletteWriteError`, `asObject`), `NothingPoint` guards + `initialValues`/`setMany` rejection, core registry (`setContext` replace / `removeContext` / root `getBag('')` / `resolveBags` / `subscribeContext` / `evaluateCan` / `subscribeCan` flips-only / `dispose`), `dualSourceValue` + param-array accessors, `buttonPresenter` functional `can` |

Gotchas:

- Listener-error tests spy on the `scheduleMicrotask` export (see
  `src/globals.ts`), never on `globalThis.queueMicrotask` — spying the
  global leaves a real `queueMicrotask` throw escaping as an uncaught
  exception in the worker.
- `defineVirtual` re-defining the same virtual id is allowed; a new virtual
  colliding with a point id throws `duplicate point id`.

## Svelte unit (Vitest, jsdom) — 151 tests, 16 files

Run: `pnpm test`. Config: `vitest.config.ts` (`environment: `jsdom`,
`resolve.conditions: ['browser']`, alias `$lib`, setup `tests/setup.ts`).

| File | Count | Covers |
| ---- | ----- | ------ |
| `tests/smoke.test.ts` | 1 | harness sanity |
| `tests/component.test.ts` | 1 | testing-library Svelte mount |
| `tests/palette/keys.test.ts` | 6 | keystroke normalization, event derivation, binding resolution |
| `tests/palette/palette.test.ts` | 17 | tool resolution, setter/action runners, editor resolution, configurator scope, surface axis, `dragend` clearing, multi-setter divergence, hydrated reactivity (`HydratedBordersProbe`) |
| `tests/palette/serialization.test.ts` | 19 | `serialize` / `validate` / `hydrate` round-trips, parking persistence + ownership, instance fingerprints |
| `tests/palette/command-box.test.ts` | 26 | entry builders, model search/filter/score, keyboard, non-runnable `PaletteError` (`CommandBoxEntriesProbe` for reactive entries) |
| `tests/palette/components.test.ts` | 16 | `paletteRoot`, item drag/inspect, `Ide`, `Parking` independent stack (`PaletteRootProbe`, `PaletteItemDragProbe`, `IdeProbe`, `ParkingProbe`, `ParkingEditorStub`) |
| `tests/palette/item-movement.test.ts` | 13 | `resolveItemPlacementTarget` contract |
| `tests/palette/drag-invariants.test.ts` | 12 | mode model + container-scoped identity (border drag never matches parking, parking↔border ownership transfer) |
| `tests/palette/track-gap.test.ts` | 4 | track-gap hover commits, slide disarm on merge |
| `tests/palette/drawer.test.ts` | 6 | factory shape, open/Escape, collapse signal, axis inversion, popup scope, hover travel |
| `tests/palette/editors.test.ts` | 3 | toggle/select editors, `BaseConfigurator` editor-choices |
| `tests/palette/export-split.test.ts` | 2 | core/edition boundary (core lacks mutation, edition re-exports core) |
| `tests/palette/console.test.ts` | 5 | console without `commandBox`: run shows toggle + run box only, edit shows add box + details (tools panel after selection), toggle flips mode, edit add-box results are draggable tools, read-only (`editable: false`) shows no toggle and stays in run mode |

Gotchas:

- Run `svelte-kit sync` before Vitest (generated `.svelte-kit/tsconfig.json` is
  required by the resolver) — `pnpm check` covers this.
- `resolve.conditions: ['browser']` is mandatory, else Svelte resolves to its
  server build and `mount()` throws `lifecycle_function_unavailable`.
- `$state` proxies force `toStrictEqual` over `toBe` for `inspecting.item` and
  the catalogue seed border.
- `paletteCommandBoxModel` / `hydratePaletteLayout` must be created during
  probe init, never in handlers (same init-time constraint as app code).

## E2E (Playwright) — 12 tests, 3 files

Run: `pnpm test:e2e` (builds + previews on port 4173, `reuseExistingServer`
outside CI). `test.beforeEach` clears `localStorage` and reloads.

- `e2e/smoke.spec.ts` (1): home page renders.
- `e2e/palette.spec.ts` (5): command launcher + `.palette-ide.editing` chrome;
  drawer
  open with axis inversion (left drawer → `is-horizontal`) + Escape close;
  inspector via `pointerdown` on `.toolbar-item-guard` (presentation-only
  configurator in the console, selected item highlighted); layout save → reload
  → restored badge → preset load → load; pointer drag reorder (`[commandBox,
  emergencyProtocol, autoOxygen, shieldGenerator, alertLevel]` →
  `[commandBox, emergencyProtocol, shieldGenerator, alertLevel, autoOxygen]`).
- `e2e/console.spec.ts` (8): backtick opens the edit-only console (Ide root
  focused first — `paletteRoot` listens on root `keydown`); Console button +
  Escape (+ work-zone `is-dimmed` while open); command-first mode (no combobox →
  square edit button toggles to edit); read-only mode (no edit button, stays
  command-first); edit-inert (toolbar item content `inert` while editing); no mode
  button when a `commandBox` tool is displayed; add flow (Life Support entry →
  variant card → value in the single details panel); tools-panel rows `draggable`;
  tools-panel drop inserts into first toolbar gap.

E2E lessons (see `docs/architecture.md` §19–§20):

- `paletteItemDrag` inspects on `pointerdown` — dispatch `pointerdown`/`pointerup`
  on the guard, not `click`.
- Trusted Playwright mouse events carry `isPrimary: false` / `buttons: 0` —
  drag tests use synthetic `PointerEvent`s with explicit `pointerId`/`isPrimary`.
- Gaps are zero-width until proximity chrome expands them — target the gap edge
  (`rect.left`), never a `+2px` nudge.
- `new DragEvent(..., { dataTransfer })` rejects non-native transfers — fire
  plain `Event`s with a shadowed `dataTransfer` stub.

## Gates

`pnpm check` (0 errors) · `pnpm lint` (clean) · `pnpm test` (113 pass) ·
`pnpm test:e2e` (12 pass) · `pnpm build` ok.
