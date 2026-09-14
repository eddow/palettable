# Mitosis — split `svelte` into `core` + `vanilla` + `svelte`

> Status: **active plan — Phases 2–7 remaining.** `packages/core` (headless,
> DOM-free) and `packages/vanilla` (vanilla-DOM adapter + demo) exist and are
> green; `packages/svelte` is still self-contained and does **not** import core
> yet. Order: build `core`+`vanilla` → reach demo parity → only then make
> `svelte` depend on `core` (see **Evolution strategy** below). Permanent
> decisions for what has landed live in `docs/architecture.md §21`; this file
> tracks only what is left.

## Evolution strategy (the order is the point)

The migration is deliberately **additive first, subtractive last**. `packages/svelte`
is the working reference implementation and stays **untouched** until the new
stack is proven. Three stages, in this order:

1. **Build `core` + `vanilla` without touching `svelte`.**
   Every capability is implemented fresh in `core` (headless) and `vanilla`
   (DOM adapter). `svelte` keeps working exactly as it does today — it is the
   oracle we compare against, so it must not move while we build.
2. **Reach demo parity — the vanilla demo must be the *same demo* as the svelte one.**
   This is the acceptance criterion for stage 1, not a nice-to-have. The
   `packages/vanilla` demo must reproduce the svelte demo (the Stellar Outpost
   page: `packages/svelte/src/routes/+page.svelte` + `src/demo/palette.svelte.ts`)
   feature-for-feature — same points, same layout, same editors, same console,
   same drag behaviour.
   **Why:** `tests/e2e/` is the shared conformance suite and it will attack
   **all** demos. Today it drives one server (`playwright.config.ts` →
   `svelte build && preview` on `:4173`, specs `page.goto('/')`). The target is
   one project per demo, all running the same specs. A demo that is merely
   "similar" is worthless there — the specs assert concrete DOM, so parity must
   be exact. Passing the same e2e suite against both demos is what proves `core`
   is a faithful extraction rather than a plausible rewrite.
3. **Only then rewrite `svelte` to depend on `core`.**
   With parity proven, `svelte` becomes a thin adapter: delete its duplicated
   implementation and re-export / delegate to `core` (Phases 3–7). Any
   behavioural difference that surfaces at this point is a `core` bug, not a
   reason to keep the old code.

Consequences for how work is sequenced:

- Phases 2–5 are **additive**: they add to `core`/`vanilla` and leave `svelte`
  alone. Nothing in `packages/svelte/src` is edited until Phase 7.
- The vanilla demo is built up **alongside** the core phases, not after them —
  each capability that lands in `core` should show up in the vanilla demo so
  parity is tracked continuously rather than assessed at the end.
- `svelte`'s existing tests stay green throughout stages 1–2 (they are the
  regression net for the reference implementation).
- Phase 7 is the only phase allowed to delete svelte code, and it is gated on
  the e2e suite passing against **both** demos.

## Target ownership

- **`packages/core` (vanilla TS, rolled-up cjs/mjs, zero `svelte` imports,
  zero runes, zero `.svelte`, **zero DOM** (compiler-enforced, see
  `docs/architecture.md §21`), **no demo**, no `vite`):**
  basic typing, toolbar-movement management, command-box builders, console
  state machine, presenters (pure view-models), main CSS + default head
  theme CSS (dark/light).
- **`packages/vanilla` (vanilla-DOM adapter + demo):**
  imports `core` only (never the reverse); owns plain-DOM rendering
  (`VanillaAdapter`: `mount`/`dispose`, value + layout subscriptions),
  pointer math / drag sessions / head components (as they land), and the
  vite demo (`demo/main.ts` + `index.html`). Rolled-up cjs/mjs/umd
  (`external: ['@palettable/core']`), vitest `jsdom`.
- **`packages/svelte` (Svelte adapter + head + demo):**
  imports `core` only (never the reverse); owns `.svelte.ts` reactive
  wrappers (`$state`/`$derived`/`$effect`), Svelte actions, layout/head
  components, demo. Head components render presenter view-models and use
  `core/theme` CSS.

