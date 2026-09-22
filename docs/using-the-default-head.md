# Using the default head

> Historical note: this doc still shows the frozen svelte adapter (`packages/svelette`,
> DO NOT MAINTAIN) as the reference. The live adapters are `core` + `vanilla`.
> Vocabulary below is strict: **point** / **tool** / **control** / **configurator**
> (see `docs/core-concepts.md`). The word **editor** never appears except here.

Vocabulary: **points** are the points-list data definitions (no
layout — e.g. the fact *alert* can be `green`/`yellow`/`red`); **tools** are
the toolbar-bound controls that read/write a point (`{ point: spec, control?,
config? }` items resolved to a presenter + head component); **controls** are the
chosen front-ends (`button`, `toggle`, …); **configurators** are the
configuration panels (rendered in the console *Details*
panel). `status`, `commandBox`, `drawer`, and `theme` are **nothing-point tools**
(`theme` binds the `theme` nothing-point but owns no layout — it writes the
resolved theme onto `<html>` directly). See `docs/core-concepts.md` for the full glossary.

The default head is the standard minimal presentation for the
palette: a small set of controls per point family, dumb components bound to
headless core presenters. Use it as-is, then add custom controls only where you
need them.
The demo (`src/lib/demo/`, `src/routes/+page.svelte`) is the reference — it
renders **the default head verbatim for every family except `number`, where two
demo controls live**: `renderSlider` override (same `slider` key, adding a value badge) and `renderStars` (an **extension** the head
lacks — a play/rating row). Together they prove both replacement and extension.

## What's in the head (control per point family)

| Point family | Control | Presenter | Component | Configurator |
| ------ | ------ | --------- | --------- | --------- |
| run | `button` | `buttonPresenter` | `renderButton` | configurator |
| boolean | `toggle` | `togglePresenter` | `renderToggle` | configurator |
| enum | `select` | `selectPresenter` | `renderSelect` | configurator |
| enum | `segmented` | `selectPresenter` | `renderSegmented` | configurator |
| number | `slider` | `sliderPresenter` | `renderSlider` | configurator |
| number | `stepper` | `sliderPresenter` | `renderStepper` | configurator |
| item (nothing-point tool, context plus enablement) | `commandBox` | `commandBoxPresenter` | `renderCommandBox` | configurator |
| item (nothing-point tool, context plus enablement) | `drawer` | — (core portal) | `renderDrawer` (reused, not duplicated) | configurator |
| item (nothing-point tool, context plus enablement) | `status` | `statusPresenter` | `renderStatus` | configurator |
| item (enum-shaped nothing-point, adapter get/set on `<html>`) | `theme` | `themePresenter` | vanilla `renderTheme` | configurator |

Notes:

- **Context tools disable on skeleton.** A valued tool whose point declares
  `uses` (e.g. the fleet `shipShields` toggle / `shipPower` slider) is rendered
  `disabled` while its value is absent (`undefined`) — no ship selected means
  nothing to write to. Selecting a ship hydrates the bag and re-enables the
  tool in place; deselecting disables it again. An explicit functional `can` on
  the point overrides this default. Root-only valued tools stay enabled (the
  consumer hydrates the root store first).

- The console add panel differentiates *adding* from *editing*:
  selecting an entry builds a detached draft item (one source = one control, no picker;
  nothing-points list by point name and bind 1:1 to their `controls` allowlist)
  and shows the full configurator (same Label/Icon/Hint/Control/Tone/showValue/showText
  rows as the inspector, minus Delete, and minus Control whenever a single choice
  remains) bound to the draft, plus a disconnected preview
  below it (`console-add-preview`, `PREVIEW_SURFACE` horizontal/top): real choices/options
  from the point definitions with a local selected value seeded from the live store.
  Preview writes go to the preview core only (never `core.values` / `core.run`); the
  preview content is the sole drag source (pointerdown clones the draft into a `catalog`
  session).
