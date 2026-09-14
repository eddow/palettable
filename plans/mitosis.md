# Mitosis — split `svelte` into `core` + `vanilla` + `vue` + `svelte`

> Status: **active plan — Phases 2–6 landed; remaining in execution order:
> Phase 7 (SSR render model) → Phase 8 (context) → Phase 9 (optimization,
> empty) → Phase 10 (vanilla parity) → Phase 11 (vue parity) →
> Phase 12 (thin svelte).**
> `packages/core` (headless, DOM-free) and `packages/vanilla` (vanilla-DOM
> adapter + demo) exist and are green; `packages/svelte` is still
> self-contained and does **not** import core yet. Order: finish `core`
> (SSR + context) → reach demo parity (`vanilla`, then `vue`) → only then
> make `svelte` depend on `core`
> (see **Evolution strategy** below). Permanent decisions for what has landed
> live in `docs/architecture.md §21`; this file tracks only what is left.
>
> SSR companion: `plans/ssr.md` is the normative SSR spec (analysis only, no
> implementation yet). It constrains — but does not reorder — the phases below:
> every phase must keep the core SSR-safe (§SSR below), and Phase 7 implements
> the SSR render model on top of what Phases 3–5 land.
>
> Context companion: `plans/context.md` is the normative context-sensitive-tools
> spec (specification complete, no implementation yet). It constrains — but does
> not reorder — the phases below: points/store/core stay extension-ready for
> bags (`§Context` below), and Phase 8 implements `ValuesBag` + `uses` +
> nothing-points + functional `can` on top of what Phases 3–5 + 7 land.

## Evolution strategy (the order is the point)

The migration is deliberately **additive first, subtractive last**. `packages/svelte`
is the working reference implementation and stays **untouched** until the new
stack is proven — svelte is kept as reference until we have `vanilla` + one
reactive framework (`vue`). Four stages, in this order:

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
   be exact. Passing the same e2e suite against all demos is what proves `core`
   is a faithful extraction rather than a plausible rewrite.
3. **Build `core` + `vue` without touching `svelte`, then reach vue demo parity.**
   `packages/vue` is the second adapter — the one reactive framework (besides
   vanilla) required before `svelte` may move. Same rule as stage 1: additive
   only, `svelte` stays the untouched oracle. The `packages/vue` demo must
   reproduce the same Stellar Outpost demo feature-for-feature and pass the
   same `tests/e2e/` suite (own playwright project, own port). Svelte is kept
   as reference until **both** `vanilla` and `vue` parities are green.
4. **Only then rewrite `svelte` to depend on `core` (Phase 12).**
   With parity proven, `svelte` becomes a thin adapter: delete its duplicated
   implementation and re-export / delegate to the `core` surface (Phases 2–11). Any
   behavioural difference that surfaces at this point is a `core` bug, not a
   reason to keep the old code.

Consequences for how work is sequenced:

- Remaining phases (7–11) are **additive**: they add to `core`/`vanilla`/`vue`
  and leave `svelte` alone. Nothing in `packages/svelte/src` is edited until Phase 12.
- The vanilla demo is built up **alongside** the core phases, not after them —
  each capability that lands in `core` should show up in the vanilla demo so
  parity is tracked continuously rather than assessed at the end. The vue demo
  follows the same rule once `packages/vue` is scaffolded (Phase 11).
- `svelte`'s existing tests stay green throughout (they are the
  regression net for the reference implementation).
- Phase 12 is the only phase allowed to delete svelte code, and it is gated on
  the e2e suite passing against **all three** demos (svelte reference + vanilla
  + vue — Phases 10 + 11).
- SSR never reorders the phases (`plans/ssr.md` §4–§7 map onto Phases 3–5 + 7,
  never before them). Each phase keeps the core import-safe under plain Node
  (no `document`, no timers firing, no `run()` reachable from the render path);
  see §SSR for the per-phase constraints.
- Context lands before parity (`plans/context.md` §§1–4 map onto
  Phase 8, after Phases 3–5 + 7 and before 10, never after parity). Each phase keeps
  `points.ts` / `store.ts` / `core.ts` extension-ready for bags (no API that
  Phase 8 must break to extend); see §Context for the per-phase obligations.

## Target ownership

- **`packages/core` (vanilla TS, rolled-up cjs/mjs, zero `svelte` imports,
  zero runes, zero `.svelte`, **zero DOM** (compiler-enforced, see
  `docs/architecture.md §21`), **no demo**, no `vite`):**
  basic typing, toolbar-movement management, command-box builders, console
  state machine, presenters (pure view-models), main CSS + default head
  theme CSS (dark/light) — plus the SSR render model (`resolveRenderTree` +
  atomic snapshot + value hydration, Phase 7; SSR-safe by construction, see
  §SSR and `plans/ssr.md`) and the context layer (`ValuesBag` + `uses` +
  nothing-points + functional `can`, Phase 8; headless by construction, see
  §Context and `plans/context.md`).
- **`packages/vanilla` (vanilla-DOM adapter + demo):**
  imports `core` only (never the reverse); owns plain-DOM rendering
  (`VanillaAdapter`: `mount`/`dispose`, value + layout subscriptions),
  pointer math / drag sessions / head components (as they land), and the
  vite demo (`demo/main.ts` + `index.html`). Rolled-up cjs/mjs/umd
  (`external: ['@palettable/core']`), vitest `jsdom`.
