# Context-sensitive tools — specification

> Status: **specification complete (amended).** Correction applied: 1:1
> tool→point, `needs` renamed to `uses` (optional bags), functional `can`.
> Implementation starts with `core/context.ts`.

## 1. Vocabulary & ownership

### 1.1 Core terms

- **Tool** — toolbar-bound control: layout position + editor variant + config
  payload (e.g. an enum rendered as drop-down or button-list). A tool refers
  to **one and only one point**: `ToolToolbarItem.tool` resolves to a single
  point id (or inline virtual definition). There is no multi-point tool and
  no multi-binding tool — context precedence (e.g. bold) is resolved *inside*
  the point's resolvers, never by fanning one tool out to several points.
- **Point** — answers "is it bold?" and declares **what it operates on**. The
  context list is specified on the point as `uses?: readonly ContextName[]`
  (renamed from `needs`: entries are optional, so "need" overstated the
  contract). Each name resolves to `ValuesBag | undefined` — `undefined`
  when the bag is not registered. A point with no `uses` reads/writes the
  root bag; a point with `uses: ['activeFile']` additionally receives that
  bag (or `undefined` when absent) in `run` / `can` / display resolvers.
- **Bag** (`ValuesBag`, in `core/context.ts`) — flat, named key/value storage
  with `get` / `set` / `setTree` / `subscribe` / `asObject` / `clearListeners`.
  The `setTree` contract: apply all pairs, collect `Object.is`-changed keys,
  notify once with `(changedKeys[])`. The root bag `''` wraps the existing
  `PaletteStateStore` generalized to the `ValuesBag` interface; non-root bags
  start empty.
- **Scope ≠ context.** `PaletteScope` says *where* an item renders; `uses`
  says *what* it operates on. Separate channels, never merged.

### 1.2 Point kinds

Points are **value** / **action** / **nothing** (three kinds, same as today
plus the new nothing-point):

- **Valued point** — carries `defaultValue`, optional `constraints`, optional
  functional `can(...bags)`. Type guard `isValuedPoint` (existing). A valued
  point can be enabled/disabled by context change (e.g. bold disabled when no
  file is active) — see §2.8 for the `can`-change notification.
- **Action point** — carries `run(...bags)`, optional functional
  `can(...bags)`. Type guard `isActionPoint` (existing). `can` is not a
  static boolean property: it is called with the point's resolved
  property-bags as arguments (each `ValuesBag | undefined`, in `uses` order).
- **Nothing-point** — carries only context plus optional enablement:
  `{ type: 'nothing', id, label, uses, can? }`. No `defaultValue`, no
  `constraints`, no `run` of its own. New type guard `isNothingPoint`; both
  `isValuedPoint` and `isActionPoint` return `false` for it. Its `can(...bags)`
  follows the same functional contract as §2.8 (omitted = enabled).

This is how **pointless tools become pointful**: `status`, `command-box`, and
`drawer` each bind a nothing-point whose `uses` names the context they display
or operate on (still 1:1 — one tool, one nothing-point):

- A **status** binds a nothing-point with `uses: ['activeFile']` — it reads
  `bag?.get('fileName')` or similar to render, never writes.
- A **command-box** binds a nothing-point. A command is a tool on a
  nothing-point with global context (`uses: []` or `undefined` = always
  present, no bag subscription). The renderer filters entries by their `uses`
  against current bags (§2.7).
- A **drawer** binds a nothing-point and renders a nested toolbar; context
  flows down to child tools.

Core semantics on a nothing-point: `getValue` returns `undefined`, `setValue`
throws `PaletteError`, `reset` is a no-op, and nothing-point bindings are
excluded from layout value serialization (only the binding itself serializes).

### 1.3 Bag ownership

Two-tier ownership with clear lifecycle boundaries:

- **Root bag `''`** is **core-owned**. `PaletteCore` creates it internally
  (wrapping a `PaletteStateStore` generalized to the `ValuesBag` interface),
  hydrates it from valued-point defaults at construction, and runs `reset()` /
  `resetAll()` / persistence against it. It is the *only* bag core hydrates or
  persists. `PaletteCore.getValue` / `setValue` survive as root-bag sugar.
