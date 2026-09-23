# Core concepts

## Vocabulary (strict — no synonyms)

- **point** — the data definition of what is controlled by the palette: one
  entry of the points list (no layout). Example: the fact *alert* can be
  `green`/`yellow`/`red` is an enum-point. A point is never placed on a
  toolbar itself — it is placed *as* a tool (button, toggle, select, …).
- **tool** — a toolbar-bound control that reads/writes a point: a
  `ToolbarItem` (`{ point: spec, control?, config? }`) resolved through
  the registry to a presenter + head component, placed in a toolbar (layout).
  Buttons, toggles, selects, sliders, steppers are tools. `status`,
  `commandBox`, and `drawer` bind **nothing-points** (1:1 — one tool, one
  nothing-point whose `uses` names their context): a status reads
  `bag?.get('fileName')` to render and never writes; a commandBox lists
  commands filtered by `uses` at render time; a drawer renders a nested
  toolbar with context flowing down to child tools.
- **control** — the chosen front-end of a tool (`'button'`, `'toggle'`,
  `'select'`, `'segmented'`, `'slider'`, …). The core only manipulates
  control ids and capability descriptors (`ControlRegistry` +
  `controlChoicesFor` / `resolveControl`); adapters map ids to components.
  The item field is `control`, the point field is `controls` (allowlist).
- **configurator** — the configuration panel that comes with a tool
  (label/icon/hint, control chooser (`controlChoices`), tone, delete).
  Rendered in the console *Details* panel, not on the toolbar.
  The word **editor** is banned: it meant both the front-end and the panel.
  The word **variant** is banned for controls: use **control**.

### The `uses` contract (context-sensitive tools)

A tool refers to **one and only one point**; the point declares **what it
operates on** via `uses?: readonly ContextName[]` (optional bags — `undefined`
= root bag only, as before). Each name resolves to `ValuesBag | undefined`
(`undefined` = bag not registered — render falls back to disabled +
placeholder, never throws). `ROOT_CONTEXT` may appear explicitly to receive
the root bag as an argument (e.g. `uses: [ROOT_CONTEXT, 'activeFile']` →
`run(rootBag, activeFileBag)`); valued-point reads/writes route through
context via `core.readValue` / `core.writeValue` (dual-source precedence:
first non-root used bag holding the id wins, else root; strict skeleton
throw on write when absent everywhere — the consumer hydrates first).
`uses` only controls which bags are passed to `run` / `can` / display
resolvers, in `uses` order.

- `run(...bags)` receives the used bags writable; `PaletteCore.run(spec)`
  passes the resolved bags for action points (context-aware path — e.g. the
  fleet `fireTorpedo` reads `ship?.get('shipId')`), while valued-point
  setters/actions route through `writeValue`/`readValue` (context-routed
  writes land in the selection bag, never root).
- `can(...bags)` is functional on **all** point kinds (omitted = enabled);
  adapters read it via `core.evaluateCan(id)` and subscribe to flips via
  `core.subscribeCan` (flips only — no render storms). Context-bag changes
  reach adapters via `core.subscribeContext((bagName, changedKeys))`.
  **Skeleton implies disabled for context tools:** a valued point with
  non-empty `uses` and no explicit `can` evaluates `false` while its value is
  absent (`undefined`) — the context is absent, so there is nothing to write
  to (`writeValue` would throw). Selecting/hydrating the bag flips it back on
  (a `subscribeCan` flip, no value change needed). An explicit functional
  `can` overrides this default; root-only valued tools (`uses` empty/omitted)
  stay enabled — the consumer hydrates the root store first.
- Bags: the root bag `ROOT_CONTEXT` (`''` value, `'root'` alias accepted) is
  core-owned (`core.values` itself — the single source of truth, starts empty,
  no defaults inside; absent key = skeleton `undefined`). `initialValues`
  stays the one-shot SSR/hydration constructor fill; the demo hydrates via
  live `setMany` + the adapter-owned `createValueProxy` lens instead.
  Context bags are host-owned via `core.setContext`/`removeContext`
  (replace-never-append; root name throws) and start empty.
  `ValuesBag` mirrors the store discipline (`Map` + `Object.is` +
  snapshot-iteration + async re-throw) with frozen `get`, one-notify
  `setTree`, and `lock`/`unlock` (→ `PaletteWriteError`).

### Data owning (single source in core)

