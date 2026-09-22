# Command box

Vocabulary: the command-box (as command palette) lists **points**
(`PaletteConfig.tools` data definitions, no layout) as executable commands;
binding one to a toolbar creates a **tool**. `status` / `command-box` / `drawer`
are **nothing-point tools** (context plus enablement, no core value). See `docs/core-concepts.md` for the glossary.

Builders and model live in `src/lib/palette/command-box.svelte.ts`. Console (headless core +
head modal): `src/lib/palette/console.svelte.ts` + `src/lib/head/Console.svelte`.

## Entry builders

| Builder                  | Contents                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `paletteCommandEntries`  | Executable commands from points: run points, boolean on/off, enum per-value setters, number inc/dec. `mode: 'catalog'` keeps entries enabled for search/drag. `excludeTools` omits meta-points (the console excludes `console` inside the console). |
| `paletteAddItemEntries`  | Add sources: one per valued point (boolean/number/enum/… — the concrete control is picked per-variant) + one per nothing-point by point name (Theme, Command, More, … — each binds 1:1 to its `controls` allowlist). `context.itemControls` survives only as a fallback for controls no nothing-point claims. Runnable points are excluded (they already have command entries). |
| `paletteDerivedVariants` | Concrete insertable variants for an add source: `tool` (toolbar command), `set` (boolean/enum/number control — value chosen on bar/inspector), `action`, `item` (control-only). |
| `paletteCatalogEntries`  | Full catalogue (headless helper, not rendered by the console): `mode: 'catalog'` commands + flattened add variants (`add:<variant-id>`), sorted by label. Each carries `catalogDrag` (`{ kind: 'spec' }` or `{ kind: 'variant' }`). |
| `paletteEnumSubsetValues`| Filter enum values by keywords (powers `EnumSubsetConfigurator` + add-flow keyword filters). |

Labels are humanized (`gameSpeed` → `Game Speed`); keywords collect tool/value/
category words; `meta` shows the key binding (`keys.findByTool`) or a fallback.
`can: false` entries are filtered from `results` (but stay searchable in catalog
mode). `commandRunner` throws `PaletteError` for non-runnable specs.

## Model (`paletteCommandBoxModel`)

```ts
const box = paletteCommandBoxModel({ entries, placeholder: 'Command…' })
```

**Init-time constraint:** create during component/module init only — `$state`
initializers throw (or detach) in late handlers, `setTimeout`, or after `await`.
Drive from handlers via `box.search()` / `box.execute()` / `box.input.value`.

- `input`: `{ value, placeholder?, clear() }` — setting `value` clears selection.
- `query`: `{ free, keywords, categories }` — parsed from input (`#cat` prefix
  selects categories; known keywords become tokens; rest is free text) unless
  overridden by `search({ free?, keywords?, categories? })`.
- `results`: filtered + scored entries (exact label +8, prefix +5, substring +2,
  then alphabetical). `suggestions`: keyword completions for the current word.
- `categories` / `keywords`: `available`, `active`, `toggle`/`addToken`/
  `removeToken`/`removeLast`/`clear`.
- `selection`: `index`, `item`, `set`/`select`/`next`/`previous`/`clear`.
- `select(entryId?)` / `execute(entryId?)` — execute runs `entry.run()`, then
  clears filters + selection. `handleKeyDown`: ArrowUp/Down navigate,
  Enter executes (or selects with `enterAction: 'select'`), Backspace on empty
  input pops tokens, Escape clears selection then filters, Space/Tab accepts the
  keyword suggestion.

Helpers: `setPaletteCommandBoxInput(box, event)`,
`handlePaletteCommandBoxInputKeydown({ commandBox, event, onAfterExecute? })`,
`handlePaletteCommandChipKeydown({ commandBox, event, token, type? })`.

`$derived` values are exposed through getters on the returned object, never as
shorthand properties — shorthand captures the initial value and breaks
reactivity (`state_referenced_locally`).

## Command box (combobox) vs console

The toolbar `commandBox` control is a real **commands-combo-box** (text input + results popup,
Ctrl-Shift-P style) built on `paletteCommandBoxModel` + `paletteCommandEntries` — a **run**
surface that executes commands inline on the toolbar. It is independent of the console.

When the palette is R/W (`editable !== false`), the combobox's shell also carries a **square
edit-icon button** (`command-box-open-configurator`, `✎`) on the left of the input — a plain action
button (not a check-button/toggle), which opens the console in **edit mode**. Since the
combobox already runs commands inline, the console opens edit-only when a `commandBox` is
displayed (no `console-mode-toggle` in the modal itself).

The **console** is a separate modal (opened by the `console` run tool / key). Its mode depends
on whether a `commandBox` combobox is on the toolbar: if so it opens in **edit mode** (running
happens inline); if not it opens **command-first** (its own run box) and, when the palette is
R/W, offers a **square edit-icon button** (`console-mode-toggle`, `aria-pressed`, `✎`/`✓`) on
the left of the command box to enter/leave edit mode. Closing the console always stops edition.

## Add-to-toolbar flow (demo)

Edit mode swaps the console box to `paletteAddItemEntries` with `enterAction: 'select'` — a
**single** list: selecting an add-box result (`console-results`) reveals the *Details* panel
(`console-details-panel`) with the configurator directly (one source = one control via
`paletteDerivedVariants` — no variant picker; adding happens only via d&d). Run mode shows
only the run-box results. The console is edit-capable only when the palette is R/W
(`editable !== false`): the edit button renders only then, and closing the console always
clears the `palettes.editing` mirror (plus `palettes.inspecting`), so toolbars never stay
inert after an edit-mode close. Selecting an entry builds a detached draft item
(`itemFromAddSelection` — the draft binds the point with the bare tool id, no `=value`
preset) and shows the full configurator (Label/Icon/Hint/Control/Tone/showValue/showText,
same rows as the inspector, minus Delete — the draft is detached — and minus Control
whenever a single choice remains, e.g. 1:1 nothing-points or single-variant families)
bound to the draft, plus
a disconnected preview below it (`console-add-preview`): real choices/options from the point
definitions with a local selected value seeded from the live store. Preview interactions
mutate the preview core only (never `core.values` / `core.run`) and re-render the preview
node in place. The preview content is the sole drag source
(`console-add-preview-content` pointerdown clones the draft into a `catalog` session).
`Parking` (the independent parking stack minus the command box) offers remove/restore while
editing.

Payloads: `serializePaletteCatalogDragPayload` / `parsePaletteCatalogDragPayload`
/ `paletteToolbarItemFromCatalogPayload` (spec → default control +
label/icon/hint; variant → item per kind). Invalid payloads return `undefined`.
