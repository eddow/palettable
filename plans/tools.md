# Tools — inventory per point (+ editor)

> Status: **inventory + TODO.** Vocabulary: **point** = the data definition of
> what is controlled by the palette, one entry of `PaletteConfig.tools` (no
> layout — e.g. the fact *alert* can be `green`/`yellow`/`red` is an
> enum-point); **tool** = a toolbar-bound control that modifies a
> point (`{ tool: spec, editor?, config? }` → presenter + head component,
> placed in a toolbar); **editor** = the configuration panel that comes with a
> tool (`PaletteEditorSpec.configure`, today always `BaseConfigurator`,
> rendered in the console *Details* panel). `status` / `command-box` / `drawer`
> are **pointless tools** (no bound value to modify, not controlled by the
> palette). Full glossary in `docs/core-concepts.md`.
> Code names keep the historical `PaletteTool*` / `PaletteEditor*` prefixes.

## Matrix (today)

Every row: one point family → its toolbar tools → the editor panel.
`Editor` is `BaseConfigurator` everywhere (label/icon/hint + variant chooser
`editorChoices` + tone + delete, via `configuratorPresenter`).

| Point (definition, no layout) | Code name | Tool (toolbar control) | Presenter | Head component | Editor (config panel) |
| --- | --- | --- | --- | --- | --- |
| run point `{ run(), can }` e.g. `console`, `saveGame`, `emergencyProtocol` | `PaletteToolRun` | `button` | `buttonPresenter` | `head/editors/ButtonEditor.svelte` | `BaseConfigurator` |
| boolean point `{ value, default }` e.g. `autoOxygen`, `shieldGenerator` | `PaletteToolBool` | `toggle` | `togglePresenter` | `head/editors/ToggleEditor.svelte` | `BaseConfigurator` |
| boolean point as enum tool (predefined `true`/`false`[/unset]) | `PaletteToolBool` | `select` / `segmented` (preset list, writes into the boolean value) | `selectPresenter` | `head/editors/Select|SegmentedEditor.svelte` | `BaseConfigurator` |
| enum point `{ value, default, values[] }` e.g. `alertLevel`, `colonyTheme` | `PaletteToolEnum` | `select` (dropdown) | `selectPresenter` | `head/editors/SelectEditor.svelte` | `BaseConfigurator` |
| enum point (same) | `PaletteToolEnum` | `segmented` (joined buttons, selected reads pushed-in) | `selectPresenter` | `head/editors/SegmentedEditor.svelte` | `BaseConfigurator` |
| number point `{ value, default, min?, max?, step? }` e.g. `gameSpeed`, `taxRate` | `PaletteToolNumber` | `slider` (continuous range) | `sliderPresenter` | `head/editors/SliderEditor.svelte` | `BaseConfigurator` |
| number point (same) | `PaletteToolNumber` | `stepper` (± buttons) | `sliderPresenter` | `head/editors/StepperEditor.svelte` | `BaseConfigurator` |
| number point as enum tool (predefined numeric presets, point stays numeric) | `PaletteToolNumber` | `select` / `segmented` (preset list, writes into the numeric value) | `selectPresenter` | `head/editors/Select|SegmentedEditor.svelte` | `BaseConfigurator` |
| number point (same, demo-only) | `PaletteToolNumber` | `slider` override (value badge) | `sliderPresenter` | `demo/editors/DemoSlider.svelte` | `BaseConfigurator` |
| number point (same, demo-only) | `PaletteToolNumber` | `stars` (play/rating row `▶`/`▷`) | `sliderPresenter` | `demo/editors/StarsEditor.svelte` | `BaseConfigurator` |
| — (pointless, no bound value) | `undefined` (`editors.item`) | `status` (pointless: read-only `<span>` from item `config`) | `statusPresenter` | `head/editors/StatusEditor.svelte` | `BaseConfigurator` |
| — (pointless, no bound value) | `undefined` (`editors.item`) | `commandBox` (pointless: commands-combo-box, runs commands inline) | `commandBoxPresenter` | `head/editors/CommandBoxEditor.svelte` | `BaseConfigurator` |
| — (pointless, no bound value) | `undefined` (`editors.item`) | `drawer` (pointless: child-toolbar portal trigger) | — (core portal) | `palette/components/DrawerEditor.svelte` (reused, never duplicated in head) | `BaseConfigurator` |

Per-item predefined restriction: enum-subset `config` (`values` allow-list,
`keywords` filter, `choiceDisplay`), honored by `selectPresenter`, editable in
the console add-flow (`consoleState.enumValues` / `enumKeywords`).

Derived command forms (command-box as command palette, no toolbar yet):
`toolId` (resolve), `toolId=value` (setter runner, `|` legacy), `toolId:action`
(`gameSpeed:inc` / `:dec` via `valueActions.number` — the only built-in actions).
`paletteCommandEntries` lists them; binding one to a toolbar makes it a tool.