| Concern | Owner | Notes |
|---|---|---|
| Root value storage (`PaletteStateStore`, a.k.a. bag `ROOT_CONTEXT`) | `core` | Single source of truth. No defaults inside. Absent key = skeleton (`undefined`). |
| Domain defaults + reset intent | consumer (`demo`) | One defaults object (`CONSUMER_DEFAULTS`). Reset = `setMany(CONSUMER_DEFAULTS)`. Dirty = diff vs defaults. |
| Plain-object lens (`myValues.alertLevel` get/set) | adapter (`vanilla`) | `createValueProxy()` bridge: single render path — bag keys render via bag-notify `onChange` only (setter never renders), local keys (`isBagKey` → false) render via direct `onChange`. |

Strictness: `get(id)` stays lenient (absent → `undefined`, the skeleton probe).
Strict paths throw on absent: `run` setter / toggle / step (`require(id)` helper).
Skeleton: `resolveRenderTree({ points, values: {} })` renders every tool
(descriptor + control + keystrokes, `value: undefined`). Presenters propagate
`undefined` instead of coercing (`false` / `0` / `''`).

## Points (definitions, no layout)

Four families (`src/lib/palette/types.ts`):

| Family    | Shape                                              | Examples                          |
| --------- | -------------------------------------------------- | --------------------------------- |
| `run`     | `{ run(), can }`                                   | `console`, `saveGame`, `emergencyProtocol` |
| `boolean` | `{ type: 'boolean', value }`                       | `autoOxygen`, `shieldGenerator`   |
| `enum`    | `{ type: 'enum', value, values[] }`                | `alertLevel`, `colonyTheme`, `powerPriority` |
| `number`  | `{ type: 'number', value, min?, max?, step? }`     | `gameSpeed`, `taxRate`, `satisfaction` |

Points carry no defaults (core holds no defaults — absent key = skeleton).
Consumer-owned defaults live outside core (demo `CONSUMER_DEFAULTS`, applied
via `setMany`).

Points carry `label`, `icon` (`PaletteIcon = string | Component`),
`keywords` (kept for future use — command-box keyword search). Editable points expose get/set `value` — in the demo these proxy a
module-level `$state` object (`demoState`, the Stellar Outpost colony state), so
every tool mutation is reactive.
`Snippet` is excluded from `PaletteIcon`: `Component` and `Snippet` are both
callables with no runtime discriminator, so the `Icon` helper could never tell
them apart — wrap inline markup in a component instead.

Helpers: `isRunTool` / `isEditableTool` guards,
`paletteToolFamily(tool)`, `paletteTool(palette, spec)` (same resolution as
`palette.tool(spec)`), `paletteEnumValueKeywords(value)` (searchable keywords
for enum values).

## Predefined values (enum tool on any point)

The point (`min`/`max` for numbers, the bare boolean domain) stays the same;
the tool can differ and offer a fixed list of predefined values:

- a **number** point rendered as an enum tool (e.g. a `select`/`segmented`
  listing `0.5×` / `1×` / `2×` presets for `gameSpeed`) — the tool writes the
  preset into the numeric value;
- a **boolean** point rendered as an enum tool with predefined
  `true` / `false` (and optionally an unset/`undefined` third state).

Per-item restriction uses the enum-subset `config` (`values` allow-list,
`keywords` filter, `choiceDisplay`), honored by `selectPresenter` and editable
in the console add-flow (`consoleState.enumValues` / `enumKeywords`).

## Point specs (`tool:` strings)

`palette.tool(spec)` resolves three forms (the `tool:` item field and `keys:` map
both use this syntax to bind a tool to a point):

- `toolId` → the tool itself (`autoOxygen` — action runner)
- `toolId=value` → pure setter (`alertLevel=red`, `colonyTheme=mars`); strict:
  absent (skeleton) values throw `PaletteError` (hydrate via `setMany` first).
- `toolId!` → boolean toggle (`autoOxygen!`); strict on skeleton.
- `toolId+=x` / `toolId-=x` → number step by an explicit amount
  (`gameSpeed+=0.5`, `gameSpeed-=2`); bounds-clamped, strict on skeleton.

Unknown tools, non-editable setters, and unknown steps throw `PaletteError`
(the palette error taxonomy — `commandRunner` deliberately throws `PaletteError`,
not plain `Error`). Argumented actions and stash-style push-aside/pop-back
are consumer-owned: presets provide specific argument-less action points.

