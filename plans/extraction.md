# Extraction — one headless core, several adapters

> Status: **active plan — Phases 2–10 landed; remaining in execution order:
> Phase 11 (vue adapter + demo) → Phase 12 (svelte adapter from scratch).**
> `packages/core` (headless, DOM-free) and `packages/vanilla` (DOM adapter +
> reference demo) exist and are green. Permanent decisions for what has landed
> live in `docs/architecture.md §21`; this file tracks only what is left.
>
> SSR companion: `plans/ssr.md` (normative spec) constrains — but does not
> reorder — the phases below: every phase keeps the core SSR-safe (§SSR), and
> Phase 7 implements the render model on top of Phases 3–5.
>
> Context companion: `plans/context.md` (normative spec) constrains — but does
> not reorder — the phases below: points/store/core stay extension-ready for
> bags (§Context), and Phase 8 implements `ValuesBag` + `uses` +
> nothing-points + functional `can` on top of Phases 3–5 + 7.

## Evolution strategy (the order is the point)

The work is **additive**: `core` grows with zero rendering knowledge, adapters
are built against `core`, and nothing is deleted until the new surface is
proven.

1. **`core` stays headless and DOM-free.** Compiler-enforced: `tsconfig.json`
   sets `lib: ["ES2022"]` (no `DOM`), so any `document`/`HTMLElement`/
   `KeyboardEvent` reference fails `tsc` (see `docs/architecture.md §21`).
   Adapters import core; core never imports an adapter.
2. **One demo defines conformance.** `packages/vanilla/demo/` is the Stellar
   Outpost demo. `tests/e2e/` is the **conformance suite** and it attacks every
   demo with the same specs. A demo that is merely "similar" is worthless there
   — the specs assert concrete DOM, so parity must be exact. Passing the same
   e2e suite against every demo is what proves `core` is a faithful extraction
   rather than a plausible rewrite.
3. **An adapter is proven by a second, unrelated reactive model.** Before the
   adapter surface is considered stable, `core` must be driven by a reactive
   framework whose model is nothing like plain-DOM imperatives — hence vue
   (Phase 11) before svelte (Phase 12).
4. **Adapters are created, not ported from each other.** No adapter is an oracle
   for another. A behavioural difference found while writing one is a `core`
   bug — fix `core`, not the adapter.

Consequences for sequencing:

- Phases 7–12 are **additive**: they add `core`/`vanilla`/`vue`/`svelte` code.
- The vanilla demo is built up **alongside** the core phases, not after them —
  each capability that lands in `core` shows up in the demo, so conformance is
  tracked continuously rather than assessed at the end. The vue demo follows
  the same rule once `packages/vue` is scaffolded (Phase 11); so does the
  svelte one (Phase 12).
- SSR and context never reorder the phases (`plans/ssr.md` §4–§7 map onto
  Phases 3–5 + 7; `plans/context.md` §§1–4 map onto Phase 8). Each phase keeps
  the core import-safe under plain Node (no `document`, no timers firing, no
  `run()` reachable from the render path) and extension-ready for bags.

## Target ownership

- **`packages/core`** (vanilla TS, rolled-up cjs/mjs, **zero DOM**
  (compiler-enforced), no runes, no components, **no demo**, no `vite`):
  typing, layout data + tree, movement commits/vetoes/gap decisions,
  command-box builders, console state machine, presenters (pure view-models),
  SSR render model, context layer, `styles/palette.css` +
  `styles/head-default.css`.
- **`packages/vanilla`** (plain-DOM adapter + demo): imports `core` only; owns
  DOM rendering (`createIDE`, `render*` head functions), pointer math, drag
  sessions, rAF sliding, the `NodeRegistry`, and the vite demo
  (`demo/main.ts` + `index.html`). Rolled-up cjs/mjs, vitest `jsdom`.
- **`packages/vue`** (Vue adapter + demo — Phase 11): imports `core` only; owns
  Vue reactive wrappers (`ref`/`computed`/`watch`), directives, layout/head
  rendering, demo.