- **Context bags** are **host-owned**. The host application (IDE, editor)
  creates, populates, and disposes them independently. They are registered with
  core via `palette.setContext(name, bagInstance)`. Core never hydrates
  defaults for them, never resets them, and never persists them.

  **`setContext` lifecycle** (replaces, never appends):
  1. If a bag is already registered under `name`, its internal subscription
     into core is cleared (core calls `oldBag.clearListeners()`).
  2. The new bag is stored in the registry.
  3. Core subscribes to the new bag's global listener to forward changed-key
     arrays to `subscribeContext` consumers.
  4. Tools whose point `uses` include `name` re-derive against the new bag
     (re-resolve bags, re-evaluate `can`, re-run display resolvers with the
     new bag instance).

  **`removeContext` lifecycle**:
  1. Core unsubscribes from the bag (calls `bag.clearListeners()`).
  2. The bag is dropped from the registry.
  3. Tools whose point `uses` include `name` re-derive with `undefined` in
     that slot and fall back to disabled + placeholder unless their `can` /
     resolvers define otherwise (deterministic fallback per §2.3 — never a
     throw in render).

  A **missing context** (bag never registered, or removed) resolves to
  `undefined` in that `uses` slot. The default render is disabled with a
  placeholder; a point's `can` / resolvers may define a richer fallback,
  but render never throws.

### 1.4 Typed bindings

```ts
type ContextName = string           // 'activeFile', …; '' = root (palette.values)
type PointBase = {
	...
  readonly uses?: readonly ContextName[]
}

// context list (on the point definition): uses?: readonly ContextName[]
//   undefined uses = no extra context (root value via getValue/setValue as today)
// each name resolves to ValuesBag | undefined (undefined = bag not registered)
// run signature: run(...bags: readonly (ValuesBag | undefined)[]) in uses order
// can signature (action AND valued points): can(...bags: readonly (ValuesBag | undefined)[]) => boolean
// display resolvers: resolveX(boundValues: readonly unknown[], boundBags: readonly (ValuesBag | undefined)[])
```

## 2. Data flow

### 2.1 Bags are read/write — no separate edit port

`run` receives the used bags writable (`run(...bags)` — param-array in
`uses` order, each `ValuesBag | undefined`, see §2.2) and writes with
`bag?.set()` / `bag?.setTree()` (guarding `undefined` = bag absent). The host
bridge subscribes to host-owned bags and propagates writes to the IDE. There is
no separate "edit" channel — a write is a write, and the bridge is just another
subscriber that happens to reach out to the IDE.

The bridge lives in adapter code, **never in core**. Core stays headless: zero
DOM, zero runes, zero `KeyboardEvent`, zero framework imports (same rule as
`store.ts` / `virtual.ts` — enforced by `tsconfig.json` `lib: ["ES2022"]` with
no `DOM`).

### 2.2 Param-array invocation (optional bags)

`uses` order defines the parameter order for `run`, `can`, and display
resolvers. Each slot resolves to `ValuesBag | undefined`:

- An action point with `uses: ['', 'activeFile']` has
  `run(rootBag, activeFileBag | undefined)` and
  `can(rootBag, activeFileBag | undefined)`.
- Display resolvers receive aligned `(boundValues[], boundBags[])` in `uses`
  order, with `undefined` for any unregistered bag.
- `undefined` uses (or `[]`) = no context dependency: `run()` / `can()` take
  no bag arguments. `''` may appear explicitly in `uses` to receive the root
  bag as an argument (e.g. `uses: ['', 'activeFile']` → `run(rootBag,
  activeFileBag)`); valued-point value access always stays on the root bag
  via the existing `getValue` / `setValue` sugar regardless of `uses` —
  `uses` only controls which bags are passed to `run` / `can` / resolvers.
- Render never throws on a missing bag: resolvers and `can` must treat
  `undefined` as "context absent" and fall back (disabled + placeholder
  unless they define otherwise).

**Dual `run` path** — the existing `PaletteCore.run(spec: string)` survives as
root-bag sugar. It parses `"bold=true"` via `parsePointSpec` and writes the
root bag (existing behavior, unchanged). The new context-aware path is a
*different entry point*: the adapter resolves the point's `uses` from the
registry and calls `point.run(...bags)` directly — core provides
`resolveBags(uses): (ValuesBag | undefined)[]` as a helper for this (never
throws on a missing bag; that slot is `undefined`). The two paths are
separate and do not interfere.

**Bold example (1:1)** — one tool → one `bold` point with
`uses: ['', 'textSelection']`. A precedence resolver derives display from the
`textSelection` bag when present (selection present → selection boldness), else
from the root-bag value (caret mode / global default). Never two buttons,
never two points for one tool.

### 2.3 No value-mirroring, no virtual chaining

