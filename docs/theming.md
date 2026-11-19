# Theming

Four stylesheets, all imported once by the app — never injected at runtime,
never duplicated per instance:

| File | Owner | Contents |
| ---- | ----- | -------- |
| `core/styles/palette.css` | core (headless) | layout (`palette-ide`, borders, tracks, toolbars, spaces), edit-mode hover/active chrome, drawer popup shell layout (`.palettable-drawer__*` — paint via `--pd-drawer-*` tokens with dark fallbacks) |
| `core/styles/head-default.css` | head (default theme) | structural chrome (§§1–12: buttons, panels, command box, controls, vertical, joined-box, configurator) — no raw colors, tokens referenced only |
| `core/styles/head-dark.css` / `core/styles/head-light.css` | head themes | `--pd-*` tokens (§0, incl. `--pd-drawer-*` popup paint); import the base plus **one** theme (dark is the default when neither class applies) |

## Rules

- CSS is always global unless true component scoping is required. Selectors stay
  specific through class hierarchy (`.palette-ide.editing .toolbar:hover::before`),
  never bare names. No `data-palette-id` scoping — one palette is editable at a
  time, so per-instance `<style>` elements are pure overhead.
- No runtime CSS injection exists anywhere — the stylesheets are plain files the
  app imports once (`PaletteCore` has no style surface at all).
- Drawer popup classes use the `palettable-` prefix.

## Sizing variables

`palette.css` declares two custom properties on `.palette-ide`:

| Variable | Value | Meaning |
| -------- | ----- | ------- |
| `--palette-dz-size` | `0.5em` | Drop-zone highlight unit; the edit-mode handle is `2 ×` this. |
| `--palette-toolbar-perpendicular` | `2.5rem` | Standardized perpendicular toolbar size — height for horizontal toolbars, width for vertical ones. Identical on both axes. |

Rules:

- Every toolbar (border **or** parking, either axis) is exactly
  `--palette-toolbar-perpendicular` at rest, and items fill it. The resting
  size therefore never depends on whether a handle is shown.
- Handles are added **outside** that size on hover (they are perpendicular
  borders of `2 × --palette-dz-size`), so hovering grows the toolbar rather
  than reflowing its items.
- Parking toolbars are **excluded** from the handle rules: they are not in a
  stack, so a handle there only reads as a double border.

## Axis-aware items

Controls receive the surface axis via `context.surface` (vanilla) /
`surfaceContextFromScope` and stamp `palette-default-layout-${direction}`
on their root. Several controls use it to avoid widening a vertical toolbar:

- **`segmented`** — at rest a vertical segmented shows icons only. The option
  text is an absolutely positioned overlay revealed on `:hover`/`:focus-visible`
  beside the icons (`pointer-events: none`, so the icons stay the only hit
  targets). Text-only display (`choiceDisplay: 'text'`, no icon) keeps its label
  in flow. The overlay side follows `palette-default-region-${region}`.
- **`commandBox`** — in a vertical toolbar the box is an icon-only square whose
  shell grows sideways on hover/focus while the toolbar width stays fixed.
  Horizontally the shell shows the point icon plus a rest-state readout of the
  current text while non-empty (icon-only while empty — no redundant hint);
  the input is revealed on hover/focus only, replacing the readout. The
  readout is driven by `data-has-text` on the box.
- **`slider`** — two variants, both carrying the numeric value in the
  presenter (`text`):
  - **`inline`** (default) keeps the range in the toolbar and runs it *along*
    the toolbar axis — horizontal in a horizontal toolbar, vertical in a
    vertical one (`writing-mode: vertical-lr` + `direction: rtl`). In a
    vertical toolbar it may grow along the axis, but its perpendicular width
    stays at `--palette-toolbar-perpendicular`.
  - **`drawer`** (the `drawerSlider` control id) keeps the range out of the
    flow, running it along the *perpendicular* axis — the opposite of inline.
    The icon and value form the always-visible trigger segment; the range is a
    second segment revealed on hover/focus, sharing one border so the pair
    reads as a button group with only the outer corners rounded.
  - `config.sliderVariant` selects a layout when the control id is not one of
    the two slider ids; the control id always wins.

  Both variants render `.palette-default-slider-value` — the icon nests inside
  the chip (icon + text), sharing every declaration with
  `.palette-default-stepper-value` so the two read as the same control. The
  range always sits inside a visible `.palette-default-slider-track` pill
  half: the readout (or drawer trigger) is the first half, the track the
  second — shared border, outer corners rounded, input filling 100% of it.
  Note that
  `writing-mode: vertical-lr` swaps an element's own logical axes, so the
  rotated ranges size themselves with physical `width`/`height`.

