# Using the default head

Vocabulary below is strict: **point** / **tool** / **control** / **configurator**
(see `docs/core-concepts.md`). The word **editor** never appears except here.

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
The demo (`packages/vanilla/demo/`) is the reference — it
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
| item (enum-shaped nothing-point, adapter get/set on `<html>`) | `theme` (opt-in via `IdeOptions.theme`) | `themePresenter` | vanilla `renderTheme` / Vue `ThemeTool.vue` | configurator (gated) |

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
- The `theme` tool is a **nothing-point cycle button** presenting the `light` / `dark` / `system` options, **opt-in** via `IdeOptions.theme`
  (`true` creates one `ThemeSetting` mirror for the IDE lifetime; pass a
  `createThemeSetting()` mirror to share it, or omit it and the tool never
  renders — no add-box row, no configurator choice, no document-root write).
  Reads come from the `ThemeSetting` mirror when present (`HeadContext.theme`,
  plain `.value` in vanilla / `useThemeSetting(setting).value` in Vue), else
  the document root directly (`readThemeSetting`); writes go through
  `theme.set` (or `applyThemeSetting` on the legacy path) — never through
  `core.values`. Each click applies the next value
  (`.palette-default-theme-light` class + `data-theme` + `color-scheme`), so
  drawer popups follow the same switch. It renders icon-value
  only (the current option's icon — ☀️/🌙/💻 — no text, like the toggle), so
  it sits as a compact square on the top bar's single track. `system` follows
  the OS `prefers-color-scheme` media query. Custom heads stay observable
  without the tool: subscribe to the mirror (`theme.subscribe`) and re-render
  the `themePresenter` view-model on change — verified by unit test.

- `segmented` is the "radio-button" idiom: joined buttons where the selected one
  reads as pushed-in. `select` is the compact dropdown (custom button +
  listbox, no native `<select>`). Both are enum controls.
  In a **vertical** toolbar a segmented with icons
  shows icons only at rest and reveals the text on hover/focus as an overlay
  beside them — the toolbar never resizes. `config.showText: false` hides the
  option labels on **both** axes (icon-only buttons, mirroring the slider's
  `showValue: false`). The configurator exposes this as a "Show text"
  checkbox (`select` + `segmented`, checked by default). Segmented option
  tooltips (`button.title`) always carry icon + text, so the text survives
  as the tooltip when the label is hidden.
- `button` (run) follows the same vertical pattern: an icon button shows its
  label as a hover/focus overlay beside the bar (segmented side — left border
  opens right, right border opens left), so the toolbar never resizes. An
  icon-less button keeps its label in flow on both axes (no overlay gate, no
  reserved popout space — the `showText: false` equivalent). Toggle/theme
  carry no label node at all, so they never match the overlay gate.
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
| `open` | `drawer` | `'toggle'` | `'toggle'` primary-button pointerdown toggle (+ keyboard `click` fallback) / `'hover'` open + delayed close (`configuration.drawerHoverCloseMs`); legacy `'click'`/`'press'` normalize to `'toggle'` |
| `closeOnClick` | `drawer` | `false` (`true` closes) | opt-in: command / toggle / segmented activation inside closes ancestors — bottom-up `closeOnClick` run maxed with the highest `hover` ancestor |

Enum `values`/`keywords` live on the point definition (consumer-owned), not
per-item config; enum subsets arrive via `VirtualPoints` (`enum-from`).

Control-switch cleanup (`configuratorControlCleanup`) prunes stale keys:
sliders keep `showValue`; `select` keeps `showText` + `showFilter`;
`segmented` keeps `showText`; `drawer` keeps `open` + `closeOnClick`; `status` keeps
`statusKey`. The vanilla configurator exposes Open mode + Close on click (drawer), Status key
(status), Display number (sliders), Show text (select/segmented), Filter list
(select).

## Custom icons (vanilla)

Core keeps icons opaque (`IconToken = string` — pass-through only, never
rendered). The vanilla adapter renders every icon as `textContent`, so the
default is emoji passthrough. Consumers own name resolution via two
`IdeOptions` hooks (both optional; unset = identity + plain text input):

- `iconResolver: (token) => glyph | undefined` — threaded into every
  `HeadContext` and applied before `fillIcon` / `takeIcon` / `iconSpan`.
  Return `undefined` to keep the token as-is. Convention: tokens starting
  with `icon:` are dictionary names; everything else passes through.
  Unknown `icon:` names fall back to the raw token (debuggable, never
  blank). Hardcoded chrome (`🗑` parking delete, `⌘` shell fallback, `?`
  select watermark) bypasses the resolver.
- `iconChoices` + `renderIconField({ value, onChange, choices })` — replaces
  the configurator Icon row's default text input when provided. The demo
  proves the pattern with a native `input` + `datalist` (predefined values
  selectable, free text still typable): see
  `packages/vanilla/demo/icons.ts` (`DEMO_ICONS`, `demoIconResolver`,
  `renderDemoIconField`) wired in `demo/main.ts` via `createIDE`.

## Localizable strings (intl seam)

Hard-coded English is the default everywhere; every table is overridable.
Core ships `defaultCatalogStrings`, vanilla ships `defaultIdeStrings` —
locales stay consumer-owned (the demo owns FR in
`packages/vanilla/demo/i18n.ts`).

- Core (`CatalogStrings`, `packages/core/src/strings.ts`): sentence builders
  (`toggle/enable/disable/setTo/increase/decrease/incrementBy/...`), add-flow
  + command/key-edit metas, search keyword families, and render-time
  `pointLabels`/`pointHints`/`optionLabels` dictionaries (checked before the
  item config and the definition — no rebuild on switch). `PaletteCoreOptions.strings` (partial,
  merged over English) seeds `core.strings`; `core.setStrings(partial)`
  switches live. Nested dictionaries merge per key (`pointLabels`,
  `pointHints`, per-point `optionLabels`); keyword arrays replace wholesale.
  Pure builders take `CommandBoxContext.strings` (partial);
  `describeRunnable` takes an optional strings override. `humanizeId`
  (shared with `humanizeCommandText`) stays the last-resort fallback. Point `label` is optional on the definition:
  omit it and rely on the dictionary alone. `consolePointDescriptor` takes an
  optional `strings` pick so the console label + keywords follow the locale.
  `bundleCatalogStrings(bundle)` resolves a `LocaleBundle` to its catalog
  override (top-level dictionaries win, `catalog.*` is a legacy alias).
- Vanilla (`IdeStrings`, `packages/vanilla/src/strings.ts`): placeholders,
  empty states (incl. the empty-stack drop-zone hint, rendered via
  `data-empty-text` → CSS `attr()` so it localizes), console titles/aria
  labels, details titles, configurator row keys, tone/open-mode options,
  control display names. `IdeOptions.strings`
  (static partial) or `IdeOptions.stringsForLocale(locale)` (called per
  render with the live value of `localePointId`, default `'locale'`).
  The IDE subscribes to that point and re-renders borders + console on
  change — reactive switch, no rebuild. The IDE also pushes
  `bundle.catalog` into `core.strings` per render (`syncCatalogStrings`),
  so console catalog rows follow the locale with no consumer `setStrings`
  call; `controlNames` merges per control id.
- Demo pattern: `locale` valued enum point (`en`/`fr`, segmented control,
  flag icons via `demoIconResolver`), excluded from defaults/dirty/reset like
  `theme`; `main.ts` seeds `en`, subscribes to switch `document.documentElement.lang`
  (catalog follows via the IDE bundle), and passes `stringsForLocale` to
  `createIDE`. A per-locale `LocaleBundle`
  (`{ catalog?, pointLabels?, pointHints?, optionLabels? }`, vanilla adds
  `ide?`) carries all three — dictionaries live top-level (authoritative);
  presenters take an optional `DisplayStrings`
  threaded from `HeadContext.display` (fallback chain: dictionary →
  `config.label/hint` → `point.label` → `humanize(id)`; options: dictionary →
  `option.label` → `option.value`).

## Minimal setup

```ts
// demo/palette.ts — point definitions
export const points = [
	{ id: 'autoOxygen', type: 'boolean', label: 'Life Support' },
	{
		id: 'alertLevel', type: 'enum', label: 'Threat',
		values: [{ value: 'green' }, { value: 'red' }]
	},
	{ id: 'gameSpeed', type: 'number', label: 'Sim Speed', min: 0.5, max: 5, step: 0.5 },
	{ id: 'emergencyProtocol', type: 'action', label: 'Lockdown', run() {} }
]

export const keys = {
	N: 'autoOxygen!',
	'1': 'alertLevel=green',
	'+': 'gameSpeed+=0.5',
	E: 'emergencyProtocol'
}
```

```ts
// demo/main.ts — page wiring
import { PaletteCore } from '@palettable/core'
import { createIDE } from '@palettable/vanilla'
import '@palettable/core/styles/palette.css'
import '@palettable/core/styles/head-default.css'
import { points, keys } from './palette.js'

const core = new PaletteCore(points, {
	initialValues: { autoOxygen: true, alertLevel: 'green', gameSpeed: 1 }
})

createIDE(document.querySelector('#app')!, {
	core,
	keys,
	editable: true,
	borders: {
		top: [{
			space: 1,
			toolbar: [
				{ point: 'autoOxygen', control: 'toggle' },
				{ point: 'alertLevel', control: 'select' },
				{ point: 'gameSpeed', control: 'slider' },
				{ point: 'emergencyProtocol', control: 'button' }
			]
		}]
	}
})
```

Notes:

- `keys` accepts a raw map (`{ E: 'emergencyProtocol' }`) — the adapter
  normalizes it. Specs: `id` (action), `id=value` (pure setter),
  `id!` (boolean toggle), `id+=x` / `id-=x` (number step by explicit amount).
- `controlDefaults` lets items omit `control` for a family.
- Import the stylesheets once from core: `palette.css` (layout + edit chrome)
  and the theme sheets (`head-default.css`, `head-dark.css`, `head-light.css`).
  Never inject CSS at runtime.
- Icons are opaque string tokens; the adapter resolves them with its own icon
  resolver (`resolveIcon` in the reference adapter, overridable per app — see
  "Custom icons" above).

## Extending with custom controls (the demo pattern)

Keep the head as fallback; add extras per family. There are two mechanisms:

```ts
import * as head from '@palettable/vanilla'

const myHead = {
	boolean: { ...head.headControls.boolean },
	enum: { ...head.headControls.enum },
	number: { ...head.headControls.number, slider: renderBadgeSlider, stars: renderStars },
	item: { ...head.headControls.item },
	run: { ...head.headControls.run }
}
```

Per-family spread (not a top-level `{ ...headControls, ...myHead }`) matters:
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

## Read-only vs editable

- A palette is read-only when its options carry `editable: false` — no edit
  chrome, no console mode toggle, the layout is not editable.
- Otherwise the console's mode toggle (or a bound command-box) drives the edit
  mode, and `core.run(spec)` is the single execution path for every control.
