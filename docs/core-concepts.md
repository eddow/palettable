# Core concepts

## Vocabulary

- **point** — the data definition of what is controlled by the palette: one
  entry of `PaletteConfig.tools` (no layout). Example: the fact *alert* can be
  `green`/`yellow`/`red` is an enum-point. A point is never placed on a
  toolbar itself — it is placed *as* a tool (button-group, combobox, …).
  Code names (kept): `PaletteToolRun` (action-point) / `PaletteEditableTool`
  (option-point: `boolean` / `enum` / `number`). The command-box (as command palette) lists points as
  executable commands (`paletteCommandEntries`).
- **tool** — a toolbar-bound control that modifies a point: a
  `PaletteToolbarItem` (`{ tool: spec, editor?, config? }`) resolved through
  the registry to a presenter + head component, placed in a toolbar (layout).
  Buttons, toggles, selects, sliders, steppers are tools. `status`,
  `command-box`, and `drawer` bind **nothing-points** (1:1 — one tool, one
  nothing-point whose `uses` names their context): a status reads
  `bag?.get('fileName')` to render and never writes; a command-box lists
  commands filtered by `uses` at render time; a drawer renders a nested
  toolbar with context flowing down to child tools.
- **editor** — the configuration panel that comes with a tool
  (`PaletteEditorSpec.configure`, e.g. `BaseConfigurator`): label/icon/hint,
  variant chooser (`editorChoices`), tone, delete. Rendered in the console
  *Details* panel, not on the toolbar.

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
Strict paths throw on absent: `run` setter, `applyNamedAction` (`id:action`),
`namedActionCan`, `runStash` source read (`require(id)` helper).
Skeleton: `resolveRenderTree({ points, values: {} })` renders every tool
(descriptor + editor + keystrokes, `value: undefined`). Presenters propagate
`undefined` instead of coercing (`false` / `0` / `''`).

Code-name map (kept for compatibility): point → `PaletteTool*` types +
`PaletteToolSpec` strings; tool → `PaletteToolbarItem` +
`PaletteEditorSpec.editor` + presenter; editor →
`PaletteEditorSpec.configure` + `configuratorPresenter`.

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

Points carry `label`, `icon` (`PaletteIcon = string | Component`), `categories`,
`keywords`. Editable points expose get/set `value` — in the demo these proxy a
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

- `toolId` → the tool itself (`autoOxygen`)
- `toolId=value` → setter runner (`alertLevel=red`, `colonyTheme=mars`); strict:
  absent (skeleton) values throw `PaletteError` (hydrate via `setMany` first).
  Legacy `toolId|value` still resolves.
- `toolId:action` → action runner (`gameSpeed:inc`, `gameSpeed:dec`); only `number`
  has built-in actions (`valueActions.number`)

Unknown tools, non-editable setters, and unknown actions throw `PaletteError`
(the palette error taxonomy — `commandRunner` deliberately throws `PaletteError`,
not plain `Error`).

