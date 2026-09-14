# SSR — render a palette server-side from configuration + values

> Status: **analysis only, no implementation.** Scope is `packages/core`
> (not `packages/vanilla`, not `packages/svelte`): what must be abstracted in
> the core so that, given a configuration + values, a palette can be rendered
> on the server into deterministic HTML and hydrated on the client without
> mismatch. Permanent decisions, once implemented, move to `docs/architecture.md`;
> this file tracks the analysis + TODOs.

## 1. What "SSR" means here

- **Input (wire):** a JSON-safe snapshot = point descriptors + virtuals +
  layout (`SerializedLayout`) + values (`Record<string, unknown>`) + keys +
  editor registry/defaults + `configuration` numbers. No functions, no class
  instances, no DOM.
- **Server pass:** build a `PaletteCore` (or lighter read-only facade) from
  that snapshot in Node (no `document`, no `window`, no timers firing), walk
  layout + definitions + values through a **pure, synchronous** resolution
  into a render tree, hand it to the adapter for HTML string output.
- **Client pass (hydration):** rebuild the same core state from the same
  snapshot, attach listeners/components, take over interactivity. First client
  render must be byte-identical to the server HTML.
- **Non-goals:** server-side drag/drop, timers, popups, command-box
  interactivity, `run()` side effects. The server renders the *resting* palette
  only.

## 2. Good news: the core is already ~90% SSR-safe

Module-by-module audit (`packages/core/src/`):

| Module | Verdict | Notes |
| --- | --- | --- |
| `identifiers.ts`, `type.ts`, `errors.ts`, `specs.ts`, `keys.ts` | ✅ safe | Types + pure string parsing + headless key lookup. No host APIs. |
| `points.ts` | ⚠️ shape, not logic | Guards are pure, but `ActionPoint.run` is a closure — not serializable (see §4.1). |
| `store.ts` | ✅ logic safe, ⚠️ constructor | `Map` + `Object.is` + snapshot iteration are deterministic; `scheduleMicrotask` only fires on throwing listeners (none on server). But there is **no way to inject values** — the constructor hydrates from defaults only. |
| `layout.ts` | ✅ safe | `PaletteLayoutTree` is pure data; `SerializedLayout` (`version: 1`) is JSON-safe; track-space math is pure; `emit()` microtask only fires on throwing listeners. `stableStringify` already sorts keys (deterministic fingerprints). |
| `virtual.ts` | ✅ safe | `enum-from` / `stash` helpers are pure values-in→values-out, `Object.is` matching. |
| `editors.ts` | ✅ safe, ⚠️ incomplete | `editorChoicesFor` is pure, registry is plain data. But it returns a *choice list*, not the single resolved variant — adapters pick `selected` themselves. |
| `configuration.ts` | ⚠️ global mutable singleton | Plain data (good), but process-wide mutable: concurrent SSR requests can pollute each other (see §4.5). |
| `gap-dwell.ts` | ✅ separable | Timer only arms when `arm()` is called; importing it arms nothing. SSR render path must simply never call it. |
| `globals.ts` | ✅ contained | The **only** host escape hatch (`queueMicrotask`/`setTimeout` via `globalThis`, per-call resolution). Exists in Node, so import-safe; only reachable via listener-errors and `GapDwell`. |
| `core.ts` (`PaletteCore`) | ⚠️ two gaps | No `initialValues` option (§4.2); no read-only/atomic snapshot for render (§4.3). `run()` awaits user closures — must never run on server (currently true by construction, but unenforced). |
| `umd.ts` | ❌ server-hostile | Side effect on import (`globalThis.palettable = barrel`). SSR must use `index.mjs`/`index.cjs`, never the UMD bundle. |
| `tsconfig.json` | ✅ gate | `lib: ["ES2022"]`, no `DOM` — the "zero DOM" rule is compiler-enforced. Keep; add an SSR import test (§6). |

Grep-verified: zero `window`/`document`/`localStorage`/`requestAnimationFrame`/
`performance.now`/`Date.now`/`Math.random`/`crypto`/`navigator`/`matchMedia`/
`ResizeObserver` hits in `core/src` outside comments and the `globals.ts` hatch.

## 3. The wire format: what "configuration + values" must be