Context changes never appear as value-store notifications. Display follows
context through **derivation**, not through a store write. No context-as-point,
no virtual chaining.

- One `setTree` commit → one notify with changed keys.
- Subscriptions are per-key within a bag plus whole-bag; only tools whose
  point `uses` that bag *and* whose observed keys intersect the changed keys
  re-derive (plus a `can` re-evaluation — see §2.8).
- Missing context → deterministic fallback (disabled + placeholder, never a
  throw in render).

### 2.4 Scalar write / non-scalar read-only

`ValuesBag.get()` returns `Object.freeze()`-wrapped values at runtime.
Primitives (`string`, `number`, `boolean`) are immune to `Object.freeze()` —
zero overhead. `TypeScript` readonly utility types reinforce at the type level.

Mutating a frozen object returned by `get()` throws the engine's own
`TypeError` in strict mode. Rejected writes through the bag API itself
(`set()` on a frozen value, write to a locked host-bound bag) throw
`PaletteWriteError`.

`TypeMap` extensions (custom `color`, `date`, … via declaration merging in
`type.ts`) compose naturally — `ValuesBag<Shape>` is generic over the shape, and
`TypeMap` lives at the point-definition level, not inside the bag.

No changes needed in `virtual.ts` — `VirtualEnumOption<V>` and
`StashDefinition<V>` already carry their own generic type parameter `V` and
treat values opaquely.

### 2.5 Write-failure reporting

Two distinct paths, separated by the sync/async boundary:

| Failure mode | Sync/async | Mechanism |
|---|---|---|
| Mutating a frozen non-scalar | Sync | Engine `TypeError` (strict mode) |
| Writing to a nothing-point | Sync | `setValue` throws `PaletteError` |
| Write rejected by the bag (locked / frozen value) | Sync | `ValuesBag.set` throws `PaletteWriteError` |
| IDE rejects write (read-only file, stale version) | Async | Host bridge optimistic-reverts via `bag.set` |

`PaletteWriteError extends PaletteError` — the adapter catches it to surface
error feedback or revert a local optimistic UI update. It never signals the
async case, which is not an error at all.

Write propagation for context bags is always **optimistic**: `bag.set('isDirty',
false)` updates the bag immediately; if the IDE rejects, the bridge reverts by
calling `bag.set('isDirty', true)`. The revert is just another `set()` call —
no throw, no promise, no separate error channel.

### 2.6 Adapter reactivity: dirty-set + rAF

Core emits the exact array of changed keys per notification
(`subscribe(listener: (changed: readonly string[]) => void)`). The adapter's
rAF loop uses those changed keys to mark per-tool dirty flags locally.

Core is agnostic to:
- Rendering granularity (per-tool, per-row, per-toolbar — adapter decides).
- Frame timing (`requestAnimationFrame` vs `tick()` vs React batching).
- Coalescing across value + context + layout notifies in one frame (adapter owns
  the dirty-set, adapter decides when to flush).

```text
host (IDE)                  core (headless)                  adapter (vanilla/svelte/react)
──────────                  ─────────────────                  ─────────────────────────────
push bag ──► ValuesBag ──► key-matched notify ──► mark dirty ──► refresh (rAF)
   ▲              │                       │
   └── bridge ◄───┴── run writes bag ─────┘
```

Bridge code (IDE push + write propagation) lives in adapter code that touches
the IDE, **never in core**. Core owns bag storage, key matching, and pure
derivation helpers — zero DOM, zero runes (same rule as `store.ts` /
`virtual.ts`).

**Implementation order**: vanilla spike first; svelte specifics deferred (that
adapter will change first). Vanilla proves the pattern works with the simplest
possible substrate; svelte/React follow.

### 2.7 Command-box

Entries carry `uses`; the renderer filters and resolves labels dynamically
during the render pass. No build-time precompilation. Render-time filtering
handles dynamic context (variable file names, selection text) correctly.

A command is a tool on a nothing-point with global context (`uses: []` or
`undefined` = always present, no bag subscription). Each entry's `can(...bags)`
and label resolvers receive `(ValuesBag | undefined)` per used name — an entry
whose `uses` names an unregistered context gets `undefined` in that slot and
decides itself (hidden, disabled, or fallback label). The renderer may
additionally pre-filter entries whose `can()` returns `false` with all bags
absent.

### 2.8 Enablement (`can`) is functional + `can`-change event

`can` exists on **both** action and valued points and is always called with
the resolved property-bags:

