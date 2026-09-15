# Data owning — single source in core, consumer-owned defaults, adapter-owned bridge

Status: landed 2026-09-15 (core + vanilla demo; `packages/svelte/src` frozen per mitosis, untouched).

## 1. Overview

Problem today: ownership is split. Sometimes `core.values` is the source
(`initialValues` hydration, `core.run`, `core.values.subscribe`), sometimes
`demoState` is the source (`demo/palette.ts` `run()`/`can()` read/write
`demoState` directly, `resetColony()` writes only `demoState`,
`isColonyDirty()` diffs only `demoState`). `defaultValue` exists twice
(point definitions + `colonyDefaults`) and they can diverge.

Decision:

| Concern | Owner | Notes |
|---|---|---|
| Root value storage (`PaletteStateStore`, a.k.a. bag `ROOT_CONTEXT`) | `core` | Single source of truth. No defaults inside. Absent key = skeleton (`undefined`). |
| Domain defaults + reset intent | consumer (`demo`) | One defaults object. Reset = `setMany(CONSUMER_DEFAULTS)`. Dirty = diff vs `CONSUMER_DEFAULTS` (plan said "definitions" — corrected: diff is against the consumer defaults object). |
| Plain-object lens (`myValues.alertLevel` get/set) | adapter (`vanilla`) | New `createValueProxy()` bridge: proxy-set → `bag.set()`, bag-notify → proxy-target update. |
| Non-root bags | host via `core.setContext` / `removeContext` | Replace-never-append: only core's own forward is dropped (stored per name, `bagForwards`); host direct subscribers survive. Identity change emits `[]` = re-resolve everything for `name`, never replay old subscriptions. |
| Context re-evaluation | adapter via `subscribeContext` / `subscribeCan` | Key change (`changed` non-empty) → in-place `updateToolNode` for tools whose id moved; identity change (`[]` from set/remove) → `regionsUsingBag` border re-render. `head.ts:boundOf` + `ide.ts:toolLiveValue` resolve dual-source value (first non-root used bag holding the id wins, else root) and pass `bags` to presenters. |
| Root name | `core` exports `ROOT_CONTEXT` (`''` value, accepts `'root'` alias) | No bare `''` literals in adapters/demos after this. |

What this plan does NOT do:

- No `PaletteStateStore` in the adapter. The adapter never owns the store.
- No root-bag constructor argument. `initialValues` stays the one-shot SSR/hydration path (`validateInitialValues`, silent construction). The demo stops using it and uses live `setMany` + proxy instead.
- No `defaultValue` in `core` after this. SSR with `values: {}` renders skeletons (chrome from descriptors, `value: undefined`).

Strictness rule: `get(id)` stays lenient (absent → `undefined`, the skeleton probe). Strict paths throw on absent: `run` setter, `applyNamedAction` (`id:action`), `namedActionCan`, `runStash` source read. New `require(id)` helper for those.

Skeleton rule: `resolveRenderTree({ points, values: {} })` must render every tool (descriptor + editor + keystrokes, `value: undefined`). Presenters propagate `undefined` instead of coercing (`false` / `0` / `''`).

## 2. Changes

### A. Core types — drop `defaultValue`

- [x] `core/src/points.ts`: make `ValuedPoint.defaultValue` optional, then remove; `isValuedPoint` guards on `type` (`action`/`nothing` excluded), never on `'defaultValue' in point`.
- [x] `core/src/points.ts`: export `ROOT_CONTEXT` (`''`) + `isRootContext(name)` accepting `'' | 'root'`; replace doc mentions of bare `''` with the constant.
- [x] `core/src/palette.ts`: `fromServerDescriptor` no longer rejects a valued descriptor missing `defaultValue` (absent = skeleton tool).
- [x] `core/src/palette.ts`: `ServerValuedDescriptor` without `defaultValue`; `toServerDescriptor` unchanged (strips `run`/`can` only).
- [x] `core/src/virtual.ts`: `StashDefinition` gains `fallbackValue?: V`; update docblock (third branch writes `fallbackValue`, `undefined` = stay skeleton).
- [x] `core/src/virtual.ts`: `computeStashTransition(current, stashedValue, aside, fallbackValue)` — rename 4th param, no default import.