Key bindings (`src/lib/palette/keys.ts`): pass a raw map (`keys: { E: 'emergencyProtocol' }`)
— `Palette` normalizes it internally via `createPaletteKeys` (also accepts a
prebuilt registry). Keystrokes normalize (`Ctrl`/`Alt`/`Shift`/`Meta` order, `cmd`→`Meta`,
`escape`→`Esc`, single chars uppercased). `paletteRoot` resolves `keydown` on the
IDE root (skips editable targets) and runs the tool: run tools execute when
`can`, boolean tools toggle. Demo bindings live in `src/lib/demo/palette.svelte.ts`
(`` ` `` console toggle, `N` life support, `S` shields, `E` lockdown,
`Ctrl+S` save, `+`/`-` sim speed, `1/2/3` threat presets).

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

A tool is a toolbar item bound to a point: a `PaletteToolbarItem`
(`{ tool: spec, editor?, config? }`) resolved through the registry to a
presenter + head component and placed in a toolbar (layout). Buttons,
toggles, selects, sliders, steppers are tools. Code names (kept):
`PaletteToolbarItem` + `PaletteEditorSpec.editor` + `*Presenter` + head
`editors/*` component.

Three tools bind **nothing-points** (context plus enablement, no core value) — `status` (read-only display from context bags), `commandBox` (commands-combo-box, runs commands inline), `drawer` (child-toolbar portal trigger bound to a nothing-point, holds other tools), `theme` (enum-shaped nothing-point, adapter get/set on the document root class).

## Editors (configuration panels)

An editor is the configuration panel that comes with a tool:
`PaletteEditorSpec.configure` (today always `BaseConfigurator`): label/icon/hint,
variant chooser (`editorChoices`), tone, delete. Rendered in the console
*Details* panel, never on the toolbar. Code names (kept):
`PaletteEditorSpec.configure` + `configuratorPresenter`.

## Tool registry (family → tool variant)

Keyed family → variant. The default head (`src/lib/head/registry.ts`, `headEditors`)
provides one variant per family (`boolean/toggle`, `enum/select`, `number/slider`,
`run/button`, `item/commandBox+drawer+status`); the demo registry
(`src/lib/demo/editors/registry.ts`) adds extras and merges per family so the head
stays the fallback:

- `boolean`: `toggle` (head) — demo adds nothing
- `enum`: `select` + `segmented` (head) — demo adds nothing
- `number`: `slider` + `stepper` (head) + demo `slider` override (value badge) and
  `stars` extension (play/rating row)
- `run`: `button` (head) — demo adds nothing
- `item` (nothing-point variants): `commandBox`, `drawer`, `status`, `theme` (head; demo adds nothing)

Head components are dumb: each binds a headless core presenter
(`src/lib/palette/presenters.svelte.ts` — `button/toggle/select/slider/commandBox/
status/configurator` presenters; see `docs/creating-a-head.md`). Full usage in
`docs/using-the-default-head.md`; extraction history in `docs/head-extraction.md`.

`spec(editor, configure, footprint?)` builds a `PaletteEditorSpec`; Svelte
`Component` props are contravariant so broad configurators (`BaseConfigurator`,
`EnumSubsetConfigurator`) assign without casts. `editorDefaults` picks the variant
when an item omits `editor` (demo: `{ run: 'button' }`).

Resolution (`resolveEditor`): editor-only items look up `editors.item[editor]`;
tool items look up `editors[family][variant]` with capability validation against
the surface (wrong family/axis/`accepts` → first compact fallback for the family).
`renderEditor` **returns** the component (the adapter renders `<Editor context>`),
unlike the reference which invoked a JSX factory. Unknown tools / missing editors
render nothing — inert by design, so broken items never crash the bar.

## Scope, surface, context

- `PaletteScope` = `{ palette?, region?, editorChoices?, … }` — the serializable
  payload editors read. `Ide` publishes `{ palette }`; borders stamp `region`;
  drawer portals propagate both through `mount` props.
- `surfaceContextFromScope(scope)`: `left`/`right` → `vertical`, else `horizontal`.
  Drawer children **invert** the parent axis; child region follows
  (`vertical` → `left`, `horizontal` → `top`).
- `PaletteEditorContext` = `{ item, tool, scope, flags, surface }` — built by
  `resolveEditorContext`. Configurators get the same shape with an augmented scope
  (`resolveConfiguratorContext` → `resolveConfiguratorScope` injects
  `editorChoices` from `describeItemConfiguration`).
- `describeItemConfiguration({ item, toolbar, index, region }, surface)` returns
  the headless descriptor: `title`/`subtitle`, `structure` (move
  backward/forward enabled, removable), `presentation` (`currentEditor`,
  `editorChoices` filtered by capabilities), `bindings` (`shortcut` from
  `keys.findByTool`). The console (head `Console.svelte`) renders the
  **presentation-only** configurator for the current selection; structural
  actions (`structure`) are advisory — the demo does not expose move/remove.

## Icons

Core is icon-agnostic: `PaletteIcon` flows through tools → items → editors, and
only the editor renders it. `src/lib/head/Icon.svelte` resolves `Component` via
`<svelte:component>` and strings via a module-level `$state` factory
(`src/lib/head/icons.svelte.ts`), else `<span data-icon="name">name</span>`.
No `pure-glyf` port — emoji strings suffice for the demo.