```ts
can(...bags: readonly (ValuesBag | undefined)[]): boolean
type CanListener = (pointId: string, can: boolean) => void
```

- Omitted `can` = always enabled (back-compat with today's static `can?: boolean`).
- `can` must be pure and cheap: it runs on every context notify for points
  using that bag, plus on demand via `evaluateCan(pointId)`.
- Valued-point example: `bold.can(activeFileBag)` returns `false` when the
  bag is absent or the file is read-only → the toggle renders disabled
  without losing its value.

**`can`-change notification.** Context notifies carry changed *keys*, not
enablement flips, so core adds a derived channel:

- `subscribeCan(listener)` — fired only when a context-bag change flips
  `evaluateCan(pointId)` for a point the adapter observes (adapter registers
  observed point ids; core diffs before/after per notify and emits only
  flips — no render storms).
- Adapter behavior on flip: mark the tool dirty (same dirty-set as §2.6),
  refresh enablement in the next frame. Value subscriptions are untouched —
  `can` flips never write the store.
- Alternative considered and rejected: polling `evaluateCan` per frame with
  no event — correct but forces adapters to re-evaluate every tool every
  frame. The flip-event keeps per-frame work to the dirty set.

## 3. Typing — `ValuesBag<Shape>`

Bags are generic — `ValuesBag<Shape>` with typed `get()`. Core uses `unknown`
only where the shape is genuinely unknown, never `any` as a convenience.

```ts
type ContextName = string // 'activeFile', …; '' = root (palette.values)

interface ValuesBag<Shape extends Record<string, unknown> = Record<string, unknown>> {
  /** Read a key. Returns frozen snapshot for non-scalars. */
  get<K extends keyof Shape>(key: K): Shape[K] | undefined
  /** Write a key (no-op when Object.is-equal). Notifies subscribers. */
  set<K extends keyof Shape>(key: K, value: Shape[K]): void
  /** Apply a batch of changes in one transaction; one notify with changed keys. */
  setTree(patch: Partial<Shape>): void
  /** Fresh plain-object snapshot (values are frozen references). */
  asObject(): { readonly [K in keyof Shape]?: Shape[K] }
  /** Global subscription: invoked with the array of changed keys. */
  subscribe(listener: (changed: readonly (keyof Shape & string)[]) => void): Unsubscribe
  /** Per-key subscription. */
  subscribe<K extends keyof Shape>(key: K, listener: (value: Shape[K] | undefined) => void): Unsubscribe
  /** Drop all listeners (adapter / core teardown). Values are kept. */
  clearListeners(): void
}
```

`PaletteCore` owns the bag registry (root `''` included) and exposes:

```ts
class PaletteCore {
  // …existing members…

  /** Register a host-owned context bag. Replaces any bag already under this name. */
  setContext(name: ContextName, bag: ValuesBag): void
  /** Remove a context bag. Tools using it re-derive with undefined in that slot. */
  removeContext(name: ContextName): void
  /** Get a bag by name (root `''` included). Returns undefined for unknown names. */
  getBag(name: ContextName): ValuesBag | undefined
  /** Resolve used bags for a point's uses (for adapters calling point.run / point.can). Never throws: missing bags resolve to undefined. */
  resolveBags(uses: readonly ContextName[]): (ValuesBag | undefined)[]
  /** Evaluate a point's enablement with currently-registered bags (missing → undefined). */
  evaluateCan(pointId: string): boolean

  /** Subscribe to context-bag changes (global, across all bags). */
  subscribeContext(listener: ContextListener): Unsubscribe
  /** Subscribe to enablement flips. Fired when a context change flips evaluateCan(pointId) for an observed point (see §2.8). */
  subscribeCan(listener: CanListener): Unsubscribe
  // …existing subscribe / subscribeLayout / dispose…
}
```

`dispose()` clears all listener sets: root bag listeners + layout listeners.
Context bags are host-disposed; core only unsubscribes its internal listeners
from them.

## 4. Implementation steps

- [ ] **1. `setTree` on `PaletteStateStore`** — add `setTree(patch)` that
  applies all pairs, collects `Object.is`-changed keys, and notifies once with
  the changed-key array. The existing `set()` and `notify()` stay unchanged;
  `setTree` calls into the same `notify` internals but debounces to a single
  notification. This is the foundation primitive: Q1 (freeze), Q4 (dirty-set),
  and `ValuesBag` all depend on it. Tests in `store.test.ts`.

- [ ] **2. `core/context.ts`** — `ValuesBag` class. Backed by the same
  `Map<string, unknown>` + `Object.is` dedup + snapshot-iteration + async error
  re-throw as `PaletteStateStore` today. New: `get()` calls `Object.freeze()`
  on returned values (no-op for primitives); `setTree` applies all pairs,
  collects changed keys, notifies once with `(changedKeys[])`; global subscribe
  signature changes to `(changed: readonly string[]) => void`. Tests mirror
  `store.test.ts` style: file-swap fixture asserting one notify, per-key
  invalidation, freeze enforcement, `setTree` batching.

- [ ] **3. `core/errors.ts`** — add `PaletteWriteError` subclass of
  `PaletteError`. Thrown by `ValuesBag.set()` on locked/frozen writes, caught
  by adapters for UI feedback.

- [ ] **4. `points.ts`** — `NothingPoint` kind
  (`{ type: 'nothing', id, label, uses, can?, description?, categories?, keywords?, icon? }`)
  + `isNothingPoint` guard. Update `AnyPoint` union. Core semantics wired in
  `PaletteCore`: `getValue` → `undefined`, `setValue` throws `PaletteError`,
  `reset` no-op, excluded from `asObject()` value serialization (only the
  binding itself serializes). Add `uses?: readonly ContextName[]` to
  `PointBase`. Change `can` on action points from static `can?: boolean` to
  functional `can?: (...bags: readonly (ValuesBag | undefined)[]) => boolean`
  and add the same optional `can` to valued points **and nothing-points**
  (omitted = enabled). Back-compat note: today's static `can: boolean` on
  `ActionPoint` / `EnumOption` / `VirtualEnumOption` becomes a call — adapters
  that read `point.can` as a value must call `evaluateCan(id)` instead.

- [ ] **5. Wire bags into `PaletteCore`**:
  - Bag registry: `Map<ContextName, ValuesBag>`. Root bag `''` created
    internally at construction (wraps `PaletteStateStore` generalized to
    `ValuesBag`).
  - `setContext(name, bag)` — clears old bag listeners, stores new bag,
    subscribes internally to forward changed keys to `subscribeContext`
    consumers, triggers re-derivation + `can` re-evaluation for tools whose
    point `uses` that context.
  - `removeContext(name)` — unsubscribes, drops from registry, tools whose
    point `uses` it re-derive with `undefined` (disabled + placeholder unless
    their `can` / resolvers define otherwise).
  - `getBag(name)` — registry lookup (returns `undefined` for unknown names).
  - `resolveBags(uses)` — resolves `uses` array to `(ValuesBag | undefined)[]`
    in order, never throws (missing names → `undefined`; root `''` always
    resolves).
  - `evaluateCan(pointId)` — resolves the point's `uses` and calls its `can`
    (or `true` when omitted). Used by adapters and by the `can`-flip diff.
  - `subscribeContext(listener)` — new subscription channel; listener receives
    `(bagName, changedKeys)` on any context-bag change.
  - `subscribeCan(listener)` — derived channel; listener receives
    `(pointId, can)` only when a context notify flips a point's evaluated
    `can` (see §2.8).
  - `getValue` / `setValue` survive as root-bag sugar (delegate to
    `this.bags.get('')!.get/set`).
  - `dispose()` clears root bag + layout listeners; unsubscribes from all
    context bags (host disposes them).
  - Tests in `core.test.ts`.

- [ ] **6. `core/context-display.ts`** — pure resolvers per family
  (param-array signature: `(boundValues: readonly unknown[], boundBags:
  readonly (ValuesBag | undefined)[])`) + `missingContext` sentinel
  (`undefined` bag slot) + single-point dual-source bold precedence resolver
  (selection bag when present, else root value). Tests mirror
  `virtual.test.ts` style.

- [ ] **7. Adapter spike (vanilla first)** — dirty-set + rAF refresh + one
  context-bound control proving selection-follows-context with zero value
  notifications. Vanilla proves the pattern; svelte/React parity follows.

- [ ] **8. Command-box context pass** — entries carry `uses`, filter at render.
  A command on a nothing-point with `uses: []` / `undefined` is always present
  (no bag subscription). Entries with unregistered bags receive `undefined`
  and decide (hidden / disabled / fallback label) via their own `can` /
  resolvers.

- [ ] **9. Document the `uses` contract** (1:1 tool→point, optional bags,
  functional `can` + `subscribeCan`) in `docs/core-concepts.md`; retire
  this file per `AGENTS.md` once landed.