- **`packages/svelte`** (Svelte adapter + demo — Phase 12): imports `core`
  only; owns `.svelte.ts` reactive wrappers (`$state`/`$derived`/`$effect`),
  Svelte actions, layout/head components, demo. **Created from scratch.**

Adapter anatomy (what every adapter owns, in its own idiom):

```
packages/<adapter>/src/
  index.ts        # barrel
  keys.ts         # KeyboardEvent -> normalized keystroke (core owns lookup only)
  heads/*         # one renderer per control id, bound to core presenters
  layout/*        # Ide/borders/tracks/toolbars/parking/Drawer rendering
  drag/*          # pointer sessions, hit-testing, slide math (DOM-only)
  strings.ts      # adapter-side chrome strings (core owns catalog strings)   [vanilla only, so far]
packages/<adapter>/demo/       # the Stellar Outpost demo, ported feature-for-feature
```

## Execution order (remaining work)

Phases 2–10 are landed. What is left runs in this order:

1. **Phase 11** (vue adapter + demo) — proves the core under a second,
   unrelated reactive model.
2. **Phase 12** (svelte adapter from scratch) — the third adapter, written
   fresh against `core`.

## Phase 2 — pure movers (landed 2026-09-14)

- [x] `configuration` magic numbers, `gap-dwell` state machine, and the pure
      layout math (`clampUnit`, `actualTrackSpaceAt`, `insert/remove/
      resizeToolbar`, `removeEmptyTrack`, `removeParkedToolbar`,
      `canonicalItemPoint`, `itemFingerprint`, `findOwnershipViolations`) moved
      into `core/`. Timers route through `globals.ts`
      (`scheduleHostTimeout`/`clearHostTimeout`, opaque `unknown` handle)
      because `lib: ["ES2022"]` has no DOM timers.
- [x] Deliberately **not** in core: pointer/drag sessions (`HTMLElement`),
      `isEditableTarget`, region-direction strings (core's equivalent is
      `SurfaceContext.axis`), border/track-specific removal helpers (core's
      equivalent is `PaletteLayoutTree.removeItem`), commit functions +
      drag actions (Phase 5, rebuilt on the pure primitives). `keys.ts` split:
      core keeps the headless lookup, adapters own `KeyboardEvent`
      normalization.
- [x] Verified: core `check` + `build` + `test` green; `biome check` clean.
- [x] **Point-spec union**: a spec is `PointTarget` (`string | VirtualPoint`) —
      a string reference *or* an inline virtual definition carried directly in
      the item's `point` field. Landed in `specs.ts` (`PointTarget`,
      `isInlineSpec`, `canonicalSpecId`), `layout.ts` (clone/serialize
      deep-copy inline definitions via `globals.cloneValue`), `keys.ts`
      (`findKeystrokesForTarget`), `core.ts` (`resolveTargetVirtual`:
      registered-by-id or inline-validated).

## Phase 3 — `Palette` runtime (headless) + SSR hydration inputs

> `PaletteCore` + `PaletteStateStore` + `PaletteLayoutTree` live in
> `core/src/`. This phase landed the remaining runtime bits below.

- [x] `valueActions` (number `inc`/`dec` with `step`) and its bounds-checked
      `can`; `valueReader` as `palette.ts:readSetterValue` — **the single
      coercion path**; `resolveEditableTool` as `core.ts:resolveEditablePoint`.
      Deliberate divergence: an unrecognized boolean token (`"maybe"`) throws
      instead of silently coercing to `false`.
- [x] Serialization/hydration: `getSnapshot` / `setLayout` /
      `fromSerializedLayout` (flat slot list, each slot in its own track,
      deep-clone, inline definitions verbatim) + `validateSerializedLayout`
      (version/regions/items/inline-point/config/drawer checks, never throws).