```
packages/core/src/              # landed 2026-09-14 — see docs/architecture.md §21
  index.ts          # barrel — re-exports every module below
  identifiers.ts    # IconToken/Keystroke/Unsubscribe/listener types
  type.ts           # EnumOption/DefaultTypeMap/TypeMap/constraints
  points.ts         # PointBase/ActionPoint/ValuedPoint/…/isActionPoint/isValuedPoint
  specs.ts          # PointSpec/parsePointSpec/canonicalPointId
  store.ts          # PaletteStateStore (Map storage, Object.is no-op set)
  layout.ts         # layout data types + PaletteLayoutTree + defaultLayoutFromPoints
  editors.ts        # PointFamily/EditorCapability/EditorChoice/familyOfPoint
  keys.ts           # KeyBindings/findKeystrokesFor (headless lookup only)
  virtual.ts        # enum-from / stash derived points
  errors.ts         # PaletteError
  globals.ts        # scheduleMicrotask — the only host global
  core.ts           # PaletteCore (registry + store + layout + virtuals)
  *.test.ts         # 104 node tests across 8 files
  # target additions (Phases 2–6):
  # configuration.ts, gap-dwell.ts, palette.ts,
  # command-box.ts, console.ts, presenters.ts,
  # styles/palette.css, theme/head-default.css
packages/vanilla/src/           # landed 2026-09-14 (library + demo)
  index.ts          # barrel: `export * from './adapter.js'`
  adapter.ts        # VanillaAdapter (owns PaletteCore, <ul> render, mount/dispose)
  adapter.test.ts   # jsdom smoke: one row per point
packages/vanilla/demo/main.ts + packages/vanilla/index.html  # vite demo (barrel-only proof)
packages/svelte/src/lib/
  palette/          # thin adapter: re-export core, $state wrappers, actions, components/
  head/             # presentation only, uses core types + core/theme CSS
```

## Per-module disposition (today → target)

| Today (`svelte/src/lib/…`) | Size | Target |
| --- | --- | --- |
| `palette/types.ts` (imports `Component`, `SvelteHTMLElements`) | 980 | **Done** — split into `core/` modules (`identifiers`, `type`, `points`, `specs`, `store`, `layout`, `editors`, `keys`, `errors`, `core`); see `docs/architecture.md §21` |
| `palette/configuration.ts` (already plain) | 48 | Phase 2, verbatim → `core/configuration.ts` |
| `palette/keys.ts` (already pure) | 116 | Phase 2: **not** verbatim — core keeps only the headless lookup (`KeyBindings`, `findKeystrokesFor`); `normalizePaletteKeystroke` / `paletteKeystrokeFromEvent` / `createPaletteKeys` stay in the adapter (they touch `KeyboardEvent`) |
| `palette/drag-session.ts` (DOM-only, no svelte) | 120 | **Stays in the adapter** — DOM-free core rule (see Phase 2 decision) |
| `palette/gap-dwell.ts` (plain class + `setTimeout`) | 110 | Phase 2, verbatim → `core/gap-dwell.ts` |
| `palette/layout.svelte.ts` (pure math + `$effect` actions + slide engine) | 1536 | Phase 2: pure math (`clampUnit`, `actualTrackSpaceAt(s)`, `insert/remove/resizeToolbar`, `removeEmptyTrack`, `removeParkedToolbar`, `canonicalItemTool`, `itemFingerprint`, ownership) → `core/layout.ts`; Phase 5: commit fns (`commitDraggedTo*`, `insertTrackWithToolbar`, drag actions) rebuilt in core against explicit state param (movement was stripped for restart — do NOT port the old slide engine, rebuild on the pure primitives) |
| `palette/palette.svelte.ts` (`Palette` class + `$state palettes` + hydrate/serialize) | 1261 | Phase 3: `core/palette.ts` — `PaletteError`, `valueActions`, `valueReader`, spec resolution, serialization/hydration, `Palette` with injected store (no `$state`); svelte keeps `$state palettes` mirror |
| `palette/command-box.svelte.ts` (pure builders + `$state`/`$derived` model) | 1366 | Phase 4: builders (`paletteCommandEntries`, `paletteAddItemEntries`, `paletteDerivedVariants`, `paletteEnumSubsetValues`, catalogue payload) → `core/command-box.ts` pure; model becomes vanilla query→results fn, svelte wraps with `$derived` |
| `palette/console.svelte.ts` (`$state consoleState` + open/toggle/add-state) | 101 | Phase 4: `core/console.ts` vanilla state machine + listener set; svelte wraps with `$state` |
| `palette/presenters.svelte.ts` (pure fns over `PaletteEditorContext`) | 466 | Phase 5: `core/presenters.ts` verbatim logic, generic component type; svelte re-exports typed with `Component` |
| `palette/drawer-editor.svelte.ts` (`$state` collapse + `mount(DrawerPopup)`) | 102 | Stays svelte (portal is adapter-owned); collapse signal contract mirrored from core if needed |
| `palette/core.svelte.ts` / `edition.svelte.ts` barrels | 170/90 | Become `core/index.ts` + svelte thin re-export barrels |
| `palette/components/*.svelte` (Ide, Toolbar*, Parking, PaletteItem, Drawer*) | 7 files | Stay svelte; delegate movement to core engine via behaviour fns (no local layout math) |
| `palette/styles/palette.css` (layout + edit chrome) | — | Phase 6: move to `core/styles/palette.css`, svelte imports from `@palettable/core` (or app imports core CSS directly) |
| `head/styles/head-default.css` (dark base + `.palette-default-theme-light`) | — | Phase 6: move to `core/theme/head-default.css` (dark/light tokens stay in sync per `docs/theming.md`); svelte head uses `core/theme` |
| `head/registry.ts`, `head/editors/*.svelte`, `head/Console.svelte`, `head/Icon.svelte` | 10+ files | Stay svelte (the default head); bind core presenters only |
| `head/icons.svelte.ts` (`$state icons.factory`) | — | Stays svelte; core takes an injected `resolveIcon?: (name: string) => unknown` instead of importing the factory |