Today only **part** of it is JSON-safe:

- ✅ `SerializedLayout` — JSON-safe, versioned (`version: 1`). Flat slot list per region; hydration wraps each slot in its own single-slot track.
- ✅ `KeyBindings` (`Record<Keystroke, string>`) — JSON-safe.
- ✅ `EditorRegistry` / `EditorDefaults` — plain data (`id`, `label`, `families`, `supportedAxes`, …). JSON-safe as long as nobody smuggles components in (core never does; adapters must not persist their component map).
- ✅ `configuration` numbers — JSON-safe values, but carried as a live singleton, not as part of the snapshot.
- ✅ `asObject()` values — plain object, but **by reference** and **defaults-only on construction** (no rehydration path).
- ❌ **Point definitions** — not serializable: `ActionPoint.run: () => void | Promise<void>` is a closure. Constraints for built-ins are JSON-safe, but custom `TypeConstraints` (declaration merging) may hold anything.
- ❌ **Stash aside slots** (`stashAsides`) — ephemeral `Map`, deliberately excluded from `asObject()`. Rendering a stash button needs only `current vs stashedValue` (pressed state), not the aside — but this exclusion is undocumented and could silently diverge if a future editor displays the aside.
- ⚠️ **Custom point values** — built-ins (`boolean`/`number`/`string`/`enum`) are JSON-safe; custom `TypeMap` entries (e.g. `color: string` fine, `date: Date` not) are unconstrained.

## 4. Blockers → required abstractions

### 4.1 Serializable point descriptors vs runtime bindings

**Problem.** The server cannot receive `run()` closures over the wire, and
some actions need browser APIs that don't exist on the server at all. Today
`PaletteCore` takes `readonly AnyPoint[]` with `run` required for actions —
there is no describe-without-bind step.

**Abstract:** split the point shape into two layers (names illustrative):

- `ServerPointDescriptor` — JSON-safe: everything except `run` (`id`, `label`,
  `type`, `defaultValue`, `constraints`, `can?`, metadata). Action points carry
  `can?` + label/icon only.
- Runtime binding — the existing `AnyPoint[]` with `run`, injected **only on
  the client** (or on a server that explicitly opts into running actions,
  which SSR render never does).

Core owns the descriptor type + `toServerDescriptor(points)` / `fromServerDescriptor(descs, runners)` helpers + validation that descriptors round-trip (`JSON.parse(JSON.stringify())` stable). Rendering needs only the descriptor; `run()` is unreachable from the render path by construction.

Constraint payloads for SSR must be JSON-safe: document that custom
`TypeConstraints` entries participating in SSR must be `JSON.stringify`-stable
(or provide a per-type codec — see §4.6).

### 4.2 Value hydration (`initialValues`)

**Problem.** `new PaletteStateStore(definitions)` hydrates from defaults;
`PaletteCoreOptions` has `keys`/`editors`/`editorDefaults`/`initialLayout`/
`virtuals` but **no values**. There is no way to build the server state
"configuration + values" — only "configuration + defaults".

**Abstract:** `initialValues?: Readonly<Record<string, unknown>>` on
`PaletteCoreOptions` (and/or `PaletteStateStore`), applied after defaults,
validated per point (`unknown id` → throw at build time, `action` id → throw,
`Object.is`-equal → skip notify), with **zero listener notifications during
construction** (listeners attach after). Plus a `setMany()` / `replaceAll()`
sibling for client hydration from the server snapshot — ideally silent
(single emit or none) rather than N per-key notifies.

### 4.3 Pure render model (the main missing piece)

**Problem.** Nothing in the core answers "what do I render for this item?"
in one place. Adapters today compose it themselves: `getDefinition()` +
`getValue()` + `editorChoicesFor()` + `findKeystrokesFor()` + `isDrawerItem()`
+ manual `editor ?? fallback` + manual region→axis mapping. Two adapters
(and a server renderer) reimplementing that composition **will** diverge.

**Abstract:** a pure, synchronous, allocation-explicit resolver in the core,
e.g. `resolveRenderTree(core, { axisFor }) -> ResolvedPalette` (name TBD):