- [x] **No duplicated value surface**: `PaletteCore` does not re-implement
      get/set/events. The store is exposed as `PaletteCore.values`
      (`PaletteStateStore`); adapters read/write/subscribe there directly. Only
      what the raw store cannot do stays on core: virtual resolution, command
      execution (`run`/`runStash`/`canRunAction`), stash aside slots, validated
      batch hydration (`setMany`/`initialValues`), `resetAll`.
      `run()` is **synchronous** — `PaletteError`s are thrown, not rejected.
- [x] Context readiness (no bags yet, just don't block Phase 8):
      `PointBase.uses`, `PaletteStateStore.setTree` (all writes land before any
      listener runs, one notify with the changed-key array),
      `PaletteWriteError`. `ActionPoint.can` stayed static this phase;
      `canRunAction` (named-action bounds check) is kept **distinct** from the
      Phase 8 point-level `evaluateCan`.
- [x] SSR inputs: `initialValues` on `PaletteCoreOptions` (validated per point,
      zero listener notifications during construction) + `setMany` for client
      hydration; `ServerPointDescriptor` + `to/fromServerDescriptor` (+
      round-trip validation); `validateSerializedLayout`.
- [x] **Action-point rebuild contract** (key-shortcuts need this, not just
      SSR): action points serialize **by name** — the descriptor carries the
      id + metadata, never `run`; the client rebinds via the
      `runners: Record<actionId, run>` argument. Derived actions have two
      serializable forms: a virtual registered under its `id`
      (name-addressable, rebuilt from serialized config + the points list), or
      an **inline** definition carried in the spec. No closure crosses the wire
      in either form. Unknown action id in `runners`, or a binding whose
      canonical id resolves to neither a point nor a virtual → throw at build
      time. Stash aside slots stay excluded from the snapshot (rendering a
      stash button needs only current-vs-stashed pressed state).

## Phase 4 — command-box + console (headless model)

- [x] Builders moved to `core/command-box.ts` as headless ports over
      `readonly AnyPoint[]` + `CommandBoxContext`: entries carry `run` **spec
      strings** (adapters execute via `PaletteCore.run`), never closures.
      Catalogue drag payloads deleted (dead code — rows are click-to-select);
      per-value enum commands deleted (a catalog enum is one row). Covered in
      `command-box.test.ts`.
- [x] Query model extracted from reactive derivations into plain
      `(entries, query) => results` functions: `filterCommandEntries`,
      `suggestCommandKeywords`, `parseCommandInput`,
      `availableEntryCategories`/`availableEntryKeywords`,
      `tokenizeQuery`/`trimLastToken`.
- [x] `core/console.ts`: `ConsoleStore` (plain state + listener set) +
      `consolePointDescriptor` (run-point descriptor; the adapter binds `run`
      to the store toggle). Covered in `console.test.ts`.
- [x] Context readiness: `CommandBoxEntry.uses` (filter at render, never
      build-time precompile).
- [x] SSR: builders are pure over descriptors — no closures on the render path.
      The box shell is SSR as markup; the entry list is client-only.

## Phase 5 — presenters + movement commits + variant resolution

- [x] `core/presenters.ts`: `buttonPresenter`/`togglePresenter`/
      `selectPresenter`/`sliderPresenter`/`statusPresenter`/`configuratorModel`
      + patches/cleanup, over plain data (definition + value + config +
      surface). Mutation routes through spec strings / `values.set` — never
      live tool writes. Not ported: the reactive command-box model (core has no
      reactivity), `configuratorPresenter.remove()` (needs live
      toolbar/track/border identity), demo-specific enum-subset display
      filtering. Covered in `presenters.test.ts`.
- [x] `resolveControl()` (single id) alongside `controlChoicesFor()` (config
      surface list). Fallback chain: explicit item `control` → family default →
      first eligible → compact fallback for an ineligible explicit →
      `undefined`.
- [x] `axisForRegion()` + the drawer perpendicular-axis rule in core
      (`drawerChildAxis`/`drawerChildRegion`) — server/client must agree on
      variant eligibility.
- [x] Movement commits (`commitDraggedToTrackSpace`/`ItemSpace`/`StackSpace`/
      `Parking…`, `insertTrackWithToolbar`, `moveToolbarToTrack`/`Stack`)
      rebuilt on the Phase-2 primitives against an explicit drag-state param
      (no module-level reactive reads). Commits stay client-only.
- [x] Drawer: perpendicular rule in core; portal + open-mode/placement stay
      adapter-owned.
- [x] Context readiness: presenters take the `BoundDisplay` shape carrying
      `point` + `value` + optional `bags`.

## Phase 6 — CSS + theme to core

- [x] `core/styles/palette.css` — layout + edit chrome + drawer shell, global
      selectors unchanged.
- [x] `core/styles/head-default.css` — dark base + light override (stay in sync
      with `head-dark.css` / `head-light.css` per `docs/theming.md`).
- [x] Apps import the CSS from `@palettable/core` (`./styles/*`, exported and
      shipped in `files`); no runtime injection, no per-instance scoping
      (`packages/vanilla/demo/main.ts` imports all four stylesheets).
- [x] SSR-neutral: no runtime injection to port; server HTML must reference the
      same global selectors — no per-instance scoping on the server either.

## Phase 7 — SSR render model (landed 2026-09-14)

> Implemented `plans/ssr.md` §4.3–§4.8 on the Phases 3–5 surface. See
> `docs/architecture.md` §"Phase 7 status" (`core/render.ts`:
> `resolveRenderTree` + `snapshotPalette` + `ValueCodec` registry).

- [x] `resolveRenderTree()` pure resolver + `snapshotPalette()` atomic snapshot.
- [x] Configuration pinning (per-request; ignores later singleton mutations).
- [x] `ValueCodec` registry for custom types (SSR-unsafe-by-default, loud
      failure).
- [x] UMD/server-bundle hygiene (SSR uses `dist/index.mjs` / `dist/index.cjs`,
      never UMD); build-time guard still open.
- [x] Host-timers policy lock-in — import-graph test: the render path imports
      neither `globals.ts` nor `gap-dwell.ts`.
- [x] Determinism tests; render-model tests (core, node, no jsdom).
- [x] Context readiness: `RenderInput` carries optional `bags`, threaded
      through.

## Phase 8 — context-sensitive tools (landed 2026-09-14)

> Implemented `plans/context.md` §§1–4 step 6. See `docs/architecture.md`
> §"Phase 8 status" (`core/context.ts` + `core/context-display.ts`).

- [x] `core/context.ts` — `ValuesBag` (frozen `get`, `set`/`setTree`
      one-notify, `asObject`, per-key + global subscribe, `lock`/`unlock` →
      `PaletteWriteError`).
- [x] `points.ts` — `NothingPoint` + `isNothingPoint` + functional `can` on all
      kinds (omitted = enabled).
- [x] Bags wired into `PaletteCore` — registry (`setContext`/`removeContext`
      replace-never-append, root name throws), `getBag`/`resolveBags`,
      `evaluateCan`, `subscribeContext`, `subscribeCan` (flips only),
      `subscribeDefinitions`, `dispose`.
- [x] `core/context-display.ts` — pure `(boundValues, boundBags)` resolvers,
      `dualSourceValue` (selection-wins), `boundValueAt`/`boundBagAt`/
      `readBoundBagKey` (never throw), `missingContext` sentinel.
- [x] Adapter spike (vanilla) — landed with the Phase 10 demo work:
      `vanilla/src/ide.ts` + `head.ts` subscribe to values/layout/console and
      re-render (`syncStructure`/`diffBorder`/`updateToolNode` — no dirty-set
      or rAF batching for value updates; the demo scale doesn't need it).
- [x] Command-box context pass — entries carry `uses`, filtered at render.
- [x] `uses` contract documented in `docs/core-concepts.md`.

## Phase 9 — optimization pass (landed 2026-09-14)

> Internal cleanup — no API-surface changes, no new modules. See
> `docs/architecture.md` §"Phase 9 status".

- [x] Stale JSDoc fixed (`readActionCan` functional-`can` read; "Phase N"
      markers refreshed).
- [x] Dead code removed: `PaletteStateStore.update` / `getOr`,
      `snapshotPalette`'s unread `points?`, `context-display-types.ts` folded,
      `liveToSnapshot`/`liveItemToSerialized` replaced by canonical
      `snapshotLayout`, `PaletteCore.bagForwards` dropped.
- [x] `resolveRenderTree` now applies the pinned `trackGapMinGrow` floor to slot
      `space`; `points`/`virtualPoints` getters cache (invalidated on
      virtual add/remove).
- [x] Listener `[...set]` snapshot iteration kept deliberately (safe
      unsubscribe-during-notify).

## Phase 10 — reference demo, first conformance gate (landed 2026-09-14)

> Acceptance: the vanilla demo renders the Stellar Outpost demo and satisfies
> `tests/e2e/`, the conformance suite every adapter must pass. See
> `docs/architecture.md` §"Phase 10 status".
>
> SSR note: demos are client-rendered; SSR coverage comes from the Phase 7
> render-model tests (core, node). Context note: the demo was root-bag only at
> this gate; context coverage came from the Phase 8 core tests. Phase 10 was
> not gated on either.

Active demo work on top of this gate lives in `plans/clarifications.md` — the
demo has since gone well past parity (fleet `ship` context + `mission` bag,
i18n, axis-aware items, slider variants, custom selectbox, drawer close/flip).

Idea on interface (landed): `createIDE` takes a container element + options,
adds the IDE classes, wraps the container's existing children in the work-zone
div, and renders the tool stacks around it — `createIDE(container, options)`
(`vanilla/src/ide.ts`).

- [x] Build the vanilla demo: same points, same initial layout, same controls,
      same console, same drag behaviour. — landed: `demo/palette.ts`
      (points/keys/3 configs/layouts) + `demo/main.ts`. The drag behaviour at
      this gate was the stripped static layout (guards inspect only); the full
      drag engine landed afterwards (`docs/movements.md`).
- [x] Reproduce the DOM contract the e2e specs assert (headings, console
      overlay, toolbar/parking structure, drag targets) — the specs query
      concrete selectors, so "similar" is not enough. — landed: `ide.ts` +
      `head.ts` reproduce the contract (testids, editing chrome, inert,
      dimming, drawer axis inversion); the 2 stale catalogue-drag specs (zero
      `draggable=` in `src`) were replaced with click-to-select assertions.
- [x] **One `playwright.config.ts` project per demo, all running the same
      `tests/e2e/*.spec.ts`.** — landed: a `vanilla` project plus a
      `default-head` project for the default-head visual spec. Ports are per-adapter;
      each new adapter (Phases 11–12) adds its own project on its own port.
- [x] Gate: `tests/e2e/` green. — landed 2026-09-14 (33 passed).

## Phase 11 — vue adapter + demo (second conformance gate)

> Gated on Phase 10. The vue adapter drives the same `core` surface the
> reference demo already exercises. SSR note: the vue demo is client-rendered —
> SSR coverage stays in the Phase 7 render-model tests; do not break the
> import-graph rule (demo code lives in the adapter, never in the render path).
> Context note: the vue demo may stay root-bag only.

- [ ] Scaffold `packages/vue/` (Vue adapter + vite demo): imports `core` only
      (never the reverse); owns Vue reactive wrappers
      (`ref`/`computed`/`watch`), directives, layout/head rendering, demo.
      `pnpm-workspace.yaml` (`packages/*`) already covers it; add a
      `playwright.config.ts` project (own port).
- [ ] Port the Stellar Outpost demo to `packages/vue/demo/`
      feature-for-feature. **Reference: `packages/vanilla/demo/`**
      (`palette.ts`, `main.ts`, and `i18n.ts` / `icons.ts` as needed): same
      points, same initial layout, same controls, same console, same drag
      behaviour, same DOM contract the e2e specs assert.
- [ ] Run the **same** `tests/e2e/*.spec.ts` against both demos.
- [ ] Gate: `tests/e2e/` green against **both** demos.

## Phase 12 — svelte adapter from scratch (third conformance gate)

> **Created, not ported.** The adapter is written fresh against `core`; nothing
> is inherited from any earlier Svelte implementation (the original reference
> UI is retired — see `docs/architecture.md §1`). A behavioural difference
> found here is a `core` bug — fix `core`, not the adapter.

- [ ] Scaffold `packages/svelte/` (Svelte 5 runes adapter + vite demo):
      imports `core` only; owns `.svelte.ts` reactive wrappers
      (`$state`/`$derived`/`$effect`), Svelte actions, layout/head components,
      demo. Add a `playwright.config.ts` project (own port).
- [ ] Port the Stellar Outpost demo to `packages/svelte/demo/`
      feature-for-feature (reference: `packages/vanilla/demo/`).
- [ ] Run the **same** `tests/e2e/*.spec.ts` against all demos.
- [ ] Gate: `tests/e2e/` green against **all** demos.
- [ ] Done = per-package `check` / `build` / `test` green for `core`,
      `vanilla`, `vue`, `svelte`; `biome check` clean; no `svelte`/`vue`
      import in `packages/core/src`; no `HTMLElement`/`document` in
      `packages/core/src` (compiler-enforced); the render path imports neither
      `globals.ts` nor `gap-dwell.ts` nor `umd.ts` (import-graph test — §SSR);
      no demo or `vite` in `packages/core`.

## SSR — how `plans/ssr.md` constrains these phases (normative)

> `plans/ssr.md` is the SSR spec; this section is the integration map. On any
> conflict, `ssr.md` wins on SSR semantics, this plan wins on sequencing.

- **Scope:** `packages/core` only (not the adapters). Goal: given a
  configuration + values, render the *resting* palette server-side into
  deterministic HTML and hydrate without mismatch. Non-goals: server-side
  drag/drop, timers, popups, command-box interactivity, `run()` side effects.
- **Wire snapshot** (SSR §3): point descriptors + virtuals + serialized layout
  + values + keys + control registry/defaults + `configuration` numbers. No
  functions, no class instances, no DOM. Already JSON-safe: serialized layout
  (`version: 1`), `KeyBindings`, the control registry/defaults (as long as
  nobody smuggles components in), `configuration` numbers (values, not the
  singleton). Not yet serializable: point definitions (`run` closure), stash
  aside slots (excluded by decision), custom point values (need codecs).
- **Key-shortcut rebuild rule (action points by name or inline):** key bindings
  are name-addressed strings; item specs are `PointTarget`
  (`string | VirtualPoint`). Rebuild = serialized config (layout incl. inline
  definitions + `KeyBindings`, all JSON-safe) + points list (descriptors +
  client-injected `run` runners + registered virtuals). `findKeystrokesFor`
  matches by `canonicalPointId`; `findKeystrokesForTarget` additionally matches
  an inline target by its own `id`. `fromServerDescriptor` rebinds `run` by
  action id; unknown ids throw at build time.
- **Already SSR-safe (keep it that way):** `identifiers`, `type`, `errors`,
  `specs`, `keys`, `layout` (pure data + pure math + sorted-key
  `stableStringify`), `virtual`, `controls` (pure), `gap-dwell` (importing arms
  nothing — never call `arm()` on the server), `globals` (single hatch,
  import-safe in Node), `tsconfig` (`lib: ["ES2022"]`, no `DOM`).
- **Per-phase obligations:** Phase 2 — `GapDwell` timers route through the
  `globals.ts` hatch, `configuration` stays a process-wide singleton (Phase 7
  pins it per request). Phase 3 — lands the wire inputs. Phase 4 — builders
  stay pure over descriptors. Phase 5 — lands `resolveControl` +
  `axisForRegion` (variant eligibility must agree server/client). Phase 6 — CSS
  is SSR-neutral, same global selectors. Phase 7 — implements the render model,
  pinning, codecs, hygiene, tests.
- **Open questions (decided, SSR §8):** stash asides excluded; shared object
  values keep shared references; box shell SSR / entry list client-only;
  missing configuration → skeleton placeholder.

## Context — how `plans/context.md` constrains these phases (normative)

> `plans/context.md` is the context-sensitive-tools spec; this section is the
> integration map. On any conflict, `context.md` wins on context semantics, this
> plan wins on sequencing.

- **Scope:** `packages/core` first (bags, `uses`, nothing-points, functional
  `can`, pure resolvers), adapter spikes second. Goal: tools that operate on
  host context (active file, selection) through optional bags — 1:1 tool→point
  always, context precedence resolved *inside* the point's resolvers, never by
  fanning one tool out to several points. Non-goals for core: DOM, reactivity,
  host bridge code (adapter-owned), frame timing / coalescing (adapter owns the
  dirty set, §2.6).
- **Vocabulary (locked):** tool = 1:1 toolbar-bound control (one point id or
  one inline virtual definition — no multi-point, no multi-binding); point =
  value / action / **nothing** (context + optional `can` only; no value, throws
  on set, excluded from value serialization); bag = `ValuesBag` flat key/value
  store; `uses?: readonly ContextName[]` on the point (optional bags,
  `undefined` slot when unregistered, `''` = root); scope ≠ context
  (render-where vs operate-on-what, never merged).
- **Ownership (locked):** the root bag `''` is core-owned (hydrated /
  persisted / reset — the only bag core touches that way); context bags are
  host-owned via `setContext`/`removeContext` (replace-never-append);
  missing context → `undefined` slot → disabled + placeholder, never a render
  throw. Pointless tools become pointful 1:1 — `status` / `commandBox` /
  `drawer` each bind a nothing-point whose `uses` names their context.
- **Data-flow rules every phase must respect:** bags read/write, no separate
  edit port (a host bridge is just another subscriber, adapter-side);
  param-array invocation in `uses` order (resolvers take
  `(ValuesBag | undefined)[]`, never throw on missing); no value-mirroring, no
  virtual chaining; scalar-write / non-scalar frozen-read (`Object.freeze` on
  `get`, `PaletteWriteError` on rejected writes); `can` functional +
  `subscribeCan` flips-only (no polling, no render storms).
- **Per-phase obligations:** Phase 2 — the timer hatch and the `configuration`
  singleton don't block the bag channels. Phase 3 — lands `uses` + `setTree` +
  `PaletteWriteError` (readiness only; `can` stays static, bags unwired).
  Phase 4 — entries carry `uses`, filtered at render. Phase 5 — presenters take
  the bound-display shape; context flows into drawer children. Phase 6 — CSS is
  context-neutral (disabled + placeholder states reuse existing selectors).
  Phase 7 — the render input stays bag-extensible. Phase 8 — implements bags +
  `NothingPoint` + functional `can` + `context-display.ts` + the adapter spike
  + the command-box pass.

## Non-goals / guardrails

- **Order is not negotiable**: additive core first (Phases 2–6), then SSR 7 +
  context 8 + optimization 9, then the conformance gate (Phase 10) and the
  further adapters (Phases 11–12). Do not start an adapter before the previous
  gate is green.
- No new movement behaviour in this plan — the engine builds on core primitives
  (`docs/movements.md` is the behaviour spec). Movement commits stay
  client-only and out of the SSR render path.
- No context behaviour before Phase 8 — Phases 3–5 land readiness stubs only
  (`uses`, `setTree`, `PaletteWriteError`).
- No `*Model` / variant-factory layer (out of scope per
  `docs/architecture.md §5`).
- Keep `AGENTS.md` recipes: scratch work in `sandbox/`, read-only `git`.
- Core stays DOM-free and demo-free; every demo and every `HTMLElement`/
  `document` usage lives in an adapter package.