- The `commandBox` tool is a real **commands-combo-box** (text input + results popup,
  Ctrl-Shift-P style): it runs commands inline on the toolbar. Running commands does *not*
  require the console; the console is a separate modal for edition (and command-first fallback).
- The `status` tool is a **nothing-point read-only readout** (a `<span>`, no interaction): it
  displays the first string value from its context bags (disabled + label placeholder when absent), or the
  `config.statusKey`-named key when set (e.g. the fleet `shipStatus` reads `shipName` while the bag also
  holds `shipId`). It modifies nothing in `core.values`.
  Time formatting is demo-owned (the demo ticks `mm:ss` into the bag) — core is an opaque-string pass-through.
  Horizontal fills the bar block-size via the generic toolbar-fill rule; **vertical** is a pinned `2.5rem` square
  stacking icon above minutes above seconds (`splitStatusTime`, strict `mm:ss` only — other strings fall back to a
  single value node so the square is never empty and the toolbar never widens).
- The `theme` tool is a **nothing-point cycle button** presenting the `light` / `dark` / `system` options with adapter get/set on the document root
  point with adapter get/set on the document root (`readThemeSetting` / `applyThemeSetting`): each click applies the next value
  (`.palette-default-theme-light` class + `data-theme` + `color-scheme`), so
  body-portaled drawer popups follow the same switch. It renders icon-value
  only (the current option's icon — ☀️/🌙/💻 — no text, like the toggle), so
  it sits as a compact square on the top bar's single track. `system` follows
  the OS `prefers-color-scheme` media query.

- `segmented` is the "radio-button" idiom: joined buttons where the selected one
  reads as pushed-in. `select` is the compact dropdown (custom button +
  listbox, no native `<select>`). Both are enum controls.
  In a **vertical** toolbar a segmented with icons
  shows icons only at rest and reveals the text on hover/focus as an overlay
  beside them — the toolbar never resizes. `config.showText: false` hides the
  option labels on **both** axes (icon-only buttons, mirroring the slider's
  `showValue: false`). The configurator exposes this as a "Show text"
  checkbox (`select` + `segmented`, checked by default).
- The `select` closed box always shows the tool icon (when declared) *and*
  the value icon — icon+value like numerics (☀️ over 1.2): side by side on a
  horizontal toolbar, stacked (tool above value) on a vertical one. Absent
  icons are **removed from the DOM** (never hidden placeholders), so an
  icon-less tool reserves no space — the trigger is exactly its label wide.
  The closed label follows `showText` (an option with no
  icon keeps its label so the trigger is never empty); the option list always
  renders icon (when declared) + full text and opens on click only (never
  hover). With `showText: false` the trigger is icons only and the list still
  carries the text. In a **vertical** toolbar with text enabled the label is a
  hover/focus overlay extending the icon stack into an icon+text select box
  beside the toolbar (same pattern as the vertical segmented overlay) — the
  toolbar never resizes. Skeleton (no option matches the value) renders a
  stylised `?` watermark (`.palette-default-select-watermark`, never the
  label class) instead of the closed label, so the trigger is never an empty
  box. The overlay/joint `:has(> .palette-default-choice-icon)` selectors are
  gated on `:not([hidden])` so lingering hidden icon nodes never trigger
  overlay chrome. `config.showFilter: true` adds a text-filter input pinned at
  the top of the list (`select` only, default hidden — the configurator exposes
  it as a "Filter list" checkbox beside "Show text"): typing hides
  non-matching rows by case-insensitive substring over label + value, Enter
  runs the first visible row, Escape closes, and the query clears on close.
  Enum option lists are live: `core.defineEnumOptions(id, options)` replaces
  the list (validated — unknown id, non-enum, empty, or duplicate values
  throw) and `defineVirtual`/`removeVirtual` cover `enum-from` virtuals; both
  emit a per-point definition notification (`subscribeDefinitions`) that the
  vanilla adapter reconciles in place (rows/buttons insert + remove, open
  state + focus preserved, trigger patched text-node-only). A current value
  with no matching option keeps rendering the `?` skeleton.
- `stepper` is a ± button pair for integer/stepped values; `slider` is the
  continuous range. Both are number controls (they share `sliderPresenter`).
  A slider's range is `inline` by default, running along the toolbar axis;
  the `drawerSlider` control moves it out of the flow onto the
  perpendicular axis, revealed as an attached input-group segment on hover
  (trigger keeps the toolbar-outer half-rounding, the range takes the
  workspace-side half, shared edge flat).
  `config.sliderVariant` (`'inline' | 'drawer'`) selects a layout when the
  control id is neither `slider` nor `drawerSlider`. The current value is
  shown next to the icon by default; `config.showValue: false` hides the
  number (icon-only chip) for `slider` / `drawerSlider` — steppers always
  show it, stars never do. The configurator exposes this as a "Display
  number" checkbox.
- `commandBox` adapts to the surface axis: horizontal renders the full input +
  results popover inline; **vertical** renders an icon-only square trigger whose
  input and popover are overlays that open over the IDE without widening the
  toolbar. Horizontally the input is revealed on hover/focus; at rest the shell
  shows the icon plus the current text (or a muted hint while empty).

Plus the vanilla configurator (generic label/icon/hint/control/tone panel) and
`head-default.css` (head-owned theme; `palette.css` stays core-owned).

## Per-item `config` reference (canonical — core `HeadItemConfig` + `DrawerToolbarItem`)

Absent key = default everywhere. Adapters read via core presenters /
`drawerOpenOf` — never `config.xxx` inline.

| Key | Controls | Default | Notes |
| --- | --- | --- | --- |
| `icon` / `label` / `hint` / `tone` | all | point/control/`'Item'`, `neutral` | `headMeta` |
| `showValue` | `slider`, `drawerSlider` | shown (`false` hides) | steppers always show, stars never do |
| `showText` | `select`, `segmented` | shown (`false` hides) | icon+text when shown, icon-only when hidden; list rows always full text |
| `showFilter` | `select` | hidden (`true` shows) | listbox filter input |
| `sliderVariant` | legacy fallback only | `'inline'` | explicit `slider` → inline / `drawerSlider` → drawer control ids win; no configurator row writes the raw key |
| `statusKey` | `status` | first non-empty string in bag | names the bag key to display |
| `open` | `drawer` | `'click'` | `'click'` toggle / `'hover'` open + delayed close (`configuration.drawerHoverCloseMs`) / `'press'` pointerdown toggle |

Enum `values`/`keywords` live on the point definition (consumer-owned), not
per-item config; enum subsets arrive via `VirtualPoints` (`enum-from`).

Control-switch cleanup (`configuratorControlCleanup`) prunes stale keys:
sliders keep `showValue`; `select` keeps `showText` + `showFilter`;
`segmented` keeps `showText`; `drawer` keeps `open`; `status` keeps
`statusKey`. The vanilla configurator exposes Open mode (drawer), Status key
(status), Display number (sliders), Show text (select/segmented), Filter list
(select).

## Minimal setup (historical svelte sample — live API is `core` + `vanilla`)

```ts
// palette.ts
import { headEditors } from '$lib/head/registry'
import { Palette } from '$lib/palette/edition.svelte'

export const palette = new Palette({
	tools: {
		autoOxygen: { type: 'boolean', label: 'Life Support', value: true, default: true },
		alertLevel: {
			type: 'enum', label: 'Threat', value: 'green', default: 'green',
			values: [{ value: 'green' }, { value: 'red' }]
		},
		gameSpeed: {
			type: 'number', label: 'Sim Speed', value: 1, default: 1, min: 0.5, max: 5, step: 0.5
		},
		emergencyProtocol: { label: 'Lockdown', get can() { return true }, run() {} }
	},
	keys: { N: 'autoOxygen', '1': 'alertLevel=green', '+': 'gameSpeed:inc', E: 'emergencyProtocol' },
	editable: true,
	editors: headEditors as never,
	editorDefaults: { run: 'button' }
})
```

```svelte
<!-- +page.svelte -->
<script>
	import Ide from '$lib/palette/components/Ide.svelte'
	import { palette } from './palette'
	import '$lib/palette/styles/palette.css'
	import '$lib/head/styles/head-default.css'

	const top = $state([
		{ space: 0.1, toolbar: [{ editor: 'commandBox' }] },
		{
			space: 0.5,
			toolbar: [
				{ tool: 'autoOxygen', editor: 'toggle' },
				{ tool: 'alertLevel', editor: 'select' },
				{ tool: 'gameSpeed', editor: 'slider' },
				{ tool: 'emergencyProtocol', editor: 'button' }
			]
		}
	])
</script>

<Ide {palette} {top}>
	<div>center content</div>
</Ide>
```

Notes:

- `keys` accepts a raw map (`{ E: 'emergencyProtocol' }`) — `Palette` normalizes it via
  `createPaletteKeys`. Setter specs use `toolId=value` (`|` is legacy); actions use
  `toolId:action` (`gameSpeed:inc`).
- `editorDefaults: { run: 'button' }` lets run items omit `editor`.
- Import **both** stylesheets once: `palette.css` (core layout + edit chrome) and
  `head-default.css` (head theme). Never inject CSS at runtime.
- Optional icon factory (maps string names to components; unset falls back to text):

```ts
import { icons } from '$lib/head/icons.svelte'
import Star from '$lib/icons/star.svelte'

icons.factory = (name) => (name === 'star' ? Star : undefined)
```

## Extending with custom controls (the demo pattern)

Keep the head as fallback; add extras per family. There are two mechanisms:

```ts
import { headEditors } from '$lib/head/registry'
import { demoEditors } from './editors/registry'

editors: {
	boolean: { ...headEditors.boolean, ...demoEditors.boolean },
	enum: { ...headEditors.enum, ...demoEditors.enum },
	number: { ...headEditors.number, ...demoEditors.number },
	item: { ...headEditors.item, ...demoEditors.item },
	run: { ...headEditors.run, ...demoEditors.run }
} as never,
```

Per-family spread (not a top-level `{ ...headEditors, ...demoEditors }`) matters:
a top-level spread would replace whole families and drop the head fallback.

- **Override (same key)** — register a control under a key the head already owns,
  e.g. `number.slider`.
- **Extend (new key)** — register a control the head lacks, e.g. `stars`
  (a play/rating row of `▶`/`▷` triangles reusing `sliderPresenter`,
  referenced from a single toolbar item
  (`{ point: 'gameSpeed', control: 'stars' }`)). Everything else keeps rendering
  through the default head.

The shipped demo keeps exactly **two** custom controls (`number.slider` override
+ `number.stars` extension); the rest of the demo resolves through the head
verbatim, so every run exercises the head.

## Tool config (`config:` payload)

Tools read per-item `config`: `icon`, `label`, `hint`, `tone` (`neutral`/`accent`),
plus `showValue` (sliders), `showText` (select/segmented), `showFilter`
(select), `statusKey` (status), `open` (drawer), and the legacy
`sliderVariant` fallback (honored by `sliderPresenter`/`selectPresenter`).
`accent` paints an accent border + outer glow on every control (see
`docs/theming.md` "Accent tone"); `neutral` (the default) renders standard chrome.
The console's *Details* panel renders the presentation-only inspector,
which edits these live, including the control chooser (`controlChoices`).

## Read-only vs editable imports

- Read-only (predefined layout, `editable: false`): import from
  `$lib/palette/core.svelte` — display + run, no mutation surface.
- Editable: import from `$lib/palette/edition.svelte` (re-exports `core`).
- `$lib/palette/edition.svelte` re-exports `core`, so a single import suffices.
