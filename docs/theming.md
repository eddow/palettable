# Theming

Three stylesheets, all imported once by the app — never injected at runtime,
never duplicated per instance:

| File | Owner | Contents |
| ---- | ----- | -------- |
| `core/styles/palette.css` | core (headless) | layout (`palette-ide`, borders, tracks, toolbars, spaces), edit-mode hover/active chrome, drawer popup shell layout (`.palettable-drawer__*`) |
| `core/styles/head-default.css` | head (default theme) | structural chrome (§§1–12: buttons, panels, command box, editors, vertical, joined-box, configurator) — no raw colors, tokens referenced only |
| `core/styles/head-dark.css` / `core/styles/head-light.css` | head themes | `--pd-*` tokens (§0) + light drawer-popup paint; import the base plus **one** theme (dark is the default when neither class applies) |

## Rules

- CSS is always global unless true component scoping is required. Selectors stay
  specific through class hierarchy (`.palette-ide.editing .toolbar:hover::before`),
  never bare names. No `data-palette-id` scoping — one palette is editable at a
  time, so per-instance `<style>` elements are pure overhead.
- The reference `componentStyle.css` injection (`paletteInstanceStyle` +
  `#disposeStyle`) was deleted; `Palette.dispose()` is a no-op for API parity.
- Drawer popup classes use the `palettable-` prefix, not `sursaut-`.

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

Editors receive the surface axis via `context.surface` (vanilla) /
`surfaceContextFromScope` (svelte) and stamp `palette-default-layout-${direction}`
on their root. Several editors use it to avoid widening a vertical toolbar:

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
  - **`drawer`** (the `drawerSlider` editor id) keeps the range out of the
    flow, running it along the *perpendicular* axis — the opposite of inline.
    The icon and value form the always-visible trigger segment; the range is a
    second segment revealed on hover/focus, sharing one border so the pair
    reads as a button group with only the outer corners rounded.
  - `config.sliderVariant` selects a variant when the editor id is not one of
    the two slider ids; the editor id always wins.

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

All paint lives in `--pd-*` custom properties declared once on `:root`
(dark base) and re-set under `.palette-default-theme-light`. No raw color
appears below §0 — every `background` / `border-color` / `box-shadow` /
`color` rule references a token. Adding a new paint value means adding a
token, not a light-override selector.

| Token family | Dark | Light |
| ------------ | ---- | ----- |
| `--pd-border*` (chrome, panel, faint, field) | slate `71,85,105` | `148,163,184,0.9` |
| `--pd-surface*` (chrome, soft, ghost, status, track) | `15,23,42` | `241,245,249,0.96` / `#ffffff` |
| `--pd-panel*` (popovers, console panel) | `2,6,23,0.98` / `#020617` | `#ffffff`-ish |
| `--pd-tool-bg` | slate gradient | flat `241,245,249,0.96` |
| `--pd-muted` / `--pd-faint` / `--pd-icon` / `--pd-status-fg` | `#94a3b8` / `#64748b` / `#93c5fd` / `#bfdbfe` | `#475569` / `#64748b` / `#475569` / `#1d4ed8` |
| `--pd-accent*` / `--pd-selected-*` / `--pd-option-ring` | blue `#1d4ed8` + `#60a5fa` | unchanged |
| `--pd-star*` / `--pd-drag-border` | `#facc15` / `#f59e0b` / accent dashed | unchanged |
| `--pd-r-*` / `--pd-ease` / `--pd-slide` | `9/10/12/14/18px`, `120/140ms` | unchanged |

The `theme` tool (an enum-shaped nothing-point tool, like `status` but presenting `light`/`dark`/`system` options) applies the resolved theme itself: the vanilla renderer
(`renderTheme` + `updateToolNode` in `head.ts`/`ide.ts`, via
`applyThemeSetting` in `theme.ts`) toggles `.palette-default-theme-light`
on `<html>` on render + every value change, so the demo no longer needs its
own `applyTheme` — it just imports all three stylesheets and lets the tool
sync the class. `system` follows `matchMedia('(prefers-color-scheme: light)')`.

The demo syncs `.palette-default-theme-light` onto `<html>` (not `<main>`)
so it also covers body-portaled drawer popups, which live outside the IDE
subtree. The drawer popup shell is split: layout in `palette.css`, paint in
the head theme (light rule at the end of `head-light.css`).

## Section map (`head-default.css`)

1 buttons · 2 icon/choice/status · 3 shared floating panel ·
4 command box · 5 console overlay · 6 editor groups + readout · 7 select ·
8 slider · 9 stepper/stars (+ drawer trigger) · 10 vertical axis ·
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

## Base (dark) theme

`head-default.css` base rules are dark: slate gradients on tools/chips/results
(`#1e293b → #0f172a`), near-black panels/popovers (`#020617`), muted slate text
(`#94a3b8`). Selected items go blue (`#1d4ed8` + `#60a5fa` border). The demo page
chrome (`+page.svelte` `<style>`) matches: `main` on `#020617`, hero/panel cards
on `rgba(15,23,42,…)`.

## Demo wiring

`demoState.theme` (`light`/`dark`/`system`) resolves to what renders via
`prefers-color-scheme` for `system` (subscribed with `matchMedia` +
`change` listener). An `$effect` syncs the result onto `<html>`:

- `classList.toggle('palette-default-theme-light', resolved === 'light')`
- `dataset.theme = resolved` (demo chrome selectors: `:global(html[data-theme='light']) …`)
- `style.colorScheme = resolved` (native form controls)

Syncing onto `<html>` (not `<main>`) also covers body-portaled drawer popups,
which live outside the IDE subtree. Demo chrome light variants follow the same
pattern — base rule first, `:global(html[data-theme='light'])` override after
(Biome `noDescendingSpecificity` requires ascending order).