### B. Store — strict, no auto-fill

- [x] `core/src/store.ts`: constructor stops hydrating from definitions (starts empty; only `initialValues`/`setMany` fill it).
- [x] `core/src/store.ts`: delete `reset(def)` / `resetAll(definitions)` (consumer resets via `setMany`).
- [x] `core/src/store.ts`: add `has(id)` + `require(id)` (throw `PaletteError` on absent); keep `get(id)` lenient for render/skeleton.
- [x] `core/src/store.ts`: `set`/`setTree` semantics unchanged (`Object.is` no-op, snapshot-iteration, async re-throw).

### C. Core runtime — strict writes, consumer reset, stash fallback

- [x] `core/src/core.ts`: `getBag` / `resolveBags` / `setContext` / `removeContext` accept `ROOT_CONTEXT` + `'root'` alias; root still resolves to `this.values` (`setContext`/`removeContext` throw on the root name).
- [x] `core/src/core.ts`: `applyNamedAction` — absent current with no base throws (`PaletteError`) instead of `?? defaultValue`.
- [x] `core/src/core.ts`: `namedActionCan` — absent current throws (via `canRunAction`); no `?? defaultValue`.
- [x] `core/src/core.ts`: `runStash` passes `virtual.fallbackValue` (not `source.defaultValue`) into `computeStashTransition`.
- [x] `core/src/core.ts`: delete `resetAll()` (was store pass-through + stash-aside clear); keep aside clear inside `removeVirtual` / `defineVirtual` only.
- [x] `core/src/core.ts`: `initialValues` / `setMany` keep `validateInitialValues` strictness (unknown id / action id throw); docs updated (no "applied after defaults").

### D. Render + presenters — skeleton without values

- [x] `core/src/render.ts`: `resolvePointItem` keeps `value: values[pointId]` (`undefined` allowed); no default fallback.
- [x] `core/src/render.ts`: drop dummy `defaultValue: ''` family-points in `resolveInlineItem` / `resolveVirtualItem` (build family probe without `defaultValue` once A lands).
- [x] `core/src/presenters.ts`: `togglePresenter` propagates `undefined` pressed-state (no `=== true` → `false` coercion hiding skeleton).
- [x] `core/src/presenters.ts`: `sliderPresenter` propagates `undefined` value (no `0` fallback); `min`/`max`/`step` defaults from constraints stay.
- [x] `core/src/presenters.ts`: `selectPresenter` propagates `undefined` value (no `''` fallback).

### E. Adapter — `ValueProxy` bridge (new, adapter-owned)

- [x] `vanilla/src/value-proxy.ts` (new): `createValueProxy<T extends Record<string, unknown>>(bag, target?, onChange?)` — proxy-set calls `bag.set(key, value)`; bag subscribe writes through to `target` and notifies consumer callback; `Object.is` echo-loop guard both directions; returns `{ proxy, target, dispose, syncFromBag }` (superset of the planned `{ proxy, dispose }`: `target` exposes the backing object, `syncFromBag` forces a full pull, `onChange(key, value)` is the render callback).
- [x] `vanilla/src/value-proxy.ts`: unit tests — set-through, notify-through, unsubscribe-on-dispose, no echo loop.
- [x] `vanilla/src/index.ts`: export the bridge; no store, no `ValuesBag` subclass.

### F. Vanilla demo — single source via proxy

