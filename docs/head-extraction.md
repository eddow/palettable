TODO: remove this file once review is done
# Head extraction — what was done

Why the head exists: the palette core owns logic + functioning, **including HTML
structure** (layout components `Ide`/`Toolbar`/`ToolbarTrack`/`ToolbarBorder`/
`Parking`/`PaletteItem`, drawer portal, drag/drop, a11y semantics). Heads are the
components placed in a page: **presentation only** (markup + CSS bound to a
headless presenter, zero tool/config mutation inside `.svelte`).

## 1. Core presenters (`src/lib/palette/presenters.svelte.ts`)

New headless view-model layer — the contract between core and any head. Pure
functions from `PaletteEditorContext` to render data, zero markup, zero CSS:

| Presenter | Family | Returns |
| --------- | ------ | ------- |
| `buttonPresenter(context)` | run | `{ label, icon, title, tone, can, run }` |
| `togglePresenter(context)` | boolean | `{ icon, title, tone, pressed, toggle() }` |
| `selectPresenter(context)` | enum | `{ title, tone, icon, value, options[{value,text}], select }` |
| `sliderPresenter(context)` | number | `{ title, tone, icon, direction, region, min, max, step, value, set }` |
| `commandBoxPresenter({ context })` | item | `{ title, icon, label, hint, model }` (a real combobox — runs commands inline) |
| `configuratorPresenter(context)` | any | `{ label, icon, hint, tone, editor, editorChoices, setText, setTone, setEditor }` |

Shared helpers moved out of the demo into core: `headMeta` (item `config` with
label/icon/hint/tone defaults), `headTooltip` (`label · suffix`), `headLayoutFromSurface`
(surface axis → horizontal/vertical, region fallback), `headRegionFromScope`
(defaults to `'top'`). Enum-subset filtering (`values`/`keywords` config +
`choiceDisplay`) lives inside `selectPresenter`, not in head components.

Re-exported from `src/lib/palette/core.svelte.ts` (as `buttonPresenter`, …).

Rule enforced by construction: heads must be dumb — no `tool.value = …`, no
`tool.run()`, no `paletteCommandEntries` calls inside `.svelte`. All mutation lives
in presenters (or the tool itself); heads only call presenter callbacks.

## 2. Dumb default head (`src/lib/head/`)

Copied the minimal one-variant-per-family subset from `src/lib/demo/editors/`
(button/toggle/select/slider/commandBox + `BaseConfigurator` + `Icon` + `icons`
factory), then rewrote every component to bind its presenter:

- `ButtonEditor.svelte` → `const view = $derived(buttonPresenter(context))`, binds
  `view.label/icon/title/tone/can/run`.
- `ToggleEditor.svelte` → `togglePresenter`, binds `view.icon/title/tone/pressed/toggle()`
  (keeps optional `onToggle` callback prop).
- `SelectEditor.svelte` → `selectPresenter`, binds `view.title/tone/icon/value/options/select()`
  (keeps optional `onChange`).
- `SliderEditor.svelte` → `sliderPresenter`, binds `view.title/tone/icon/direction/region/
  min/max/step/value/set()` (keeps optional `onChange`).
- `CommandBoxEditor.svelte` → `commandBoxPresenter({ context })`, binds a
  `paletteCommandBoxModel` (combobox: input + results popup, runs commands inline).
- `BaseConfigurator.svelte` → `configuratorPresenter`, binds `view.label/icon/hint/tone/
  editor/editorChoices/setText/setTone/setEditor()`.

Deleted `src/lib/head/editors/meta.ts` — no logic left in head (verified: no
`toolbarMeta`/`tooltip`/`layoutFromSurface` imports remain). Fixed the copied
`icons.svelte.ts` doc comment to import from `$lib/head/icons.svelte`. Drawer trigger
is reused from core (`$lib/palette/components/DrawerEditor.svelte`), never duplicated.

`src/lib/head/registry.ts` is the barrel: `headEditors` (a small standard set per
family — boolean/toggle, enum/select+segmented, number/slider+stepper,
item/commandBox+drawer, run/button), plus `Icon`, `icons`/`IconFactory`, and
presenter re-exports. The `segmented` (joined buttons, selected reads pushed-in)
and `stepper` (± buttons) variants were promoted into the head after review — they
reuse `selectPresenter`/`sliderPresenter` (no new logic). Two demo editors —
a same-key `number.slider` override and a `number.stars` extension — stay in
`src/lib/demo/editors/registry.ts` to prove custom heads
can **replace** a head variant (same key, demo spread last wins).

Styles: `src/lib/head/styles/head-default.css` (the head-owned theme, class
prefix `palette-default-*`). `palette.css` stays core-owned (layout + edit
chrome). The old `palette/styles/palette-default.css` duplicate was deleted
after review — nothing imports it. `src/lib/palette/drawer-editor.svelte.ts`
doc comment updated to reference the head's `head-default.css`.

## 3. Demo dogfoods the default head (one override)

`src/lib/demo/palette.svelte.ts` merges per family so the head is the fallback:

```ts
import { headEditors } from '$lib/head/registry'

editors: {
	boolean: { ...headEditors.boolean, ...demoEditors.boolean },
	enum: { ...headEditors.enum, ...demoEditors.enum },
	number: { ...headEditors.number, ...demoEditors.number },
	item: { ...headEditors.item, ...demoEditors.item },
	run: { ...headEditors.run, ...demoEditors.run },
} as never,
```

`src/routes/+page.svelte` imports `$lib/head/styles/head-default.css` (instead of
`$lib/palette/styles/palette-default.css`). Every family renders through the head
verbatim **except `number`, where `demoEditors.number.slider` overrides the head's
slider** — the demo `SliderEditor` binds `sliderPresenter` and adds a numeric value
badge, so the override is visibly distinct. The other four demo family maps are
empty objects (`{}`), so the head is the sole source for button/toggle/select/
commandBox in the demo.

## 4. Incidental fix

`findSetterSeparator` (`src/lib/palette/palette.svelte.ts`) only treats `=`/`|` before
any `:` as a setter separator, so `gameSpeed:inc=fast` resolves as action (`inc`) + arg
(`fast`) instead of throwing `Unknown palette tool "gameSpeed:inc"`.

## 5. Gates

`check` 0/0, `lint` clean (Biome organize-imports applied), `test` 103 pass,
`build` ok.

## Remaining

- `tests/palette/head-independence.test.ts` (core must not import `head`/`demo`).
- Packaging (`@sveltejs/package`, `exports` map for `./palette` / `./head`).