- **`packages/vue` (Vue adapter + demo — Phase 11):**
  imports `core` only (never the reverse); owns Vue reactive wrappers
  (`ref`/`computed`/`watch`), directives/actions, layout/head components,
  demo. Proves the core works with a reactive framework other than svelte
  before `svelte` is thinned.
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
  specs.ts          # PointSpec/PointTarget/isInlineSpec/canonicalSpecId/parsePointSpec/canonicalPointId
  store.ts          # PaletteStateStore (Map storage, Object.is no-op set)
  layout.ts         # layout data types + PaletteLayoutTree + defaultLayoutFromPoints
                    #   + pure track-space math (Phase 2: clampUnit,
                    #   actualTrackSpaceAt, insert/remove/resizeToolbar,
                    #   removeEmptyTrack, removeParkedToolbar, canonicalItemTool,
                    #   itemFingerprint, findOwnershipViolations)
                    #   + inline-spec support (ToolToolbarItem.tool is PointTarget;
                    #   SerializedToolbarItem.tool is string | VirtualPoint;
                    #   clone/serialize deep-copy inline definitions via globals.cloneValue)
  editors.ts        # PointFamily/EditorCapability/EditorChoice/familyOfPoint
  keys.ts           # KeyBindings/findKeystrokesFor/findKeystrokesForTarget (headless lookup only)
  virtual.ts        # enum-from / stash derived points
  errors.ts         # PaletteError
  globals.ts        # scheduleMicrotask + scheduleHostTimeout/clearHostTimeout + cloneValue
  configuration.ts  # Phase 2: configuration magic numbers (verbatim)
  gap-dwell.ts      # Phase 2: GapDwell state machine (timers via globals.ts)
  core.ts           # PaletteCore (registry + values store + layout + virtuals + resolveTargetVirtual + canRunAction)
  palette.ts        # Phase 3: ServerPointDescriptor + to/fromServerDescriptor + validateInitialValues + readSetterValue
  command-box.ts    # Phase 4: builders + headless query model (run = spec string, entries carry uses)
  console.ts        # Phase 4: ConsoleStore + consolePointDescriptor
  presenters.ts     # Phase 5: button/toggle/select/slider/status/configurator + resolveEditorVariant + axisForRegion
  *.test.ts         # 184 node tests across 13 files
  styles/palette.css        # Phase 6: layout + edit chrome (verbatim)
  theme/head-default.css    # Phase 6: dark base + light override (verbatim)
  # target additions (Phases 7–9):
  # render.ts (Phase 7: resolveRenderTree + snapshotPalette + descriptors),
  # context.ts (Phase 8: ValuesBag + bag registry surface),
  # context-display.ts (Phase 8: pure (boundValues, boundBags) resolvers),
  # (Phase 9 optimization: no new files — scope TBD, see Phase 9.)
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
| `palette/configuration.ts` (already plain) | 48 | **Done (Phase 2)** — `core/configuration.ts` verbatim; svelte re-export deferred to Phase 12 |
| `palette/keys.ts` (already pure) | 116 | Phase 2: **not** verbatim — core keeps only the headless lookup (`KeyBindings`, `findKeystrokesFor`, `findKeystrokesForTarget`); `normalizePaletteKeystroke` / `paletteKeystrokeFromEvent` / `createPaletteKeys` stay in the adapter (they touch `KeyboardEvent`). Contract: `KeyBindings` values are **string** specs (references by name) — keys bind to action points (`save`, `id:action`, setter `id=value`, stash virtual id, `enum-from` setter `virtualId=key`); inline virtual definitions live on toolbar items (`ToolToolbarItem.tool: PointTarget`), never in this map — a key bound to an inline stash uses the stash's `id` as its spec string, matched via `canonicalSpecId`. The map is JSON-safe and `findKeystrokesFor` matches by `canonicalPointId`, so setters/actions resolve to their point. Rebuild = serialized config (layout specs incl. inline definitions + `KeyBindings`, both JSON-safe) + points-list (descriptors + client-injected `run` runners + registered virtuals) |
| `palette/drag-session.ts` (DOM-only, no svelte) | 120 | **Stays in the adapter** — DOM-free core rule (see Phase 2 decision); also SSR-client-only (§SSR) |
| `palette/gap-dwell.ts` (plain class + `setTimeout`) | 110 | **Done (Phase 2)** — `core/gap-dwell.ts` (timers via `globals.ts` hatch); SSR render path must never call `arm()` (§SSR) |
| `palette/layout.svelte.ts` (pure math + `$effect` actions + slide engine) | 1536 | **Phase 2 done** (pure math → `core/layout.ts`: `clampUnit`, `actualTrackSpaceAt`, `insert/remove/resizeToolbar`, `removeEmptyTrack`, `removeParkedToolbar`, `canonicalItemTool`, `itemFingerprint`, ownership); movement commits stay deferred (engine restart — do NOT port the old slide engine, rebuild on the pure primitives). SSR: track-space math is already SSR-safe; `axisForRegion()` + drawer perpendicular rule land in core in Phase 5 (SSR §4.3 needs them in core) |
| `palette/palette.svelte.ts` (`Palette` class + `$state palettes` + hydrate/serialize) | 1261 | Phase 3: `core/palette.ts` — `PaletteError`, `valueActions`, `valueReader`, spec resolution, serialization/hydration, `Palette` with injected store (no `$state`); svelte keeps `$state palettes` mirror. SSR: this phase also lands `initialValues` + `setMany` (SSR §4.2) and `ServerPointDescriptor` + `to/fromServerDescriptor` (SSR §4.1) — see §SSR. Context: keep `points.ts` / `store.ts` / `core.ts` extension-ready for Phase 8 (`uses`, `NothingPoint`, functional `can`, bag registry) — no API this phase may break to extend; see §Context |
| `palette/command-box.svelte.ts` (pure builders + `$state`/`$derived` model) | 1366 | Phase 4: builders (`paletteCommandEntries`, `paletteAddItemEntries`, `paletteDerivedVariants`, `paletteEnumSubsetValues`, catalogue payload) → `core/command-box.ts` pure; model becomes vanilla query→results fn, svelte wraps with `$derived`. SSR: builders stay pure over descriptors, no closures in the SSR path (SSR §4.3); the entry list itself is client-only — the box shell is SSR, entries are not (SSR §8). Context: builders must not assume a single global store — entries carry `uses` and the renderer filters/resolves at render time (Context §2.7); commands on nothing-points with `uses: []`/`undefined` are always present (see §Context) |
| `palette/console.svelte.ts` (`$state consoleState` + open/toggle/add-state) | 101 | Phase 4: `core/console.ts` vanilla state machine + listener set; svelte wraps with `$state`. SSR: console is resting-state only (no timers/popups/interactivity on the server) |
| `palette/presenters.svelte.ts` (pure fns over `PaletteEditorContext`) | 466 | Phase 5: `core/presenters.ts` verbatim logic, generic component type; svelte re-exports typed with `Component`. SSR: this phase also lands `resolveEditorVariant()` — the single-id fallback chain the render model needs (SSR §4.3); `editorChoicesFor()` stays for the client-only config surface. Context: presenters take the param-array display shape `(boundValues, boundBags)` so nothing-points (`status`, `command-box`, `drawer`) render from bags (Context §2, §4 step 6); see §Context |
| `palette/drawer-editor.svelte.ts` (`$state` collapse + `mount(DrawerPopup)`) | 102 | Stays svelte (portal is adapter-owned); collapse signal contract mirrored from core if needed |
| `palette/core.svelte.ts` / `edition.svelte.ts` barrels | 170/90 | Become `core/index.ts` + svelte thin re-export barrels |
| `palette/components/*.svelte` (Ide, Toolbar*, Parking, PaletteItem, Drawer*) | 7 files | Stay svelte; delegate movement to core engine via behaviour fns (no local layout math) |
| `palette/styles/palette.css` (layout + edit chrome) | — | Phase 6: move to `core/styles/palette.css`, svelte imports from `@palettable/core` (or app imports core CSS directly) |
| `head/styles/head-default.css` (dark base + `.palette-default-theme-light`) | — | Phase 6: move to `core/theme/head-default.css` (dark/light tokens stay in sync per `docs/theming.md`); svelte head uses `core/theme` |
| `head/registry.ts`, `head/editors/*.svelte`, `head/Console.svelte`, `head/Icon.svelte` | 10+ files | Stay svelte (the default head); bind core presenters only |
| `head/icons.svelte.ts` (`$state icons.factory`) | — | Stays svelte; core takes an injected `resolveIcon?: (name: string) => unknown` instead of importing the factory |

