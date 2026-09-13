# Getting started

## Prerequisites

Node 24.x, pnpm 11.x. Install once:

```sh
pnpm install
```

## Commands

| Command | What it does |
| ------------------ | ----------------------------------------------- |
| `pnpm dev` | Vite dev server (default SvelteKit port) |
| `pnpm check` | `svelte-kit sync && svelte-check` |
| `pnpm test` | Vitest unit suite (jsdom) |
| `pnpm test:e2e` | Playwright (builds + previews on port 4173) |
| `pnpm lint` | Biome check (tabs, single quotes, width 100) |
| `pnpm build` / `pnpm preview` | Production build / local preview |

Scratch files go in `sandbox/` (git-ignored), never `/tmp`.

## Demo tour (`src/routes/+page.svelte`)

The demo is a **Stellar Outpost** space-colony sim (`src/lib/demo/palette.svelte.ts`)
rendering an `Ide` with all four borders plus center content. It ships **three
preset loads** (`demoConfigs`) in the demo bar — plain command buttons (no
toggle state), each loading a fresh clone of its configuration's layout:

- **R/W + command box** — read-write; a `commandBox` combobox on the top toolbar
  runs commands inline, and the console opens in **edit mode**.
- **R/W command-first** — read-write; no combobox, so the console opens **command-first**
  with a square edit-icon button to enter/leave edit mode.
- **R-O + command box** — read-only (`editable: false`); the combobox runs commands but
  the layout is not editable.

- **Top**: command box, lockdown button, life-support + shields toggles,
  threat-level segmented
- **Left**: sim-speed slider, atmosphere select, power-focus segmented, nested
  drawer (atmosphere select + sim-speed stepper)
- **Right**: tax-rate slider, solar stepper, satisfaction stars
- **Bottom**: developer console, save, reset, hyper-tick toggle

The work-zone shows every colony variable as pills plus a colony-status panel
and an `mm:ss` elapsed-since-launch chip. Opening the console dims + disables
the work-zone (quake-style modal). In edit mode, toolbar items are **inert**
(`paletteItemShield`): run buttons/toggles/comboboxes are moved/removed or
selected for edition, never clicked.

Interactions to try:

1. **Command box** (top bar, ⌘) → a real combobox: type to search, run a command
   inline (Ctrl-Shift-P style). In "R/W + command box" mode the console opens in
   edit mode; hover a toolbar (blue chrome), `pointerdown` on an item highlights
   it and shows its presentation-only configurator in the console's *Details*
   panel; selecting an add entry shows its variants in the same place.
2. **Drawers**: `More` (left) opens a horizontal popup (axis inversion).
3. **Console**: `` ` `` key or `Terminal` button opens the overlay (toggles — the
   same shortcut closes it); parking + add-to-toolbar live in the console.
4. **Presets / save-load**: the demo bar loads each preset configuration, and a
   save/load button group round-trips the layout through `localStorage`
   (`svelette-demo-layout-v1`).

Theme control: the `theme` tool (`light`/`dark`/`system`) resolves via
`prefers-color-scheme` and syncs `.palette-default-theme-light` + `data-theme` +
`color-scheme` onto `<html>` (see `docs/theming.md`).

## Your first palette

```ts
import { headEditors } from '$lib/head/registry'
import { Palette } from '$lib/palette/core.svelte'

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
	editors: headEditors as never,
	editorDefaults: { enum: 'select' }
})
```

Full walkthrough: `docs/using-the-default-head.md`. Custom heads:
`docs/creating-a-head.md`.

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

Rules that bite newcomers (see `docs/core-concepts.md` for why):

- Runes only compile in `.svelte.ts` / `.svelte` — pure logic stays in `.ts`.
- `paletteCommandBoxModel(...)` and `hydratePaletteLayout(...)` must run during
  component/module init, never in handlers or after `await`.
- Tools are plain `$state` objects you supply; mutate `tool.value` directly.
- `Palette` instances are never `$state`-proxied — identity is plain `===`.