## Phase 2 — pure movers (zero-risk, verbatim)

> **Additive only** — nothing in `packages/svelte/src` is edited in Phases 2–5.
> `svelte` stays the working reference until Phase 7.

- [ ] `configuration.ts`, `gap-dwell.ts` → `core/` verbatim (they already avoid
      svelte/runes). Svelte re-exports from core.
      DECIDED (2026-09-14, recorded in `docs/architecture.md §21`): core stays
      **strictly DOM-free**, compiler-enforced via `lib: ["ES2022"]` (no `DOM`).
      Therefore `drag-session.ts` (`HTMLElement`, pointer events) does **not**
      move into core — drag sessions live in the adapters; core exposes only
      structural commits. `keys.ts` is likewise **not** a verbatim move: core
      keeps the headless lookup, the adapter keeps `KeyboardEvent` normalization.
- [ ] Pure layout math from `layout.svelte.ts` → `core/layout.ts`:
      `clampUnit`, `actualTrackSpaceAt(s)`, `applyTrackSpaces`, `insertToolbar`,
      `removeToolbar`, `removeEmptyTrack`, `removeParkedToolbar`, `resizeToolbar`,
      `canonicalItemTool`, `itemFingerprint`, `stableStringify`,
      `findOwnershipViolations` (or move to test helper per `plans/simplify.md`).
- [ ] Each move: copy file, cut svelte-only imports (`Action`, `$effect`,
      `startPaletteDragSession` stays — it is DOM-only), keep pure signatures.
- [ ] Verify per move: core `check` + `build`, svelte `check` + `vitest run`
      (move tests with the code: pure layout tests run in core/node, component
      tests stay in svelte).

## Phase 3 — `Palette` runtime (de-rune)

> NOTE: `PaletteCore` + `PaletteStateStore` + `PaletteLayoutTree` already live
> in `core/src/` as `core.ts` (+ `layout.ts` for the tree, `store.ts` for the
> store). This phase now means: move the remaining svelte runtime bits below.

- [ ] Move `valueActions`, `valueReader`, `resolveEditableTool`,
      `paletteTool*` helpers, `serializePaletteLayout` / `validatePaletteLayout` /
      `hydratePaletteLayout` (return plain objects; svelte wraps with `$state` at
      the call site — see `palette.svelte.ts:1245` `$state(plain)` pattern).
- [ ] `Palette` class: keep config/tools/keys/editors resolution verbatim;
      replace `get editing()` `$state` read with injected store predicate
      (`store.editing === this`); keep `dispose()` no-op for parity.
- [ ] Svelte keeps `palettes = $state(…)` as the reactive mirror of the core store.

## Phase 4 — command-box + console (headless model)

- [ ] Pure builders → `core/command-box.ts`: `paletteCommandEntries`,
      `paletteAddItemEntries`, `paletteDerivedVariants`, `paletteEnumSubsetValues`,
      catalogue `serialize/parseCatalogDragPayload` (or delete per
      `plans/simplify.md` if still caller-less), tokenize/filter/rank fns.
- [ ] Model: extract the `$derived.by` chains (`availableCategories`,
      `parsedInput`, `resultsValue`, `suggestionsValue`) into vanilla
      `(entries, query) => results` functions; svelte `paletteCommandBoxModel`
      becomes a thin `$state`/`$derived` wrapper.
- [ ] `console.svelte.ts` → `core/console.ts`: `ConsoleState`, open/close/toggle,
      `resetConsoleAddState`, `consoleTool` (returns a run point; no svelte import).

## Phase 5 — presenters + movement commits

- [ ] `presenters.svelte.ts` → `core/presenters.ts`: `button/toggle/select/slider/
      commandBox/status/configurator` presenters verbatim, generic component type.
      Heads stay dumb (no `tool.value = …` in `.svelte`, per `docs/architecture.md §5`).
