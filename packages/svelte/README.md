# @palettable/svelte

Svelte 5 (runes) adapter for `@palettable/core` — port of the `@sursaut/ui/palette` headless palette subsystem — state,
a11y semantics, tool resolution, editing, drag/drop, **and HTML structure**. The palette
core owns logic + functioning; "heads" are presentation-only components (markup + CSS
bound to headless presenters) placed in a page.

- Core: `src/lib/palette/` — headless (barrels: `core.svelte.ts` read-only,
  `edition.svelte.ts` mutation surface re-exporting core)
- Head: `src/lib/head/` — the standard default theme (barrel: `src/lib/head/registry.ts`)
- Demo: `src/routes/+page.svelte` + `src/lib/demo/` (tools, editors)
- Tests: `tests/` (113 unit) + `e2e/` (12 Playwright)

## Quickstart

```sh
pnpm install
pnpm --filter @palettable/svelte dev    # Vite dev server
pnpm --filter @palettable/svelte check  # svelte-kit sync + svelte-check
pnpm --filter @palettable/svelte test   # Vitest (jsdom, browser condition)
# from the repo root:
# pnpm test:e2e   # Playwright (builds + previews on :4173)
# pnpm lint       # Biome check
```

Scratch files go in `sandbox/` (git-ignored), never `/tmp`.

## Minimal usage

```ts
import { Palette } from '$lib/palette/core.svelte'
import { headEditors } from '$lib/head/registry'

const palette = new Palette({
	tools: {
		theme: {
			type: 'enum',
			label: 'Theme',
			value: 'dark',
			default: 'dark',
			values: [{ value: 'light' }, { value: 'dark' }]
		}
	},
	keys: { E: 'alertLevel=red' },
	editable: true,
	editors: headEditors,
	editorDefaults: { enum: 'select' }
})
```

```svelte
<script>
	import Ide from '$lib/palette/components/Ide.svelte'
	import '$lib/palette/styles/palette.css' // core layout + edit chrome
	import '$lib/head/styles/head-default.css' // default head theme
	const top = $state([{ space: 0, toolbar: [{ tool: 'theme', editor: 'select' }] }])
</script>

<Ide {palette} {top}>
	<div>center content</div>
</Ide>
```

Tool specs: `toolId` (resolve), `toolId=value` (setter runner, legacy `toolId|value`), `toolId:action`
(action runner, e.g. `gameSpeed:inc`).

## Layout model

`PaletteBorders` = `{ top, right, bottom, left }`. Each border is a list of tracks;
each track is a list of `{ space, toolbar }` slots; each toolbar is a list of items
(`{ tool, editor?, config? }` or `{ editor, config?, toolbar? }` for editor-only items
like `commandBox` / `drawer`). Spacing values are normalized to unit (`clampUnit`).
`Ide` takes four optional borders + center slot; `Toolbar` renders one toolbar with
item/track/stack drop zones when editing.

## Editors

An editor is a Svelte component receiving `context: PaletteEditorContext`
(`{ item, tool, scope, flags, surface }`). Registries are keyed family → variant
(`run`, `boolean`, `number`, `enum`, `item`). `surface.axis` derives from region
(`top`/`bottom` → `horizontal`, `left`/`right` → `vertical`). Unknown tools render
nothing (inert by design). Configurators (`spec.configure`) receive an augmented
scope with `editorChoices` via `resolveConfiguratorContext`.

Heads are **dumb**: they render a headless presenter (`buttonPresenter`,
`togglePresenter`, `selectPresenter`, `sliderPresenter`, `commandBoxPresenter`,
`configuratorPresenter` in `src/lib/palette/presenters.svelte.ts`) and forward
gestures to its callbacks — no `tool.value = …`, no `tool.run()`, no command-box
entry builders inside `.svelte`.

The shipped head (`src/lib/head/registry.ts`) provides a small standard set:
`button` (run), `toggle` (boolean), `select` + `segmented` (enum),
`slider` + `stepper` (number), `commandBox` + core `drawer` (item). The demo adds
two `number` editors to prove extension — `slider` (same-key **override**, value
badge) and `stars` (**extension**, play/rating row). See `docs/creating-a-head.md`.

## Command box & console

The `commandBox` editor is a real **commands-combo-box** (text input + results popup,
Ctrl-Shift-P style) that runs commands inline on the toolbar — a run surface. The
**console** is a separate modal (opened by the `console` run tool / key); it opens in
edit mode when a `commandBox` is on the toolbar, else command-first with a square
edit-icon button (R/W only). Closing the console always stops edition.

`paletteCommandEntries` (run), `paletteAddItemEntries` (add sources),
`paletteDerivedVariants` (concrete insertable variants), `paletteCatalogEntries`
(full catalogue). `paletteCommandBoxModel({ entries, placeholder })` **must** be
created during component/module init (`$state` init-time constraint). Search query:
`{ free, keywords, categories }`; `#category` prefix in input filters categories.

## Drawer

`createPaletteDrawerEditor({ portalContainer })` returns the `drawer` item spec.
Child popup direction inverts the parent axis; child region follows
(`vertical` → `left`, `horizontal` → `top`). `open` (`click`/`hover`/`press`) and
`placement` (`start`/`center`/`end`) come from item `config`. Bump
`paletteDrawerCollapse.version` to close all popups. Portal mounts into
`document.body` via `mount()`; teardown unmounts + removes host + listeners.

## Persistence

`serializePaletteLayout` → JSON → `validatePaletteLayout` →
`hydratePaletteLayout` (init-only `$state`). The demo instead seeds
`structuredClone(initialIdeConfig)` `$state` at init (SSR-safe) and splices a
validated stored snapshot in `onMount`.

## Theming

Two stylesheets, imported once by the app (never injected at runtime):

- `palette.css` (core) — layout + edit-mode chrome (headless)
- `head-default.css` (head) — the default theme

`head-default.css` base rules are dark; `.palette-default-theme-light` overrides
them. The demo resolves `light`/`dark`/`system` (via `prefers-color-scheme`) and
syncs the class + `data-theme` + `color-scheme` onto `<html>` so body-portaled
drawer popups are covered. See `docs/theming.md`.

## Docs

- `docs/architecture.md` — decisions, runtime mapping, phase history
- `docs/getting-started.md` — setup, demo tour, first palette
- `docs/core-concepts.md` — tools, specs, registry, scope/surface/context
- `docs/layout-and-drag.md` — borders/tracks/spacing, actions, drag sessions
- `docs/command-box.md` — entries, model, add/catalog flows
- `docs/theming.md` — stylesheets, light override, demo chrome
- `docs/creating-a-head.md` — write a custom head (presenter contract, examples)
- `docs/using-the-default-head.md` — the shipped head, extension/override patterns
- `docs/testing.md` — unit + e2e inventory, gotchas