## Phase 2 — pure movers (landed 2026-09-14)

> **Additive only** — nothing in `packages/svelte/src` was edited.
> `svelte` stays the working reference until Phase 12.

- [x] `configuration.ts` → `core/configuration.ts` verbatim (plain object,
      no svelte/runes). Svelte re-export deferred to Phase 12 (additive rule —
      `packages/svelte/src` frozen until then).
- [x] `gap-dwell.ts` → `core/gap-dwell.ts` (near-verbatim; one deliberate
      delta: `setTimeout`/`clearTimeout` route through the `globals.ts`
      escape hatch as `scheduleHostTimeout`/`clearHostTimeout` with an opaque
      `unknown` handle, because `lib: ["ES2022"]` has no DOM timers —
      see `docs/architecture.md §21` Phase 2 status).
- [x] Pure layout math from `layout.svelte.ts` → `core/layout.ts`:
      `clampUnit`, `actualTrackSpaceAt`, `insertToolbar`, `removeToolbar`,
      `removeEmptyTrack`, `removeParkedToolbar`, `resizeToolbar`,
      `canonicalItemTool`, `itemFingerprint`, `findOwnershipViolations`
      (stays a core export — adapters reuse the invariant at runtime, not a
      test helper). Private helpers `actualTrackSpaces`/`applyTrackSpaces`/
      `stableStringify` moved with them.