- input: definitions + virtuals + layout snapshot + values snapshot (taken once — see §4.4);
- per item output: canonical point id (`canonicalPointId`), point descriptor (or `undefined` for pointless), current value / enum-from key / stash pressed-state, **single resolved editor variant id** (canonical fallback chain, replacing the ad-hoc `currentEditor ?? fallback ?? list[0]`), editor capabilities, keystrokes, drawer children (recursive, depth-bounded);
- guarantees: no subscriptions, no timers, no `run()`, no `set()`, no DOM; same input → `JSON.stringify`-identical output (test it).

This is also where the two adapter-owned rules that affect *which* variant is
eligible must move into the core, or server/client will disagree:

- **region → axis mapping** (`top`/`bottom` → `horizontal`, …) — currently adapter code; core needs `axisForRegion()` (and the drawer perpendicular-axis rule, currently "enforced by adapters, opaque to the core").
- **editor fallback chain** — currently `editorChoicesFor` returns choices and each adapter picks `selected`; core must own `resolveEditorVariant(item, point, surface, registry, defaults)` returning exactly one id (plus the choice list for the config surface, which is client-only).

Command-box entry builders (when ported to core per `plans/mitosis.md`) must follow the same rule: pure builders over descriptors, no closures in the SSR path.

### 4.4 Atomic snapshot (anti-tear)

**Problem.** Render reads layout (`getSnapshot()`) and values (`asObject()`)
through two separate calls. A concurrent `set()` between them tears the
render (layout from t₀, values from t₁). Single-threaded SSR with no
concurrent writes is safe in practice, but the API doesn't make that
contract explicit.

