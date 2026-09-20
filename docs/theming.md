# Theming

Two stylesheets, both imported once by the app (`src/routes/+page.svelte`) —
never injected at runtime, never duplicated per instance:

| File                   | Owner | Contents                                                        |
| ---------------------- | ----- | --------------------------------------------------------------- |
| `palette/styles/palette.css`         | core (headless) | layout (`palette-ide`, borders, tracks, toolbars, spaces), edit-mode hover/active chrome, drawer popup shell (`.palettable-drawer__*`) |
| `head/styles/head-default.css` | head (default theme) | tool chrome, icons, command box, editors, menus, configurator, add-panel, light override |

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

## Base (dark) theme

`head-default.css` base rules are dark: slate gradients on tools/chips/results
(`#1e293b → #0f172a`), near-black panels/popovers (`#020617`), muted slate text
(`#94a3b8`). Selected items go blue (`#1d4ed8` + `#60a5fa` border). The demo page
chrome (`+page.svelte` `<style>`) matches: `main` on `#020617`, hero/panel cards
on `rgba(15,23,42,…)`.

## Light override

`.palette-default-theme-light` overrides every dark fill with
`rgba(241,245,249,0.96)` / white panels (`rgba(255,255,255,0.98)`), ink text
(`#0f172a`), muted text (`#475569`). When adding a dark `background` /
`border-color` rule to the base theme, add its light counterpart in the same
block — the light list must stay in sync (tools, triggers, menus, selects,
radios, sliders, steppers, stars, segmented, split, command shell/chips/results/
panel/popover/parking, stepper value, config inputs, add variants, command
close, drawer popup).

## Demo wiring (`src/routes/+page.svelte`)

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