## Vertical stacking order

Vertical groups (`segmented`, `split`, `stepper`, `stars`) use
`flex-direction: column-reverse`, so **DOM order is visually inverted**: the
first child renders at the *bottom*. Radius and margin rules must therefore
follow the *visual* ends — `:first-child` (DOM) rounds the bottom corners and
`:last-child` rounds the top ones. Writing them the other way around leaves the
rounded ends inverted.

## Tokens (`head-dark.css` / `head-light.css` §0)

All paint lives in `--pd-*` custom properties: dark tokens on `:root` in
`head-dark.css`, light tokens under `.palette-default-theme-light` in
`head-light.css`. No raw color appears in `head-default.css` — every
`background` / `border-color` / `box-shadow` / `color` rule references a
token. Adding a new paint value means adding a token in both theme files,
not a light-override selector.

| Token family | Dark | Light |
| ------------ | ---- | ----- |
| `--pd-border*` (chrome, panel, faint, field) | slate `71,85,105` | `148,163,184,0.9` |
| `--pd-surface*` (chrome, soft, ghost, status, track) | `15,23,42` | `241,245,249,0.96` / `#ffffff` |
| `--pd-panel*` (popovers, console panel) | `2,6,23,0.98` / `#020617` | `#ffffff`-ish |
| `--pd-tool-bg` | slate gradient | flat `241,245,249,0.96` |
| `--pd-muted` / `--pd-faint` / `--pd-icon` / `--pd-status-fg` | `#94a3b8` / `#64748b` / `#93c5fd` / `#bfdbfe` | `#475569` / `#64748b` / `#475569` / `#1d4ed8` |
| `--pd-accent*` / `--pd-selected-*` / `--pd-option-ring` | blue `#3b82f6` + outer glow | deep blue `#1d4ed8` + glow |
| `--pd-star*` / `--pd-drag-border` | `#facc15` / `#f59e0b` / accent dashed | unchanged |
| `--pd-drawer-*` (popup border/bg/shadow) | dark slate / near-black / black shadow | border → `--pd-border`, bg → `--pd-surface`, same shadow |
| `--pd-r-*` / `--pd-ease` / `--pd-slide` | `9/10/12/14/18px`, `120/140ms` | unchanged |

The `theme` tool (an enum-shaped nothing-point tool, like `status` but
presenting `light`/`dark`/`system` options) is **opt-in**: pass
`theme: true` (vanilla `IdeOptions` / Vue `PaletteIde` prop) or a
`ThemeSetting` from `createThemeSetting()` to offer the `theme` control;
omit it and the tool never renders — no add-box row, no configurator
choice, no document-root write. `createThemeSetting()` is the readable +
writable setting both adapters share: `.value` (current `light`/`dark`/
`system`, `system` default = nothing stored yet), `.set(next)` (writes
through to the document root), `.subscribe(listener)` (tool clicks,
consumer writes, external root edits via `MutationObserver`), `.dispose()`
(stop observing). Vue's `useThemeSetting(setting)` exposes `.value`
reactively (`computed(() => setting.value)` re-renders); vanilla reads come
from the same `.value` and re-render in place through the tool binding.
Custom heads observe the same mirror (`HeadContext.theme`) — no tool
required. The tool itself (`renderTheme` / `ThemeTool.vue`, via
`applyThemeSetting` in `theme.ts`) cycles the mirror on click
(light → dark → system, recomputed fresh each time), which toggles
`.palette-default-theme-light` on `<html>` + `data-theme` + `colorScheme`.
Each `set`/`applyThemeSetting` call samples
`matchMedia('(prefers-color-scheme: light)')` once — the adapters install
no `change` listener, so an OS preference flip while the palette is open
does not re-paint on its own (re-apply the current setting to re-sample).
The demos still call `applyThemeSetting` directly from their own
`applyTheme()` page-chrome helper (they pass `theme: true`, and the helper
keeps demo chrome in sync on load) — the tool does not replace that call.
`system` follows
`matchMedia('(prefers-color-scheme: light)')` for paint but is preserved
as the stored setting, so the cycle keeps working. With the tool omitted
and no direct root write, nothing applies — the resolved theme stays the
stylesheet default (dark), with no automatic `system` write (verified by
unit test).

