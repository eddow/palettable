# Theming

Two stylesheets, both imported once by the app (`src/routes/+page.svelte`) —
never injected at runtime, never duplicated per instance:

| File                   | Owner | Contents                                                        |
| ---------------------- | ----- | --------------------------------------------------------------- |
| `palette/styles/palette.css`         | core (headless) | layout (`palette-ide`, borders, tracks, toolbars, spaces), edit-mode hover/active chrome, drawer popup shell (`.svelette-palette-drawer__*`) |
| `head/styles/head-default.css` | head (default theme) | tool chrome, icons, command box, editors, menus, configurator, add-panel, light override |

## Rules

- CSS is always global unless true component scoping is required. Selectors stay
  specific through class hierarchy (`.palette-ide.editing .toolbar:hover::before`),
  never bare names. No `data-palette-id` scoping — one palette is editable at a
  time, so per-instance `<style>` elements are pure overhead.
- The reference `componentStyle.css` injection (`paletteInstanceStyle` +
  `#disposeStyle`) was deleted; `Palette.dispose()` is a no-op for API parity.
- Drawer popup classes use the `svelette-` prefix, not `sursaut-`.

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