- [x] `vanilla/demo/palette.ts`: delete `colonyDefaults` as source; keep one consumer defaults object (`CONSUMER_DEFAULTS` + `COLONY_VALUE_KEYS` + `resetColonyValues()` + `isColonyDirtyValues()`) used only for `setMany` + dirty diff. Legacy `resetColony()` kept for the `resetSimulation` fallback path only.
- [x] `vanilla/demo/palette.ts`: action `run()`/`can()` stop touching `demoState` directly (read through the `demoLens` proxy / `resetViaCore`; `saveGame` only snapshots `{ ...demoState }` for `localStorage`, never writes it).
- [x] `vanilla/demo/main.ts`: stop passing `initialValues`; construct `PaletteCore` empty, then `core.setMany(CONSUMER_DEFAULTS)` + attach `createValueProxy(core.values, demoState)` lens.
- [x] `vanilla/demo/main.ts`: `resetColony` = `core.setMany(defaults)` via `bindResetViaCore` (not `Object.assign`); pills/grid/theme render from proxy subscribe (existing `core.values.subscribe(syncDemoState)` stays, pointed at proxy target). Ordering invariant (found during implementation): hydration must run BEFORE `createIDE` — the IDE renders tool DOM once at construction and only subscribes per-tool afterwards, so post-IDE `setMany` leaves skeleton DOM (empty selects, `min`-parked sliders).
- [x] `vanilla/demo/main.ts`: stash demo point (if any) declares `fallbackValue` explicitly — N/A: the demo has no stash point, nothing to declare.

### H. Context re-evaluation (landed 2026-09-15)

- [x] `core/src/core.ts`: `bagForwards: Map<name, Unsubscribe>` — `setContext`/`removeContext`/`dispose` drop only core's forward, never `bag.clearListeners()`.
- [x] `core/src/core.ts`: identity change emits `emitContext(name, [])`; key change emits `(name, changed)`.
- [x] `core/src/context.test.ts`: replace-keeps-host-listeners + identity-emits-`[]` cases.
- [x] `vanilla/src/head.ts`: `boundOf` resolves `uses` bags + dual-source value, passes `bags` to all presenters.
- [x] `vanilla/src/ide.ts`: `toolLiveValue` mirrors `boundOf`; `updateToolNode` passes `bags`; `bindTool` subscribes `subscribeContext` for `uses` points (identity `[]` or id in `changed` → update); global `subscribeContext` re-renders `regionsUsingBag(name)` borders on identity change; unsub on dispose.

### G. Tests + docs

- [x] `core/src/store.test.ts`: rewrite — empty start, `require` throws, deleted `reset`/`resetAll` cases removed.
- [x] `core/src/core.test.ts`: rewrite `resetAll` case (consumer `setMany` round-trip), stash fallback cases (with / without `fallbackValue`), strict `inc`/`dec` on absent value.
- [x] `core/src/palette.test.ts`, `render.test.ts`, `context.test.ts`, `virtual.test.ts`: drop `defaultValue` fixtures where they only served hydration; add `values: {}` skeleton case in `render.test.ts`. `context.test.ts` also gains root-alias + root-throw cases.
- [x] `docs/core-concepts.md` (`uses` contract: root bag `ROOT_CONTEXT`, no defaults; ownership table + strictness + skeleton rules) + `docs/architecture.md` (module inventory + new Data-owning section, Phase 8 registry correction).
- [ ] Delete this file per `AGENTS.md` once green (migrate permanent rules to `docs/` first) — pending owner decision.

## 3. Verification

- [x] `pnpm --filter @palettable/core check|build|test` — green (251 tests).
- [x] `pnpm --filter @palettable/vanilla check|build|test` — green (40 tests).
- [x] `npx biome check packages/core packages/vanilla` — clean.
- [ ] `pnpm test:e2e` (vanilla demo parity unchanged — same DOM, new data path) — 34/35 on 2026-09-15; the single failure (`drag-highlight` vanilla) is pre-existing (fails identically on the clean tree, svelte passes). Note: a stale `:4174` vite dev server in another terminal serves pre-plan `presenters.ts` and inflates failures — kill it before e2e (Playwright starts its own servers).

