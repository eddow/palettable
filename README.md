# palettable

[![npm version core](https://img.shields.io/npm/v/@palettable/core.svg)](todo) [![npm version svelte](https://img.shields.io/npm/v/@palettable/svelte.svg)](todo) [![npm version vanilla](https://img.shields.io/npm/v/@palettable/vanilla.svg)](todo) [![npm downloads](https://img.shields.io/npm/dm/@palettable/core.svg)](todo) [![CI](https://github.com/eddow/palettable/actions/workflows/ci.yml/badge.svg)](todo) [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://github.com/eddow/palettable/blob/main/LICENSE) [![GitHub stars](https://img.shields.io/github/stars/eddow/palettable.svg)](https://github.com/eddow/palettable) [![Live Demo](https://img.shields.io/badge/Live_Demo-todo-black)](todo)

Headless palette primitives + heads — editable toolbars for any app.

The palette owns state, a11y semantics, tool resolution, editing, and drag/drop — **not** styling. Adapters own markup and CSS. Define **points** (what is controlled), bind them to toolbars as **tools** (controls), and configure each tool with an **editor** (config panel).

- Framework-agnostic core (`@palettable/core`): vanilla TS, zero DOM, SSR-safe.
- Thin adapters render the core: Svelte 5 runes (`@palettable/svelte`, the reference implementation), vanilla DOM (`@palettable/vanilla`), Vue planned.
- Ships a default head (minimal presentation), a command-box (Ctrl-Shift-P style), a developer console for live editing, drawers, drag/drop reorganisation, persistence, and theming.

## Vocabulary

| Term | Meaning |
| ---- | ------- |
| **point** | A data definition in `tools` — no layout. `action` (runnable, e.g. `saveGame`), `boolean` / `enum` / `number` (valued with restorable default), `nothing` (context-only). Never placed on a toolbar itself — placed *as* a tool. |
| **tool** | A toolbar-bound control (`{ tool: spec, editor?, config? }`) resolved through the registry to a presenter + head component. Buttons, toggles, selects, sliders, steppers are tools. |
| **editor** | The tool's variant id (`'button'`, `'toggle'`, …) plus its configuration panel (`BaseConfigurator`: label/icon/hint/variant/tone/delete). Rendered in the console *Details* panel, not on the toolbar. |
| **pointless tool** | Binds no point: `status` (read-only readout), `command-box` (inline command runner), `drawer` (nested toolbar, axis-inverted popup). |

Tool specs: `toolId` (resolve), `toolId=value` (setter runner, e.g. `alertLevel=red`), `toolId:action` (action runner, e.g. `gameSpeed:inc`).

## Packages

| Package | Description |
| ------- | ----------- |
| `packages/core` (`@palettable/core`) | Headless primitives: points, store, layout tree, keys, command-box builders, console store, presenters/view-models, SSR render model, `palette.css` + `theme/head-default.css`. Zero DOM. |
| `packages/svelte` (`@palettable/svelte`) | Svelte 5 runes adapter + default head (`src/lib/head/`) + Stellar Outpost demo. The working reference — stays untouched until vanilla + vue reach parity (see `plans/mitosis.md`). |
| `packages/vanilla` (`@palettable/vanilla`) | Vanilla-DOM adapter + demo. Owns DOM rendering, pointer math, drag sessions, head components — never core. |
| `packages/vue` | Planned second reactive adapter (after vanilla parity). |

## Prerequisites

Node 24.x, pnpm 11.x. Install once:

```sh
pnpm install
```

## Commands

| Command | What it does |
| ------- | ------------ |
| `pnpm dev` / `pnpm dev:svelte` | Svelte demo dev server |
| `pnpm dev:vanilla` | Vanilla demo dev server (`:4174`) |
| `pnpm build` | Build core + vanilla + svelte |
| `pnpm check` | Typecheck all packages |
| `pnpm test` | Unit tests all packages (Vitest) |
| `pnpm test:e2e` | Playwright conformance suite (`tests/e2e/`) |
| `pnpm lint` / `pnpm lint:fix` | Biome check / fix (tabs, single quotes) |
| `pnpm preview:svelte` / `pnpm preview:vanilla` | Preview production builds |

Scratch files go in `sandbox/` (git-ignored), never `/tmp`.

## Minimal usage

Core only (framework-agnostic):

```ts
import { PaletteCore } from '@palettable/core'

const core = new PaletteCore([
	{ id: 'saveGame', label: 'Save game', type: 'action', run() {} },
	{ id: 'theme', label: 'Theme', type: 'enum', value: 'dark', default: 'dark', values: [{ value: 'light' }, { value: 'dark' }] },
])

core.run('saveGame')
core.values.set('theme', 'light')
```

Svelte + default head:

```ts
import { headEditors } from '$lib/head/registry'
import { Palette } from '$lib/palette/edition.svelte'

const palette = new Palette({
	tools: {
		theme: { type: 'enum', label: 'Theme', value: 'dark', default: 'dark', values: [{ value: 'light' }, { value: 'dark' }] },
	},
	keys: { E: 'theme=dark' },
	editable: true,
	editors: headEditors,
	editorDefaults: { enum: 'select' },
})
```

```svelte
<script>
	import Ide from '$lib/palette/components/Ide.svelte'
	import '$lib/palette/styles/palette.css'
	import '$lib/head/styles/head-default.css'
	const top = $state([{ space: 0, toolbar: [{ tool: 'theme', editor: 'select' }] }])
</script>

<Ide {palette} {top}>
	<div>center content</div>
</Ide>
```

Vanilla adapter:

```ts
import { VanillaAdapter } from '@palettable/vanilla'

const adapter = new VanillaAdapter([
	{ id: 'saveGame', label: 'Save game', type: 'action', run() {} },
])
document.querySelector('#app')?.append(adapter.root)
adapter.mount()
```

## Demos

Both demos render the same **Stellar Outpost** space-colony sim — all four borders plus center content, three preset loads (R/W + command box, R/W command-first, R-O + command box), drawers, console (`` ` ``), parking, save/load via `localStorage`.

- Svelte: `packages/svelte/src/routes/+page.svelte` → preview on `:4173`
- Vanilla: `packages/vanilla/demo/main.ts` + `index.html` → preview on `:4174`

`tests/e2e/` is the shared conformance suite: one Playwright project per demo, all running the same specs. Parity must be exact — specs assert concrete DOM.

## Features

- **Layout**: `Ide` + four borders → tracks → `{ space, toolbar }` slots → items. Track spacing sums to 1 (stored gaps + implicit trailing gap). Parking is an independent toolbar stack with ownership guarantees.
- **Drag/drop**: preview-is-moving sessions (`slide` vs `restructure`), toolbar moves, tool→track singleton creation, tool→toolbar merge, gap dwell, parking drops. Pointer math lives in adapters; commits go through structural methods (`moveItem`, `moveToolbar`, …).
- **Command-box**: real combobox running commands inline (Ctrl-Shift-P style). Entry builders (`paletteCommandEntries`, `paletteAddItemEntries`, `paletteDerivedVariants`, `paletteCatalogEntries`) + scored search model (`free`/`keywords`/`categories`, `#cat` prefix).
- **Console**: quake-style modal for edition + command-first fallback. Opens in edit mode when a command-box is toolbar-bound, else command-first with an edit toggle (R/W only).
- **Drawers**: nested toolbars in axis-inverted popups (`mount` portal, `open`/`placement` from item `config`, global collapse signal).
- **Virtual points**: end-user-derived `enum-from` (any value as enum/subset) and `stash` (push-aside/pop-back toggle) — registered or inline per item.
- **Context tools**: `uses` bags (`ValuesBag`), functional `can`, `evaluateCan`/`subscribeCan` (flips only), `subscribeContext` — root bag is core-owned, context bags are host-owned.
- **SSR**: pure sync render model (definitions + virtuals + layout + values → render tree), atomic snapshots, config pinning, value codecs, JSON-stable output, no `run`/`set`/DOM/timers on the render path.
- **Theming**: two global stylesheets, imported once — `palette.css` (core layout + edit chrome) and `head-default.css` (default head, dark base + `.palette-default-theme-light` override synced onto `<html>`).
- **Persistence**: `serialize` → JSON → `validate` → `hydrate` round-trips (layout + parking + inline virtuals).
- **Keys**: normalized keystroke map (`Ctrl`/`Alt`/`Shift`/`Meta` order, `cmd`→`Meta`, `escape`→`Esc`), spec-prefix matching, IDE-root `keydown` resolution.

## Docs

Start with `docs/getting-started.md` (setup, demo tour, first palette), then:

- `docs/architecture.md` — decisions, runtime mapping, phase history
- `docs/core-concepts.md` — points, tools, specs, registry, `uses` contract
- `docs/layout-and-drag.md` — borders/tracks/spacing, drag sessions
- `docs/movements.md` — toolbar movement & reorganisation principles
- `docs/command-box.md` — entries, model, add/catalog flows
- `docs/using-the-default-head.md` — shipped head, extension/override patterns
- `docs/creating-a-head.md` — presenter contract, custom tools
- `docs/theming.md` — stylesheets, light override, demo wiring
- `docs/testing.md` — unit + e2e inventory, gotchas

Active work lives in `plans/` (`mitosis.md`, `ssr.md`, `context.md`, `movement.md`, …). Per `AGENTS.md`: implement from `/plans/`, then migrate permanent decisions into `/docs/`.

## Testing

- Core unit (Vitest, node): `pnpm --filter @palettable/core test`
- Svelte unit (Vitest, jsdom): `pnpm --filter @palettable/svelte test`
- Vanilla unit: `pnpm --filter @palettable/vanilla test`
- E2E (Playwright): `pnpm test:e2e` — see `docs/testing.md` for the full inventory.

## Status

Active migration: split the self-contained Svelte implementation into `core` + `vanilla` + `vue` + thin `svelte` (`plans/mitosis.md`). Core (SSR + context) and the vanilla adapter exist and are green; Svelte stays the untouched oracle until vanilla, then Vue, reach demo parity — only then does Svelte become a thin adapter over core.

## License

GNU Affero General Public License v3.0 — see `LICENSE`.