## Where this lives — palette vs head

- **`src/lib/palette/` (headless, owns logic + structure):**
  point shapes (`types.ts`: `PaletteToolRun` / `PaletteToolBool` /
  `PaletteToolNumber` / `PaletteToolEnum`, `PaletteTools`,
  `PaletteToolSpec`), spec resolution + `valueActions`/`valueReader`
  (`palette.svelte.ts`), command builders (`command-box.svelte.ts`:
  `paletteCommandEntries` / `paletteAddItemEntries` / `paletteDerivedVariants`),
  tool + editor view-models (`presenters.svelte.ts`: `button`/`toggle`/`select`/
  `slider`/`commandBox`/`status` + `configuratorPresenter`), layout structure
  (`components/`: `Ide`, `Toolbar`, `ToolbarTrack`, `ToolbarBorder`, `Parking`,
  `PaletteItem`, `DrawerEditor` + `DrawerPopup` portal, drag/drop, a11y),
  barrels (`core.svelte.ts` read-only display + run, `edition.svelte.ts`
  mutation surface re-exporting core).
- **`src/lib/head/` (presentation only):**
  the tool components (`editors/Button|Toggle|Select|Segmented|Slider|Stepper|`
  `CommandBox|StatusEditor.svelte`, each binding its presenter, zero point/config
  mutation), the editor panel (`editors/BaseConfigurator.svelte` via
  `configuratorPresenter`), the registry map (`registry.ts`: `headEditors`
  family → tool variant, `spec(tool, BaseConfigurator, footprint)`), `Icon` +
  `icons` factory, `Console.svelte` modal shell, `styles/head-default.css`.
  The drawer trigger is **not** here — reused from core.
- **`src/demo/` (consumer proof):** `palette.svelte.ts` (point
  definitions proxying `demoState` + per-family registry merge so the head stays
  the fallback), `editors/registry.ts` (override `number.slider` + extension
  `number.stars`), nothing else per family.

## TODO

- [ ] Per-tool editors: today every `spec()` pairs with `BaseConfigurator`.
  Decide whether enum-subset (`values`/`keywords`/`choiceDisplay`, currently
  honored inside `selectPresenter`) or number-bounds editing ever needs a
  dedicated editor panel, or whether `BaseConfigurator` stays the single editor.
- [ ] Missing tool variants are head additions only (no palette change needed):
  boolean `checkbox`/`led`, enum `radio`, number `field`, run `menu-item` —
  add only with a demo/consumer proving replacement vs extension.
- [ ] `valueActions` gap: only `number` has built-in `:inc`/`:dec`; boolean has
  no toggle-button action by design (checkbutton instead), enum/run have none.
  The hard-coded inc/dec labels in `paletteCommandEntries` still carry a TODO
  to use a generic `runner` title — decide before adding new actions.
- [ ] Enum-tool-on-number/boolean: document the `config` contract (preset list
  source + write-back) once the first preset tool ships; today only the
  enum-subset restriction path exists.

## Reference comparison (`~/dev/ownk/sursaut/packages/ui/src/palette/`)

Same model, different runtime — no semantic drift except the three deliberate
divergences below:

- **`status` is pointless upstream and here.** `PaletteAnyTool = run | boolean | number |
  enum`; `PaletteToolFamily = 'run' | 'item' | editable['type']`. The `status`
  tool (`statusPresenter`, `StatusEditor`) is an `editors.item` variant: a
  read-only display fed by the item `config`, never bound to a point.
- **Setter spelling.** Upstream `PaletteToolSpec` is `toolId | toolId|value |
  toolId:action`; svelette adds `toolId=value` as the preferred spelling
  (`findSetterSeparator`, `=` wins, `|` legacy) and uses `=` in generated
  command entries. `commandRunner` throws `PaletteError` here vs plain `Error`
  upstream.
- **Runtime swaps only.** `mutts.reactive/effect/lift` → `$state`/`$derived`,
  JSX factories → returned Svelte `Component`s, `componentStyle.css` injection
  → global `palette.css`, `Palette.Toolbar`/`Ide` factories → `components/`,
  `options.iconFactory` → module-level `$state` factory, `latch()` portal →
  `mount()`. `paletteDefaultEditorCapabilities` keeps the upstream dead entries
  (`flip`, `radio`, `splitRadio`, `splitButton`) — see `plans/simplify.md` §2.
  Enum-subset (`values`/`keywords`/`choiceDisplay` in `selectPresenter`,
  `paletteEnumSubsetValues`, console add-flow inputs) and the
  `commandBoxEnumCommands` catalog mode exist identically upstream.