- [x] Deliberately **not** moved (see `docs/architecture.md §21` Phase 2
      status): `drag-session.ts` (DOM-only), `isEditableTarget`
      (`HTMLElement`), `regionDirection` (adapter orientation strings —
      core's equivalent is `SurfaceContext.axis`), `removePaletteItem`
      (svelte border/track terms — core's equivalent is
      `PaletteLayoutTree.removeItem`), `insertTrackWithToolbar` (one-line
      splice; Phase 5 rebuilds movement on an explicit drag-state param),
      commit fns + drag actions (Phase 5, rebuilt — do NOT port the old
      slide engine). `keys.ts` already split per the Phase 2 decision
      (core: headless lookup; adapter: `KeyboardEvent` normalization).
- [x] Verified: core `check` + `build` + `test` green (149 node tests),
      svelte `check` (0 errors) +
      `vitest run` (179) green untouched, vanilla `check` + `test` green,
      `biome check packages/core` clean. `packages/svelte/src` unedited.
- [x] Point-spec union (follow-up 2026-09-14): a spec is `PointTarget`
      (`string | VirtualPoint`) — a string reference *or* an inline virtual
      definition (`StashDefinition` / `EnumFromDefinition`) carried directly
      in `ToolToolbarItem` / `SerializedToolbarItem` `tool`. Landed in core:
      `specs.ts` (`PointTarget`, `isInlineSpec`, `canonicalSpecId`),
      `layout.ts` (item `tool` widened; `canonicalItemTool` resolves inline
      ids; clone/serialize deep-copy inline definitions via
      `globals.cloneValue`), `keys.ts` (`findKeystrokesForTarget`; `KeyBindings`
      values stay strings — a key to an inline stash uses its `id`),
      `core.ts` (`resolveTargetVirtual`: registered-by-id or inline-validated).
      Verified: core `check` + `build` + `test` green (149 node tests),
      `biome check` clean. `packages/svelte/src` unedited.

## Phase 3 — `Palette` runtime (de-rune) + SSR hydration inputs

> NOTE: `PaletteCore` + `PaletteStateStore` + `PaletteLayoutTree` already live
> in `core/src/` as `core.ts` (+ `layout.ts` for the tree, `store.ts` for the
> store). This phase now means: move the remaining svelte runtime bits below.

- [x] Move `valueActions`, `valueReader`, `resolveEditableTool`,
      `paletteTool*` helpers, `serializePaletteLayout` / `validatePaletteLayout` /
      `hydratePaletteLayout` (return plain objects; svelte wraps with `$state` at
      the call site — see `palette.svelte.ts:1245` `$state(plain)` pattern) — landed 2026-09-14 as headless core ports (svelte keeps its own copies until Phase 12):
  - `valueActions` (number `inc`/`dec` with `step`) **and** its bounds-checked `can`, reviewed + fixed 2026-09-14: `run('id:inc'|'id:dec')` applies the step via `core.ts:applyNamedAction` (a private method — it needs the store), and `PaletteCore.canRunAction(id, action)` exposes the pure bounds check (`inc` vs `max`, `dec` vs `min`, `undefined` bound = unlimited) mirroring the svelte reference's `valueActions.number.inc.get can()`. Unknown action → `PaletteError`, not a silent `true`. `valueReader` (boolean `1`/`true`/`0`/`false`, `Number` with finite/blank rejection, string passthrough) landed as `palette.ts:readSetterValue` and is **the single coercion path** — `coerceSetterValue` was deleted (it was a second, weaker copy: it accepted blank → `0` and `Infinity`, diverging from the oracle); `resolveEditableTool` (unknown/action/family-mismatch throws) landed as `core.ts:resolveEditablePoint`. Deliberate divergence: an unrecognized boolean token (`"maybe"`) throws instead of silently coercing to `false`.
  - `serializePaletteLayout` / `hydratePaletteLayout` already lived in `core/layout.ts` as `getSnapshot` / `setLayout` / `fromSerializedLayout` (flat slot list, each slot in its own track, deep-clone, inline definitions verbatim); `validatePaletteLayout` landed as `layout.ts:validateSerializedLayout` (version/regions/items/inline-tool/config/drawer checks, never throws). Covered in `layout.test.ts` + `palette.test.ts`; 150 node tests green.
  - Deliberately **not** ported: the `Palette` class itself (config/tools/keys/editors resolution over live component-bearing tool objects + `runner`/`setter` wrapper hooks — adapter-owned, components never cross into core), `paletteTool*` runner factories returning `{ can, run }` closures over live tool objects (core's `run(spec)` is the headless equivalent), the `setter` toggle-restore `WeakMap` behaviour (svelte-only value semantics, no core counterpart), `palettes = $state(…)` (svelte reactive mirror — core exposes `values.subscribe`/`subscribeLayout` instead), `resolveItemPlacementTarget` (border/track terms — movement rebuilds it in Phase 5), `describeItemConfiguration` / `resolveEditor` / `renderEditor` / `renderConfigurator` (editor-registry + component surface — Phase 5 presenters).
- [x] `Palette` class: keep config/tools/keys/editors resolution verbatim;
      replace `get editing()` `$state` read with injected store predicate
      (`store.editing === this`); keep `dispose()` no-op for parity. — decided 2026-09-14: **not ported** (see above — the class is adapter-owned; core's `PaletteCore` + `values.subscribe`/`subscribeLayout` + `dispose` (drops value **and** layout listeners) is the headless equivalent).
- [x] Svelte keeps `palettes = $state(…)` as the reactive mirror of the core store. — confirmed: core exposes `values.subscribe`/`subscribeLayout`, svelte keeps `$state palettes` until Phase 12.
- [x] **No duplicated value surface** (review fix 2026-09-14): `PaletteCore` does **not** re-implement get/set/events. The former `getValue` / `setValue` / `resetValue` / `subscribe` wrappers were deleted and the store is exposed as `PaletteCore.values` (`PaletteStateStore`) — adapters read/write/subscribe there directly. Only what the raw store cannot do stays on core: virtual resolution (`resolveTargetVirtual`), command execution (`run` / `runStash` / `canRunAction`), core-owned stash aside slots, validated batch hydration (`setMany` / `initialValues`), and `resetAll` (bridges store reset + stash-aside clear). This removes the old footgun where `core.subscribe('someVirtual', …)` never fired (it proxied the virtual-unaware store) while `core.getValue('someVirtual')` did resolve.
  - `run()` is **synchronous** (review fix): `PaletteError`s are thrown, not rejected, matching the svelte oracle. Action-point `run()` may return a promise; core does not await it — the caller decides.
- [x] Context readiness (from `plans/context.md` — no bags yet, just don't block Phase 8) — landed 2026-09-14:
  - `PointBase` gains `uses?: readonly ContextName[]` (optional bags; `undefined` = root only as today). No behaviour change — `run`/`can` keep today's signatures this phase. Landed: `points.ts` (`uses?: readonly string[]`).
  - `PaletteStateStore` gains `setTree(patch)` (apply all pairs, collect `Object.is`-changed keys, notify once with the changed-key array). Existing `set()`/`notify()` unchanged. Tests in `store.test.ts`. Landed: `store.ts` (`setTree` — all writes land before any listener runs, returns changed keys; covered in `palette.test.ts`).
  - `errors.ts` gains `PaletteWriteError extends PaletteError` (thrown by bag writes; adapters catch for UI feedback). No other error change. Landed: `errors.ts` (stub — no core code throws it yet; covered in `palette.test.ts`).
  - `ActionPoint.can` stays readable as today this phase — the static→functional migration lands in Phase 8 (adapters switch to `evaluateCan(id)` then, not now).
  - NOTE for Phase 8: `PaletteCore.canRunAction` is the named-action `can`; the Phase 8 functional `can`/`evaluateCan` is a different channel (point-level, bag-aware) — keep them distinct.
- [x] SSR inputs (from `plans/ssr.md` §4.1–§4.2 — land here because they touch
      the same `core.ts`/`store.ts`/`points.ts` surface, not as a separate pass) — landed 2026-09-14 (`core/palette.ts`: `ServerPointDescriptor` + `to/fromServerDescriptor` + `validateInitialValues` + `readSetterValue`; `core.ts`: `initialValues` + `setMany` + `resolveEditablePoint` + `readActionCan` + `canRunAction`; `layout.ts`: `validateSerializedLayout`; covered in `palette.test.ts` + `layout.test.ts`; 150 node tests green):
  - `initialValues?: Readonly<Record<string, unknown>>` on `PaletteCoreOptions`
    (and/or `PaletteStateStore`), applied after defaults, validated per point
    (`unknown id` → throw, `action` id → throw, `Object.is`-equal → skip
    notify), zero listener notifications during construction; plus a
    `setMany()` / `replaceAll()` sibling for client hydration (silent — single
    emit or none, not N per-key notifies).
  - `ServerPointDescriptor` type + `toServerDescriptor(points)` /
    `fromServerDescriptor(descs, runners)` helpers + round-trip validation
    (`JSON.parse(JSON.stringify())` stable). Rendering needs only the
    descriptor; `run()` is unreachable from the render path by construction.
    Document: custom `TypeConstraints` entries participating in SSR must be
    `JSON.stringify`-stable (or wait for the Phase 7 `ValueCodec` registry).
  - Action-point rebuild contract (key-shortcuts need this, not just SSR):
    action points serialize **by name** — the descriptor carries the action
    point's `id` (+ `label`/`can`/metadata, no `run`); the client rebinds
    `run` via the `runners: Record<actionId, run>` argument of
    `fromServerDescriptor`. Derived actions have **two** serializable forms:
    a `stash`/`enum-from` virtual registered under its `id` (name-addressable
    via `runStash(id)` / `run(virtualId)`, rebuilt from serialized config
    (`KeyBindings` + virtuals list) + the points-list), or an **inline**
    definition carried directly in the spec (`PointTarget`: `ToolToolbarItem`
    / `SerializedToolbarItem` `tool` is `string | VirtualPoint` — already
    landed in core). Inline definitions behave like the same definition
    registered under their `id` (same validation via `assertValidVirtual`,
    same run semantics via `resolveTargetVirtual`), except their lifetime is
    the spec itself: no registry entry, no `defineVirtual`/`removeVirtual`,
    no id-collision check. A key bound to an inline stash uses the stash's
    `id` as its spec string (`findKeystrokesForTarget` matches inline targets
    by that id). No closure crosses the wire in either form. Validation:
    unknown action id in `runners` or a binding whose canonical id resolves
    to neither a point nor a virtual → throw at build time (same strictness
    as `initialValues` unknown-id).
  - Stash aside slots stay excluded from the snapshot **by documented decision**
    (rendering a stash button needs only current-vs-stashed pressed state).

## Phase 4 — command-box + console (headless model)

- [x] Pure builders → `core/command-box.ts`: `paletteCommandEntries`,
      `paletteAddItemEntries`, `paletteDerivedVariants`, `paletteEnumSubsetValues`,
      catalogue `serialize/parseCatalogDragPayload` (or delete per
      `plans/simplify.md` if still caller-less), tokenize/filter/rank fns. — landed 2026-09-14 as headless ports over `readonly AnyPoint[]` + `CommandBoxContext` (keys/values/actionCan/itemEditors) instead of a live `Palette`: entries carry `run` **spec strings** (adapters execute via `PaletteCore.run`), never closures. Catalogue drag payloads **deleted per `plans/simplify.md`** (dead code — rows are click-to-select); `commandBoxEnumCommands`/`per-value` **deleted** (enum catalog always one row); editor-registry item builders stay adapter-owned (core has no components). Covered in `command-box.test.ts`.
- [x] Model: extract the `$derived.by` chains (`availableCategories`,
      `parsedInput`, `resultsValue`, `suggestionsValue`) into vanilla
      `(entries, query) => results` functions; svelte `paletteCommandBoxModel`
      becomes a thin `$state`/`$derived` wrapper. — landed 2026-09-14: `filterCommandEntries`, `suggestCommandKeywords`, `parseCommandInput`, `availableEntryCategories`/`availableEntryKeywords`, `tokenizeQuery`/`trimLastToken` in `core/command-box.ts` (svelte keeps its `$derived` model until Phase 12).
- [x] `console.svelte.ts` → `core/console.ts`: `ConsoleState`, open/close/toggle,
      `resetConsoleAddState`, `consoleTool` (returns a run point; no svelte import). — landed 2026-09-14: `ConsoleStore` (vanilla state + listener set; svelte wraps in `$state` until Phase 12) + `consolePointDescriptor` (run-point descriptor; adapter binds `run` to the store toggle). Covered in `console.test.ts`.
- [x] Context readiness: command-box entries carry `uses` (filter at render, never build-time precompile — Context §2.7). `consoleTool` stays a run point this phase; its nothing-point form lands in Phase 8. — landed: `CommandBoxEntry.uses` + `consolePointDescriptor` is a run point.
- [x] SSR constraint (from `plans/ssr.md` §4.3): command-box builders ported
      here must be pure over descriptors — no closures in the SSR path. The
      command box is SSR as a shell; the entry list is client-only (does not
      show on load). — landed: builders take descriptors + plain-data context; `run` is a spec string.

## Phase 5 — presenters + movement commits + SSR variant resolution

- [x] `presenters.svelte.ts` → `core/presenters.ts`: `button/toggle/select/slider/
      commandBox/status/configurator` presenters verbatim, generic component type.
      Heads stay dumb (no `tool.value = …` in `.svelte`, per `docs/architecture.md §5`). — landed 2026-09-14 as headless ports over plain data (definition + value + config + surface): `buttonPresenter`/`togglePresenter`/`selectPresenter`/`sliderPresenter`/`statusPresenter`/`configuratorModel` + patches/cleanup. Mutation routes through spec strings / `values.set` — never live tool writes. Deliberately **not** ported: `commandBoxPresenter` (builds a `$state` model — core has no runes), `configuratorPresenter.remove()` (needs live toolbar/track/border identity — adapters own it), `headEnumSubsetConfig` display filtering beyond option `can` (demo `EnumSubsetConfigurator` owns it). Covered in `presenters.test.ts`.
- [x] `resolveEditorVariant()` (single id) alongside `editorChoicesFor()`
      (config-surface list); document the fallback chain once (from
      `plans/ssr.md` §4.3 — the render model needs exactly one id, not a
      choice list adapters interpret themselves). — landed 2026-09-14 in `core/presenters.ts`: explicit item `editor` → family default → first eligible → compact fallback for ineligible explicit → `undefined`. `editorChoicesFor()` stays for the config surface.
- [x] `axisForRegion()` + drawer perpendicular-axis rule in core (moved from
      adapters; from `plans/ssr.md` §4.3 — server/client disagree on variant
      eligibility otherwise). Replaces the adapter-owned `regionDirection` and
      the "enforced by adapters, opaque to the core" drawer rule. — landed 2026-09-14: `axisForRegion` + `drawerChildAxis`/`drawerChildRegion` in `core/presenters.ts`.
- [ ] Movement commits (`commitDraggedToTrackSpace/ItemSpace/StackSpace/Parking…`,
      `insertTrackWithToolbar`, `moveToolbarToTrack/Stack`) rebuilt in
      `core/layout.ts` on the Phase-2 primitives against an explicit drag-state
      param (no module `$state` reads). Svelte actions/components call them.
      Commits stay client-only (never in the SSR render path). — deferred: movement was stripped for restart (`plans/movement.md` stays the behaviour spec); the engine rebuilds on the Phase-2 primitives, not by porting the old slide engine.
- [x] `drawer-editor`: keep portal in svelte; move only the perpendicular-direction
      + open-mode/placement derivation if reusable. — landed: perpendicular rule in core (`drawerChildAxis`/`drawerChildRegion`); portal + open-mode/placement stay svelte (adapter-owned).
- [x] Context readiness: presenters take `(boundValues, boundBags)` param-array shape (Context §2.2, §4 step 6) so Phase 8 resolvers plug in without re-shaping; context flows down into drawer child tools (Context §1.2). — landed: `BoundDisplay` carries `point` + `value` + optional `bags` (accepted + ignored this phase).

## Phase 6 — CSS + theme to core

- [x] Move `palette/styles/palette.css` → `core/styles/palette.css` (layout +
      edit chrome + drawer shell, global selectors unchanged). — landed 2026-09-14 verbatim (+ header comment).
- [x] Move `head/styles/head-default.css` → `core/theme/head-default.css`
      (dark base + light override stay in sync; see `docs/theming.md`). — landed 2026-09-14 verbatim (+ header comment).
- [ ] Svelte/app import CSS from `@palettable/core` (`core/styles`, `core/theme`);
      no runtime injection, no per-instance scoping (unchanged rule). — deferred to Phase 12 (svelte frozen; `package.json` already exports `./styles/*` + `./theme/*` and ships them in `files`).
- [ ] SSR constraint: CSS moves are SSR-neutral (no runtime injection to port),
      but the SSR HTML must reference the same global selectors — no
      per-instance scoping on the server either.

## Execution order (remaining work)

Phases 2–6 are landed. What is left runs in this order (numbers are
topological, not sequential — the old 6b/6c labels sort early but execute as 10/11):

1. **Phase 7** (SSR render model) — needs only the landed Phases 3–5 surface.
2. **Phase 8** (context) — needs Phases 3–5 + 7; lands **before** the parity
   expansion so the vanilla spike can ride the Phase 10 demo work instead of
   requiring a second pass.
3. **Phase 9** (optimization — empty, scope TBD) — placeholder between
   context and adapters; no work item may block parity on it.
4. **Phase 10** (vanilla parity) → **Phase 11** (vue parity) — same demo,
   same e2e suite; both stay context-free and SSR-independent.
5. **Phase 12** (thin svelte) — the only phase that edits `packages/svelte/src`.

## Phase 7 — SSR render model (after Phases 3–5, before Phase 12)

> Implements `plans/ssr.md` §4.3–§4.8 on top of the Phases 3–5 surface.
> Additive only — nothing in `packages/svelte/src` is edited. Gated on Phases
> 3–5 (needs `initialValues`, descriptors, `resolveEditorVariant`,
> `axisForRegion`); must land before Phase 12 so the svelte thinning can rely
> on the same resolver the server uses.

- [ ] `resolveRenderTree()` pure resolver in `core/render.ts` (+ `snapshotPalette()`
      atomic snapshot): input = definitions + virtuals + layout snapshot +
      values snapshot (taken once — no layout/values tear); per-item output =
      canonical point id, point descriptor (or `undefined` for pointless),
      current value / enum-from key / stash pressed-state, single resolved
      editor variant id, capabilities, keystrokes, drawer children (recursive,
      depth-bounded). Guarantees: no subscriptions, no timers, no `run()`, no
      `set()`, no DOM; same input → `JSON.stringify`-identical output.
- [ ] Configuration pinning (SSR §4.5, preferred option): freeze the four
      `configuration` numbers into the wire snapshot; the resolver takes them
      as an argument (defaulting to the singleton for back-compat). Only
      `trackGapSplit`/`trackGapMinGrow` affect resting geometry; the two `…Ms`
      timeouts never affect SSR output but are pinned for the hydration check.
      If no configuration is transmitted, the server renders a skeleton
      placeholder (SSR §8 — SSR stays optional).
- [ ] `ValueCodec` registry for custom types (SSR §4.6), or explicit
      SSR-unsafe-by-default with loud failure. Built-ins use identity;
      the wire snapshot carries only serialized values. Reference rule: two
      tools aiming at the same point with the same object value keep the same
      reference (SSR §8).
- [ ] UMD/server-bundle hygiene (SSR §4.8): SSR uses `dist/index.mjs` /
      `dist/index.cjs`, never the UMD bundle (`umd.ts` writes
      `globalThis.palettable` on import). Consider a build-time guard.
- [ ] Host-timers policy lock-in (SSR §4.7): the render path (`render.ts` +
      everything it calls) must not import `globals.ts` or `gap-dwell.ts` —
      enforce with an import-graph test. `GapDwell` instances are client-only
      (adapters construct them post-hydration).
- [ ] Determinism tests (SSR §5): no `Math.random`/`Date.now`/
      iteration-order dependence (grep test); `Map` order = descriptor array
      order; registry JSON round-trip preserves fallback order (or sort by
      `id`); `stableStringify` key-sorting kept; `defaultLayoutFromPoints`
      order = points order; `SerializedLayout` `version: 1` rejection test.
- [ ] Render-model tests (SSR §6, all in core, node, no jsdom): Node-only
      import test (no `setTimeout`/`queueMicrotask` during build + resolve);
      golden render-model snapshot (byte-identical across runs + JSON
      round-trip); hydration round-trip (server → serialize → client →
      identical output); action isolation (no `run` without binding, resolving
      never calls `run`); config-pinning test; import-graph test.
- [ ] Docs per repo rule (`AGENTS.md`): migrate SSR decisions to
      `docs/architecture.md` (new §22); remove completed items here and in
      `plans/ssr.md` (the `plans/` → `docs/` lifecycle).
- [ ] Context readiness: `resolveRenderTree()` input shape stays bag-extensible
      (Context §2.2 param-array `(boundValues, boundBags)` flows through, not
      a single-store assumption) so Phase 8 plugs bags in without re-shaping.

## Phase 8 — context-sensitive tools (after Phases 3–5 + 7; before Phase 10 parity and Phase 12)

> Implements `plans/context.md` §§1–4 in core. Additive only — nothing in
> `packages/svelte/src` is edited. Gated on Phases 3–5 + 8 (needs `setTree`,
> `uses` stub, `PaletteWriteError`, pure builders, `(boundValues, boundBags)`
> presenter shape, bag-extensible render input); must land before Phase 12 so
> the svelte thinning subscribes to context channels instead of inventing its
> own. Vanilla spike first for the adapter proof (Context §2.6); svelte/React
> parity follows, it is not this phase's gate.

- [ ] **`core/context.ts`** — `ValuesBag` class (`get` frozen / `set` /
      `setTree` one-notify / `asObject` / global + per-key `subscribe` /
      `clearListeners`), same `Map` + `Object.is` + snapshot-iteration +
      async error re-throw discipline as `PaletteStateStore`. Root bag `''`
      wraps the store generalized to the `ValuesBag` interface; non-root bags
      start empty. Tests mirror `store.test.ts` (one-notify file-swap,
      per-key invalidation, freeze enforcement, `setTree` batching).
- [ ] **`points.ts`** — `NothingPoint` kind
      (`{ type: 'nothing', id, label, uses, can?, … }`) + `isNothingPoint`
      guard (`isValuedPoint` / `isActionPoint` return `false` for it); extend
      `AnyPoint` union. `uses?: readonly ContextName[]` already stubbed in
      Phase 3 becomes load-bearing. `can` becomes functional on **all** kinds
      (`can(...bags) => boolean`, omitted = enabled); static `can: boolean`
      readers switch to `evaluateCan(id)` here (not earlier). Core semantics:
      `getValue` → `undefined`, `setValue` throws `PaletteError`, `reset`
      no-op, excluded from value serialization (binding itself serializes).
      Pointless tools become pointful 1:1 — `status` / `command-box` /
      `drawer` each bind a nothing-point whose `uses` names their context.
- [ ] **Wire bags into `PaletteCore`** — registry `Map<ContextName,
      ValuesBag>` (root `''` core-owned, hydrated/persisted/reset; context
      bags host-owned via `setContext`/`removeContext` with the §1.3
      replace-never-append lifecycle); `getBag` / `resolveBags` (never
      throws, missing → `undefined`) / `evaluateCan` / `subscribeContext`
      (`(bagName, changedKeys)`) / `subscribeCan` (flips only, no render
      storms); `getValue`/`setValue` survive as root-bag sugar; `dispose()`
      clears root + layout listeners and unsubscribes from context bags
      (host disposes them). Tests in `core.test.ts`.
- [ ] **`core/context-display.ts`** — pure resolvers per family with
      `(boundValues, boundBags)` param-array signature + `missingContext`
      sentinel (`undefined` slot) + single-point dual-source bold precedence
      resolver (selection bag when present, else root value). No
      value-mirroring, no virtual chaining (Context §2.3). Tests mirror
      `virtual.test.ts` style.
- [ ] **Adapter spike (vanilla first)** — dirty-set + rAF refresh + one
      context-bound control proving selection-follows-context with zero value
      notifications (Context §2.6, §4 step 7). Bridge code (IDE push + write
      propagation) lives in adapter code, never in core.
- [ ] **Command-box context pass** — entries carry `uses`, filter at render
      (Context §2.7, §4 step 8). Nothing-point commands with `uses: []` /
      `undefined` always present (no bag subscription); unregistered bags →
      `undefined` slot, entry decides (hidden / disabled / fallback label).
- [ ] **Docs per repo rule (`AGENTS.md`):** document the `uses` contract
      (1:1 tool→point, optional bags, functional `can` + `subscribeCan`) in
      `docs/core-concepts.md`; migrate context decisions to
      `docs/architecture.md` (new §23); retire `plans/context.md` once landed.

## Phase 9 — optimization (empty placeholder, scope TBD)

> Empty on purpose: a reserved slot between context (Phase 8) and adapters
> (Phases 10–11) for perf/cleanup work discovered during 7–8. No checklist
> yet — file it here when it appears, not in the parity phases. Must stay
> SSR-safe and bag-extensible like every other additive phase; must not
> block parity (10/11 gate on their own criteria, never on this phase).

## Phase 10 — vanilla demo parity (first parity gate)

> This is the acceptance criterion for stages 1–2 of the evolution strategy:
> the vanilla demo must be the **same demo** as the svelte one, because
> `tests/e2e/` will attack all demos with the same specs.
>
> SSR note: the parity demos are client-rendered; SSR coverage comes from the
> Phase 7 render-model tests (core, node), not from e2e. Do not gate parity on
> SSR output — but do not break the Phase 7 import-graph rule while building
> the demo (demo code lives in adapters, never in the render path).
>
> Context note: the parity demos stay context-free (root bag only) — Phase 8
> lands first, so the vanilla spike rides this phase's demo work; context
> coverage comes from the Phase 8 core tests + vanilla spike, not from e2e.
> Do not gate parity on context output.

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
- [ ] Gate: `tests/e2e/` green against **both** demos (svelte reference +
      vanilla). This unlocks Phase 11, not Phase 12.

## Phase 11 — vue adapter + demo parity (second parity gate)

> This is the acceptance criterion for stage 3 of the evolution strategy:
> `svelte` is kept as reference until we have `vanilla` **+ one reactive
> framework** (`vue`). Gated on Phase 10 (vanilla parity green) — the vue
> adapter builds on the same core surface the vanilla parity already proved.
>
> SSR note: the vue demo is client-rendered like the others; SSR coverage
> stays in the Phase 7 render-model tests (core, node). Do not gate vue
> parity on SSR output — but do not break the Phase 7 import-graph rule
> (demo code lives in the adapter, never in the render path).
>
> Context note: the vue demo stays context-free (root bag only); context
> coverage comes from the Phase 8 core tests + vanilla spike, not from e2e.

- [ ] Scaffold `packages/vue/` (Vue adapter + vite demo): imports `core`
      only (never the reverse); owns Vue reactive wrappers
      (`ref`/`computed`/`watch`), directives/actions, layout/head components.
      Add to `pnpm-workspace.yaml` (`packages/*` already covers it) +
      `playwright.config.ts` (own project, own port).
- [ ] Port the same Stellar Outpost demo to `packages/vue/demo/`
      feature-for-feature (same reference as Phase 10:
      `packages/svelte/src/routes/+page.svelte` +
      `src/demo/palette.svelte.ts`): same points, same initial layout, same
      editors, same console, same drag behaviour, same DOM contract the e2e
      specs assert.
- [ ] Run the **same** `tests/e2e/*.spec.ts` against all three demos.
- [ ] Gate: `tests/e2e/` green against **all three** demos (svelte reference
      + vanilla + vue). Only then may Phase 12 delete svelte code.

## Phase 12 — thin the adapter, close out

> **Only phase allowed to edit `packages/svelte/src`.** Gated on Phase 11:
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
- [ ] Done = `tests/e2e/` green against **all three** demos (Phase 10 + 11 gates),
      Phase 7 render-model tests green (SSR gate),
      Phase 8 context tests green (`context.test.ts`, `context-display.test.ts`,
      store `setTree`, core bag/`can` channels, vanilla spike — Context gate),
      `pnpm --filter @palettable/core check/build/test` green,
      `pnpm --filter @palettable/vanilla check/build/test` green,
      `pnpm --filter @palettable/vue check/build/test` green,
      `pnpm --filter @palettable/svelte check/test` green, `biome check` clean,
      no `svelte` import in `packages/core/src`, no `HTMLElement`/`document`
      in `packages/core/src` (compiler-enforced — see `docs/architecture.md §21`),
      render path imports neither `globals.ts` nor `gap-dwell.ts` nor `umd.ts`
      (import-graph test — see §SSR),
      no demo/vite in `packages/core`, no layout math left in
      `packages/svelte/src/lib` outside behaviour wrappers.

## SSR — how `plans/ssr.md` constrains these phases (normative)

> `plans/ssr.md` is the SSR spec; this section is the integration map. On any
> conflict, `ssr.md` wins on SSR semantics, mitosis wins on sequencing.

- **Scope:** `packages/core` only (not `vanilla`, not `svelte`). Goal: given a
  configuration + values, render the *resting* palette server-side into
  deterministic HTML and hydrate without mismatch. Non-goals: server-side
  drag/drop, timers, popups, command-box interactivity, `run()` side effects.
- **Wire snapshot** (SSR §3): point descriptors + virtuals + `SerializedLayout`
  + values + keys + editor registry/defaults + `configuration` numbers. No
  functions, no class instances, no DOM. Already JSON-safe: `SerializedLayout`
  (`version: 1`), `KeyBindings`, `EditorRegistry`/`EditorDefaults` (as long as
  nobody smuggles components in), `configuration` numbers (values, not the
  singleton). Not yet serializable: point definitions (`run` closure),
  stash aside slots (excluded by decision), custom point values (need codecs).
- **Key-shortcut rebuild rule (action points by name or inline):** key bindings
  are name-addressed strings (`KeyBindings`: `Record<Keystroke, string-spec>`);
  layout item specs are `PointTarget` (`string | VirtualPoint`): a string
  reference (`PointSpec`: `id`, `id=value`, `id:action`) or an inline virtual
  definition (`StashDefinition` / `EnumFromDefinition` carried directly in
  `ToolToolbarItem` / `SerializedToolbarItem` `tool`). Rebuild = serialized
  config (layout incl. inline definitions + `KeyBindings`, all JSON-safe) +
  points-list (descriptors + client-injected `run` runners + registered
  virtuals). `findKeystrokesFor` matches strings by `canonicalPointId`, so a
  key bound to `save`, `fontSize:inc`, `theme=dark`, a stash id, or
  `virtualId=key` keeps resolving after a serialize → rebuild round-trip;
  `findKeystrokesForTarget` additionally matches an inline target by its own
  `id` (`canonicalSpecId`). `fromServerDescriptor` rebinds `run` by action
  id; unknown ids throw at build time.
- **Already SSR-safe (keep it that way):** `identifiers`, `type`, `errors`,
  `specs`, `keys`, `layout` (pure data + pure math + sorted-key
  `stableStringify`), `virtual` (pure in→out, `Object.is`), `editors`
  (`editorChoicesFor` pure — but returns a list, not the single id Phase 5
  adds), `gap-dwell` (importing arms nothing — just never call `arm()` on the
  server), `globals` (only hatch, import-safe in Node, reachable only via
  listener-errors and `GapDwell`), `tsconfig` (`lib: ["ES2022"]`, no `DOM`).
- **Per-phase SSR obligations:**
  - Phase 2 (landed): `configuration` singleton stays process-wide mutable —
    Phase 7 pins it per-request; `GapDwell` timers go through the `globals.ts`
    hatch so the render path can exclude them by import graph.
  - Phase 3: lands `initialValues`/`setMany` + descriptors (the wire inputs).
  - Phase 4: builders stay pure over descriptors (entry list is client-only).
  - Phase 5: lands `resolveEditorVariant` + `axisForRegion` (variant
    eligibility must agree server/client).
  - Phase 6: CSS-neutral, same global selectors on server HTML.
  - Phase 7: implements the render model + pinning + codecs + hygiene + tests.
- **Open questions (decided, from SSR §8):** stash asides excluded; shared
  object values keep shared references; box shell SSR / entry list
  client-only; missing configuration → skeleton placeholder (SSR optional).
- **Lifecycle:** when Phase 7 lands, migrate its decisions to
  `docs/architecture.md` (new §22) and clear both this section and the
  completed items in `plans/ssr.md` per `AGENTS.md` (`plans/` → `docs/`).

## Context — how `plans/context.md` constrains these phases (normative)

> `plans/context.md` is the context-sensitive-tools spec; this section is the
> integration map. On any conflict, `context.md` wins on context semantics,
> mitosis wins on sequencing.

- **Scope:** `packages/core` first (bags, `uses`, nothing-points,
  functional `can`, pure resolvers), vanilla spike second, svelte/React
  parity after. Goal: tools that operate on host context (active file,
  selection) through optional bags — 1:1 tool→point always, context
  precedence resolved *inside* the point's resolvers, never by fanning one
  tool out to several points. Non-goals for core: DOM, runes, IDE bridge
  code (adapter-owned), frame timing / coalescing (adapter owns the
  dirty-set, §2.6).
- **Vocabulary (locked):** tool = 1:1 toolbar-bound control (one point id or
  one inline virtual definition — no multi-point, no multi-binding);
  point = value / action / **nothing** (new kind: context + optional `can`
  only; `getValue` → `undefined`, `setValue` throws, `reset` no-op,
  excluded from value serialization); bag = `ValuesBag` flat key/value store
  (`get` frozen / `set` / `setTree` one-notify / `asObject` / `subscribe` /
  `clearListeners`); `uses?: readonly ContextName[]` on the point
  (optional bags, `undefined` slot when unregistered, `''` = root);
  scope ≠ context (render-where vs operate-on-what, never merged).
- **Ownership (locked):** root bag `''` core-owned (hydrated / persisted /
  reset, the only bag core touches that way; `getValue`/`setValue` survive
  as root sugar); context bags host-owned via `setContext`/`removeContext`
  (replace-never-append lifecycle, §1.3); missing context → `undefined`
  slot → disabled + placeholder, never a render throw. Pointless tools
  become pointful 1:1 — `status` / `command-box` / `drawer` each bind a
  nothing-point whose `uses` names their context.
- **Data-flow rules every phase must respect:** bags read/write, no separate
  edit port (bridge is just another subscriber, adapter-side); param-array
  invocation in `uses` order (`run`/`can`/resolvers take
  `(ValuesBag | undefined)[]`, never throw on missing); no value-mirroring,
  no virtual chaining (context → derivation, one `setTree` → one notify,
  key-matched re-derive); scalar-write / non-scalar frozen-read
  (`Object.freeze` on `get`, `PaletteWriteError` on rejected bag writes,
  optimistic bridge revert via plain `set`); adapter dirty-set + rAF
  (core emits changed keys, adapter marks/flushes); `can` functional +
  `subscribeCan` flips-only (no polling, no render storms).
- **Per-phase Context obligations:**
  - Phase 2 (landed): no context work — but `GapDwell` timers already go
    through the `globals.ts` hatch and `configuration` stays a singleton,
    so neither blocks the bag channels.
  - Phase 3: lands `uses` stub + `setTree` + `PaletteWriteError` (readiness
    only — `can` stays static, bags unwired).
  - Phase 4: entries carry `uses`, filter at render (never build-time
    precompile); `consoleTool` stays a run point (nothing-point form in
    Phase 8).
  - Phase 5: presenters take `(boundValues, boundBags)`; context flows into
    drawer children.
  - Phase 6: CSS-neutral for context (disabled + placeholder states reuse
    existing selectors).
  - Phase 7: render input stays bag-extensible (no single-store
    assumption).
  - Phase 8: implements bags + `NothingPoint` + functional `can` +
    `context-display.ts` + vanilla spike + command-box pass (see Phase 8).
    Lands before 10 so the spike rides the parity demo work.
- **Lifecycle:** when Phase 8 lands, document the `uses` contract in
  `docs/core-concepts.md`, migrate context decisions to
  `docs/architecture.md` (new §24 — §22 SSR, §23 optimization), and retire `plans/context.md` per
  `AGENTS.md` (`plans/` → `docs/`).

## Non-goals / guardrails

- **Order is not negotiable**: additive first (`core` Phases 2–6, then
  SSR 7 + context 8 + optimization 9), parity second (same demo, same e2e suite — vanilla parity
  10, then vue parity 11), subtractive last (`svelte` depends on `core`, Phase 12).
  Do not start Phase 12 before Phase 11 is green.
- **`packages/svelte/src` is frozen during Phases 2–12 except Phase 12 itself.** It is the reference
  implementation and the oracle for parity; editing it early destroys the
  comparison. (Phases 7–11 are additive-only like Phases 2–5.)
- No new movement behaviour in this plan — the engine restart builds on core
  primitives (`plans/movement.md` stays the behaviour spec). Movement commits
  stay client-only and out of the SSR render path.
- No context behaviour before Phase 8 — Phases 3–5 land readiness stubs only
  (`uses`, `setTree`, `PaletteWriteError`); bags, nothing-points, and
  functional `can` wait for Phase 8 (`plans/context.md` stays the behaviour spec).
- No `*Model` / variant-factory layer (out of scope per `docs/architecture.md §5`).
- No `Snippet` in icon tokens (no runtime discriminator — wrap in a component).
- Keep `AGENTS.md` recipes: scratch work in `sandbox/`, read-only `git`.
- Core stays DOM-free and demo-free; every demo and every `HTMLElement`/
  `document` usage lives in `packages/vanilla` or `packages/svelte`.