- [ ] Movement commits (`commitDraggedToTrackSpace/ItemSpace/StackSpace/Parking…`,
      `insertTrackWithToolbar`, `moveToolbarToTrack/Stack`) rebuilt in
      `core/layout.ts` on the Phase-2 primitives against an explicit drag-state
      param (no module `$state` reads). Svelte actions/components call them.
- [ ] `drawer-editor`: keep portal in svelte; move only the perpendicular-direction
      + open-mode/placement derivation if reusable.

## Phase 6 — CSS + theme to core

- [ ] Move `palette/styles/palette.css` → `core/styles/palette.css` (layout +
      edit chrome + drawer shell, global selectors unchanged).
- [ ] Move `head/styles/head-default.css` → `core/theme/head-default.css`
      (dark base + light override stay in sync; see `docs/theming.md`).
- [ ] Svelte/app import CSS from `@palettable/core` (`core/styles`, `core/theme`);
      no runtime injection, no per-instance scoping (unchanged rule).

## Phase 6b — vanilla demo parity (gate for Phase 7)

> This is the acceptance criterion for stages 1–2 of the evolution strategy:
> the vanilla demo must be the **same demo** as the svelte one, because
> `tests/e2e/` will attack all demos with the same specs.

- [ ] Port the svelte demo to `packages/vanilla/demo/` feature-for-feature:
      same points, same initial layout, same editors, same console, same drag
      behaviour. Reference: `packages/svelte/src/routes/+page.svelte` (430) +
      `packages/svelte/src/demo/palette.svelte.ts` (563).
- [ ] Reproduce the same DOM contract the e2e specs assert (headings, console
      overlay, toolbar/parking structure, drag targets) — the specs query
      concrete selectors, so "similar" is not enough.
- [ ] Extend `playwright.config.ts` to one project per demo (svelte on `:4173`,
      vanilla on its own port) and run the **same** `tests/e2e/*.spec.ts`
      against both.
- [ ] Gate: `tests/e2e/` green against **both** demos. Only then may Phase 7
      delete svelte code.

## Phase 7 — thin the adapter, close out

> **Only phase allowed to edit `packages/svelte/src`.** Gated on Phase 6b:
> with parity proven, `svelte` becomes a thin adapter over `core`. Any
> behavioural difference that surfaces here is a `core` bug — fix `core`, do
> not keep the old implementation.

- [ ] `svelte` barrels re-export core (`core.svelte.ts` → read-only,
      `edition.svelte.ts` → mutation surface); no logic duplicated.
- [ ] Components delegate: `Ide`/`Toolbar*`/`Parking`/`PaletteItem` contain
      markup + behaviour wiring only; all spacing/commit/dwell math imported
      from core.
- [ ] Test split: pure tests (`keys`, track math, builders, serialization,
      dwell) live in `core/src/**/*.test.ts` (node); component/drag-invariant
      tests stay in `svelte/tests`. E2E unchanged.
- [ ] Docs per repo rule (`AGENTS.md`): remove completed items here, migrate
      permanent contracts to `docs/architecture.md` (+ `theming.md`,
      `layout-and-drag.md`, `core-concepts.md` as touched).
- [ ] Done = `tests/e2e/` green against **both** demos (Phase 6b gate),
      `pnpm --filter @palettable/core check/build/test` green,
      `pnpm --filter @palettable/vanilla check/build/test` green,
      `pnpm --filter @palettable/svelte check/test` green, `biome check` clean,
      no `svelte` import in `packages/core/src`, no `HTMLElement`/`document`
      in `packages/core/src` (compiler-enforced — see `docs/architecture.md §21`),
      no demo/vite in `packages/core`, no layout math left in
      `packages/svelte/src/lib` outside behaviour wrappers.

## Non-goals / guardrails

- **Order is not negotiable**: additive first (`core` + `vanilla`), parity
  second (same demo, same e2e suite), subtractive last (`svelte` depends on
  `core`). Do not start Phase 7 before Phase 6b is green.
- **`packages/svelte/src` is frozen during Phases 2–6b.** It is the reference
  implementation and the oracle for parity; editing it early destroys the
  comparison.
- No new movement behaviour in this plan — the engine restart builds on core
  primitives (`plans/movement.md` stays the behaviour spec).
- No `*Model` / variant-factory layer (out of scope per `docs/architecture.md §5`).
- No `Snippet` in icon tokens (no runtime discriminator — wrap in a component).
- Keep `AGENTS.md` recipes: scratch work in `sandbox/`, read-only `git`.
- Core stays DOM-free and demo-free; every demo and every `HTMLElement`/
  `document` usage lives in `packages/vanilla` or `packages/svelte`.
