# Testing

## Core unit (Vitest, node) — 328 tests, 16 files

Run: `pnpm --filter @palettable/core test`. Config:
`packages/core/vitest.config.ts` (`environment: 'node'`, alias
`@palettable/core` → `src/index.ts`, `include: ['src/**/*.test.ts']`).

| File | Covers |
| ---- | ------ |
| `src/specs.test.ts` | `parsePointSpec` / `canonicalPointId` (setter/toggle/step forms) + `PointTarget` (`isInlineSpec`, `canonicalSpecId`) |
| `src/keys.test.ts` | `findKeystrokesFor` (canonical-id match) + `findKeystrokesForTarget` (inline targets by own id) + `PaletteError` name |
| `src/points.test.ts` | `isActionPoint` / `isValuedPoint` guards + null-safety |
| `src/store.test.ts` | `PaletteStateStore` hydration, `Object.is` no-op, notify/unsubscribe, throwing-listener isolation, `setTree` batching |
| `src/palette.test.ts` | `initialValues` / `setMany` validation + batching, `ServerPointDescriptor` round-trip + action rebuild by name (+ nothing-point round-trip), `readSetterValue` (strict coercion: blank/∞ boolean-token → throw), `resolveEditablePoint` / `readActionCan` (functional), `uses` contract, `PaletteWriteError` |
| `src/virtual.test.ts` | `assertValidVirtual`, enum option matching, source resolution |
| `src/layout.test.ts` | `defaultLayoutFromPoints`, `validateSerializedLayout` (version/regions/items/inline tools), tree construction/clone, `moveItem`/`moveToolbar` (incl. the `from?`/`to?` op convention + prune cascade), `insertItem`/`removeItem`, subscribe/`subscribeOps`/`clearListeners`, the `DraggingState` veto predicates + drag modes, the track/stack/parking/item-space commits, the pure gap-highlight decisions, the core drag engine (`dragStart` origin resolution + whole-toolbar flag, `dragOver` paint/commit per element kind incl. dark-gap no-move + editing-off dark), inline-virtual snapshot round-trip |
| `src/controls.test.ts` | `familyOfPoint`, `controlChoicesFor` (axis filter, defaults, nothing-point items) |
| `src/core.test.ts` | `PaletteCore` registry, `values` store (raw, virtual-unaware), sync `run` (setters/toggles/steps/virtuals), `canRunStep` (bounds-checked) + `run` clamping at min/max, `resolveTargetVirtual` (registered + inline), `subscribeLayout`, `resetAll`, `dispose` |
| `src/command-box.test.ts` | builders (`paletteCommandEntries` run/catalog incl. toggle + bounds-aware step `can`, `paletteAddItemEntries`, `paletteDerivedVariants`, `paletteEnumSubsetValues`), query model (`tokenizeQuery`/`trimLastToken`/`filterCommandEntries`/`suggestCommandKeywords`/`parseCommandInput`/availability) |
| `src/console.test.ts` | `ConsoleStore` open/close/toggle + add-state + listeners, `consolePointDescriptor` |
| `src/presenters.test.ts` | `axisForRegion`/drawer rules, `resolveControl` fallback chain, button/toggle/status/select/slider view-models, configurator pure parts, enum-from display helper |
| `src/phase2.test.ts` | track-space math, `canonicalItemTool` (incl. inline ids) / `itemFingerprint`, ownership, `configuration` |
| `src/render.test.ts` | Node-only import (no timers), golden render model (byte-identical + JSON round-trip), values/descriptors/controls/keystrokes, virtuals (enum-from key/setter), drawers (recursion + depth bound), version/unknown-point rejection, hydration round-trip, action isolation, config-pinning, import-graph + determinism, value codecs |
| `src/context.test.ts` | `ValuesBag` (frozen get, `setTree` batching, per-key notify, lock → `PaletteWriteError`, `asObject`), `NothingPoint` guards + `initialValues`/`setMany` rejection, core registry (`setContext` replace / `removeContext` / root `getBag('')` / `resolveBags` / `subscribeContext` / `evaluateCan` / `subscribeCan` flips-only / `dispose`), `dualSourceValue` + param-array accessors, `buttonPresenter` functional `can` |

Gotchas:

- Listener-error tests spy on the `scheduleMicrotask` export (see
  `src/globals.ts`), never on `globalThis.queueMicrotask` — spying the
  global leaves a real `queueMicrotask` throw escaping as an uncaught
  exception in the worker.
- `defineVirtual` re-defining the same virtual id is allowed; a new virtual
  colliding with a point id throws `duplicate point id`.

## Vanilla unit (Vitest, jsdom) — 51 tests, 9 files

Run: `pnpm --filter @palettable/vanilla test`. Config:
`packages/vanilla/vitest.config.ts` (jsdom, `include: ['src/**/*.test.ts']`).

| File | Covers |
| ---- | ------ |
| `src/adapter.test.ts` | the minimal `<ul>` renderer (barrel smoke) |
| `src/keys.test.ts` | `normalizeKeystroke` (incl. Plus-key `+` separator collision) / `keystrokeFromEvent` (Shift-consumed symbols, Shift-letter distinct) / `createVanillaKeys` resolution / `isEditableTarget` |
| `src/nodes.test.ts` | `NodeRegistry` identity map (toolbar / item / track / row kinds, delete, clear) |
| `src/highlight.test.ts` | `clearGapClasses` (highlight arrives as per-gap `DragEvent`s) |
| `src/value-sync.test.ts` | the fine-DOM reconciliation contract: per-tool value sync in place (same node: toggle / slider / focused-slider guard), editing chrome without rebuild (`syncEditing`/`applyEditing` — root classes, `inert`, guards, same `.toolbar` identity), `setInspecting` two-node flip, selection patch re-rendering the details panel only, `can` flips toggling `disabled` in place |
| `src/drag.test.ts` | slide measuring + add-item probes: `extractionGrabOffset` (intra-button offset, middle fallbacks) + `itemFromAddSelection` (set/tool/action/item variants, family mismatch → `undefined`); `clampSlideDelta` lives in core (single copy) |