The demo syncs `.palette-default-theme-light` onto `<html>` (not `<main>`)
so it covers the whole IDE subtree plus demo chrome. The drawer popup shell
is split: layout in `palette.css`, paint via `--pd-drawer-*` tokens in the
head themes.

## Section map (`head-default.css`)

1 buttons · 2 icon/choice/status · 3 shared floating panel ·
4 command box · 5 console overlay · 6 control groups + readout · 7 select ·
8 slider · 9 stepper/stars (+ drawer trigger: chevron beside the icon
horizontally, stacked underneath it in vertical toolbars) · 10 vertical axis ·
11 joined-box collapsing · 12 configurator/add-panel. Tokens live in
`head-dark.css` / `head-light.css` (§0: `--pd-*` paint + `--pd-r-*` radii +
`--pd-ease`/`--pd-slide` timings).

Shared patterns: one button-chrome group (§1, incl. the selected/hover
triple), one floating-panel chrome (§3: popover, select list, drawer track,
vertical overlays), one readout chip (§6: slider/stepper/select), one
reveal transition (opacity + pointer-events + translate), one vertical
overlay pattern (§10: segmented + select). Joined boxes (§11) collapse
shared edges via `-1px`; vertical groups use `column-reverse`, so
`:first-child` rounds the visual bottom and `:last-child` the visual top.

## Accent tone (`config.tone: 'accent'`)

Accent paints an accent border + outer glow (`--pd-accent` /
`--pd-accent-ring`) on every control. Button, toggle, theme and drawer-trigger
tools carry `palette-default-tone-accent` on the same node as
`palette-default-tool` (same-element selector); segmented options and stepper
± buttons match via the descendant selector; select trigger, slider readout +
track, stepper readout, status and stars match via explicit wrapper rules in
§1. Vertical select is excluded from the trigger rule — its chip carries the
accent instead (the trigger itself is a borderless wrapper there). Neutral
(the default) has no rule: it renders the standard chrome.

## Base (dark) theme

`head-default.css` base rules are dark: slate gradients on tools/chips/results
(`#1e293b → #0f172a`), near-black panels/popovers (`#020617`), muted slate text
(`#94a3b8`). Selected items go blue (`#1d4ed8` + `#60a5fa` border). The demo page
chrome matches: `main` on `#020617`, hero/panel cards
on `rgba(15,23,42,…)`.

## Demo wiring

`demoState.theme` (`light`/`dark`/`system`) resolves to what renders via
`prefers-color-scheme` for `system` (subscribed with `matchMedia` +
`change` listener). An `$effect` syncs the result onto `<html>`:

- `classList.toggle('palette-default-theme-light', resolved === 'light')`
- `dataset.theme = resolved` (demo chrome selectors: `:global(html[data-theme='light']) …`)
- `style.colorScheme = resolved` (native form controls)

Syncing onto `<html>` (not `<main>`) covers the whole IDE subtree plus demo
chrome. Demo chrome light variants follow the same
pattern — base rule first, `:global(html[data-theme='light'])` override after
(Biome `noDescendingSpecificity` requires ascending order).