Key bindings (`src/lib/palette/keys.ts`): pass a raw map (`keys: { E: 'emergencyProtocol' }`)
— `Palette` normalizes it internally via `createPaletteKeys` (also accepts a
prebuilt registry). Keystrokes normalize (`Ctrl`/`Alt`/`Shift`/`Meta` order, `cmd`→`Meta`,
`escape`→`Esc`, single chars uppercased). `paletteRoot` resolves `keydown` on the
IDE root (skips editable targets) and runs the tool: run tools execute when
`can`, boolean tools toggle. Demo bindings live in `src/lib/demo/palette.svelte.ts`
(`` ` `` console toggle, `N` life support, `S` shields, `E` lockdown,
`Ctrl+S` save, `+`/`-` sim speed (`gameSpeed+=0.5` / `gameSpeed-=0.5`), `1/2/3` threat presets).

## Palette class (`src/lib/palette/palette.svelte.ts`)

Construct with `PaletteConfig`: `tools`, `keys`, `editable?`, `editors?`,
`editorDefaults?`, `editor?`/`configurator?` fallbacks, `runner?`/`setter?`
wrappers, `editorCapabilities?`. `palette.editing` is true when
`editable !== false && palettes.editing === this` (class instances are never
proxied, so `===` is exact). `dispose()` is a no-op kept for API parity.

Shared module state (`palettes`, a `$state` object): `editing` (one palette at a
time), `inspecting` (`{ item, palette, region? }`), `dragging` (pointer session),
`catalogDrag` (native HTML5 session). `isEditing(palette)` mirrors the getter.

## Tools (toolbar-bound controls)

A tool is a toolbar item bound to a point: a `ToolbarItem`
(`{ point: spec, control?, config? }`) resolved through the registry to a
presenter + head component and placed in a toolbar (layout). Buttons,
toggles, selects, sliders, steppers are tools.

Three tools bind **nothing-points** (context plus enablement, no core value) — `status` (read-only display from context bags), `commandBox` (commands-combo-box, runs commands inline), `drawer` (child-toolbar portal trigger bound to a nothing-point, holds other tools), `theme` (enum-shaped nothing-point, adapter get/set on the document root class).

## Configurators (configuration panels)

A configurator is the configuration panel that comes with a tool:
label/icon/hint, control chooser (`controlChoices`), tone, delete.
Rendered in the console *Details* panel, never on the toolbar.

## Control registry (family → control)

Keyed family → control. The default head provides one control per family (`boolean/toggle`, `enum/select`, `number/slider`,
`run/button`, `item/commandBox+drawer+status`); the demo registry
stays the fallback:

- `boolean`: `toggle` (head) — demo adds nothing
- `enum`: `select` + `segmented` (head) — demo adds nothing
- `number`: `slider` + `stepper` (head) + demo `slider` override (value badge) and
  `stars` extension (play/rating row)
- `run`: `button` (head) — demo adds nothing
- `item` (nothing-point variants): `commandBox`, `drawer`, `status`, `theme` (head; demo adds nothing)

Head components are dumb: each binds a headless core presenter
(`button/toggle/select/slider/commandBox/
status/configurator` presenters; see `docs/creating-a-head.md`). Full usage in
`docs/using-the-default-head.md`; extraction history in `docs/head-extraction.md`.

`controlDefaults` picks the control
when an item omits `control` (demo: `{ run: 'button' }`).

Resolution (`resolveControl`): control-only items look up `controls.item[control]`;
tool items look up `controls[family][control]` with capability validation against
the surface (wrong family/axis/`accepts` → first compact fallback for the family).
Unknown tools / missing controls render nothing — inert by design, so broken items never crash the bar.

## Scope, surface, context

- Surface context = `{ axis, region }` — adapters derive `axis` from `region`;
  drawer children **invert** the parent axis; child region follows
  (`vertical` → `left`, `horizontal` → `top`).
- `describeItemConfiguration({ item, toolbar, index, region }, surface)` returns
  the headless descriptor: `title`/`subtitle`, `structure` (move
  backward/forward enabled, removable), `presentation` (`currentControl`,
  `controlChoices` filtered by capabilities), `bindings` (`shortcut` from
  `keys.findByPoint`). The console renders the
  **presentation-only** configurator for the current selection; structural
  actions (`structure`) are advisory — the demo does not expose move/remove.

## Icons

Core is icon-agnostic: icons flow through points → tools → controls, and
only the control renders them. No `pure-glyf` port — emoji strings suffice for the demo.