## E2E (Playwright)

Run: `pnpm test:e2e`. `playwright.config.ts` serves the vanilla demo
(vite dev on `:4174`) — plus a `vanilla-smoke` project for the vanilla-only spec.
`test.beforeEach` clears `localStorage` and reloads. The suite is the
**adapter conformance contract**: every adapter (vue, svelte — see
`plans/extraction.md`) must satisfy the same specs — new highlight/commit
behaviour lands with its spec first, core unit anchors second.

- `e2e/smoke.spec.ts` (1): home page renders.
- `e2e/palette.spec.ts` (5): command-box combobox runs commands
  inline + `.palette-ide.editing` chrome; drawer open with axis inversion
  (left drawer → `is-horizontal`) + Escape close; inspector via `pointerdown`
  on the edit-mode `.toolbar-item-guard` (presentation-only configurator,
  selected item highlighted); layout save → reload → restored badge → preset
  load.
- `e2e/console.spec.ts` (9): backtick opens the edit-only console
  (Ide root focused first — the IDE listens on the root `keydown`); Terminal
  button + Escape (+ work-zone `is-dimmed` while open); command-first mode (no
  combobox → console command-first + square edit button); read-only mode;
  edit-inert (toolbar item content `inert` while editing); no mode button when
  a `commandBox` tool is displayed; add flow (entry → variant card → value);
  add-box rows are click-to-select (not draggable); add-box click selects an
  entry.
- `e2e/drag-invariants.spec.ts` (1): movement is stripped — locks
  the static edit-mode layout (no empty toolbars/tracks).
- `e2e/drag-highlight.spec.ts` (1): dragging a tool highlights a
  free item-space DZ — guard `pointerdown` → hover a neighbouring tool →
  `.toolbar-drop-zone.highlighted` appears. Uses the *left* border (the
  centered console panel covers the top toolbar's right-hand tools); hovers
  a tool, never a gap (gaps are zero-size until highlighted — the
  active-item fallback paints the flanking free gaps); steps the pointer in
  small increments (per-position handlers); opens the console via JS click
  (edit-mode guards cover the Terminal button for real clicks).
- `e2e/edge-stay.spec.ts` (2, conformance): a DZ beside a dragged tool is
  never highlighted — ABCD with D dragged keeps TB-gap 4 dark and paints
  track gap 1 after the toolbar; symmetrically, dragging A keeps TB-gap 0
  dark and paints track gap 0 before the toolbar. Shared `dragOntoTool`
  helper (guard `pointerdown` → stepped hover onto the tool itself); asserts
  the exact `data-item-space-index` / `data-track-space-index` so future
  adapters paint the right gap, not just any gap. Core anchors:
  `layout.test.ts` "ABCD with D dragged keeps the gap after D dark" +
  the `abcdFallback` track case.
- `e2e/reorder-forward.spec.ts` (1, conformance): same-toolbar forward moves
  land between, not after — dragging the second tool onto gap 3 reorders to
  `[0, 2, 1, 3]`, never `[0, 2, 3, 1]`. Reads live `data-tool` order via
  `toolOrder`. Core anchor:
  `layout.test.ts` "forward move lands between, not after" (ABCD + backward
  case).
- `e2e/whole-toolbar.spec.ts` (1, conformance): a whole-toolbar drag never
  highlights neighbour track gaps — only the last TB-DZ of the previous TB
  and the first TB-DZ of the next TB (same track). Extracts a singleton via
  guard → leading track gap, then hovers the fresh toolbar: own flanking
  track gaps stay dark while a neighbour TB edge paints. Core
  anchors: `layout.test.ts` "whole-toolbar drag paints neighbour TB edges"
  + "derives the whole-toolbar flag at drag-start".
- `e2e/dark-gap-no-move.spec.ts` (1, conformance): re-organisation happens
  ONLY on a highlighted DZ — hovering dark gap 1 beside dragged tool 0
  leaves the tool order untouched and builds no singleton. Guards the
  paint/commit single-decision rule (vanilla reads the painted
  `highlighted` class; core commits reject dark gaps), so future adapters
  can never move tools under a dark gap.
- `e2e/vanilla.spec.ts` (1, `vanilla-smoke`): vanilla demo first paint
  (heading + IDE chrome + combobox + work-zone).
- `e2e/track-drop.spec.ts` (1, conformance): dragging a tool onto a track
  gap extracts a new toolbar — guard → leading track gap commits a fresh
  singleton and the session promotes to a whole-toolbar slide.
- `e2e/stack-highlight.spec.ts` (1, conformance): dragging a tool over a
  track background highlights the flanking stack gaps (core `dragOver`
  `{ kind: 'track' }` active-track fallback, no commit — the dwell commit
  stays adapter-owned).

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

- Core: `pnpm --filter @palettable/core check` / `build` / `test`.
- Vanilla: `pnpm --filter @palettable/vanilla check` / `test`.
- `npx biome check packages/core packages/vanilla tests/e2e playwright.config.ts` (clean).
- `pnpm test:e2e`.