**Abstract:** one `snapshotPalette(): { layout: SerializedLayout; values: Record<string, unknown>; virtuals… }` (or make `resolveRenderTree` take its own internally-consistent snapshot). Document: values are by reference (like `asObject()` today) — the adapter must `structuredClone`/serialize before crossing the wire; core must never mutate a snapshot it handed out (it doesn't — `getLayout`/`getSnapshot` deep-clone; keep that invariant for the new API).

### 4.5 Configuration scoping (mutable singleton)

**Problem.** `configuration` is a process-wide mutable object with live
lookup (`stackDzHoverMs`, `drawerHoverCloseMs`, `trackGapSplit`,
`trackGapMinGrow`). One SSR request tuning it affects all concurrent
requests; server/client can also disagree silently.

**Abstract (pick one, in order of preference):**

1. **Snapshot + inject:** freeze the four numbers into the wire snapshot; core resolution takes them as an argument (defaulting to the singleton for back-compat). Render math (`actualTrackSpaceAt`, `insertToolbar` split, gap floors) already takes values as parameters except the dwell timeout — thread it through.
2. **Per-request override scope:** `withConfiguration(overrides, fn)` (or an options field on the resolver) that restores after render. Weaker than (1) — still global under the hood.
3. **Document-and-freeze:** declare `configuration` client-only tuning, server always uses defaults, and assert equality in the hydration check. Cheapest, but bakes in a divergence footgun.

Note: only `trackGapSplit`/`trackGapMinGrow` affect resting layout geometry;
the two `…Ms` timeouts never affect SSR output (no timers run) — but they
must still be pinned in the snapshot if the hydration check compares configs.

### 4.6 Custom-type value codecs

**Problem.** Built-in values are JSON-safe; custom `TypeMap` values are not
constrained. A `Date`/`Map`/class-instance value renders on the server,
`JSON.stringify`s into something else, and hydrates into a mismatch.

**Abstract:** per-type `ValueCodec<T> { serialize(value: T): Json; deserialize(json: Json): T }` registry (default: identity for JSON-safe built-ins). The wire snapshot carries only serialized values; core validates on hydrate. Out of scope for phase 1 if custom types are declared SSR-unsafe by default (fail loudly, not silently).

### 4.7 Host-timers policy for SSR (keep, don't extend)

`globals.ts` stays the **only** host import. Rules to lock in:

- The SSR render path (`resolveRenderTree` + everything it calls) must not import `globals.ts` or `gap-dwell.ts` — enforce with an import-graph test (or a dedicated `render.ts` module that only imports the pure modules).
- `GapDwell` instances are client-only (adapters construct them post-hydration). No `NoopHost` abstraction needed as long as the render path never touches timers — adding a DI layer for two call sites would be over-engineering.
- `scheduleMicrotask` re-throw semantics stay as-is; SSR attaches no listeners so it never fires.

### 4.8 UMD side effect

`umd.ts` writes `globalThis.palettable` on import. Ban it from the server
bundle (document: SSR uses `dist/index.mjs` / `dist/index.cjs`), and consider
a build-time guard (e.g. UMD entry excluded from `exports` for `node`
conditions, or a lint rule against importing `umd.ts` outside the UMD build).

## 5. Determinism checklist (server ≡ client)

Already true in core — lock each with a test:

- [ ] No `Math.random`/`Date.now`/iteration-order dependence (grep test).
- [ ] `Map` iteration follows construction order = descriptor array order (server must preserve array order through JSON — arrays, not objects).
- [ ] `EditorRegistry` `Object.values()` order = insertion order — JSON round-trip of the registry must preserve it, or sort capabilities by `id` before picking the fallback.
- [ ] `stableStringify` key-sorting kept for any new hashed output.
- [ ] `defaultLayoutFromPoints` order = points order.
- [ ] `SerializedLayout` `version: 1` checked on hydrate (reject unknown versions loudly).
- [ ] Stash aside slots excluded from the snapshot **by documented decision** (§3); if ever included, version the snapshot.

## 6. Test plan (all in `core`, no DOM, no jsdom)

1. **Node-only import test:** `import '@palettable/core'` under plain Node (no jsdom, no `document`); construct `PaletteCore` from descriptors + `initialValues` + `SerializedLayout`; assert no `setTimeout`/`queueMicrotask` calls (spy `globals.ts`) during build + resolve.
2. **Golden render-model test:** fixed descriptors + values + layout → `resolveRenderTree()` → snapshot file; byte-identical across runs and across `JSON.parse(JSON.stringify(snapshot))` round-trip.
3. **Hydration round-trip test:** server snapshot → serialize → client `PaletteCore` → `resolveRenderTree()` → identical output; `getSnapshot()`/`asObject()` equal server copies.
4. **Action isolation test:** action points without `run` render (label/icon/disabled); resolving never calls `run` (throwing stub would fail the test if invoked).
5. **Config-pinning test:** mutated `configuration` singleton does not change `resolveRenderTree(snapshotWithConfig)` output.
6. **Import-graph test:** SSR render module transitively imports neither `globals.ts` nor `gap-dwell.ts` nor `umd.ts`.

## 7. Sequenced TODOs

- [ ] 1. `initialValues` on `PaletteCoreOptions`/`PaletteStateStore` (silent at construction) + `setMany` for hydration.
- [ ] 2. `ServerPointDescriptor` type + `toServerDescriptor`/`fromServerDescriptor` + round-trip validation; document JSON-safe constraint rule for custom types.
- [ ] 3. `axisForRegion()` + drawer perpendicular rule in core (move from adapters).
- [ ] 4. `resolveEditorVariant()` (single id) alongside `editorChoicesFor()` (config-surface list); document the fallback chain once.
- [ ] 5. `resolveRenderTree()` pure resolver (+ `snapshotPalette()` atomic snapshot); import-graph test vs `globals`/`gap-dwell`/`umd`.
- [ ] 6. Configuration pinning: thread numbers through the resolver (preferred) or `withConfiguration` scope; include in wire snapshot.
- [ ] 7. `ValueCodec` registry for custom types (or explicit SSR-unsafe-by-default with loud failure).
- [ ] 8. UMD/server-bundle hygiene doc + `version: 1` rejection test + determinism tests (§5).
- [ ] 9. Migrate decisions to `docs/architecture.md`; remove this file's completed items per `AGENTS.md` (`plans/` → `docs/` lifecycle).

## 8. Open questions

- Should the server snapshot include stash aside slots (full fidelity) or exclude them (simpler; current recommendation: exclude, document)?
- `values` by reference vs deep-clone on snapshot: keep by-reference + adapter clones, or core clones (safer wire, costs perf)?
- Is the command-box part of SSR output (static entry list) or client-only? Recommendation: client-only in phase 1; its builders must still be pure when ported.
- Do we need per-request `configuration` overrides in practice, or is freeze-at-defaults (§4.5 option 3) enough for v1?
