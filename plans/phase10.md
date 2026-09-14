# Phase 10 — vanilla demo parity (handoff, landed 2026-09-14)

First parity gate. Status: **landed, green**. `packages/svelte/src` untouched.

## Goal

Vanilla demo = same Stellar Outpost demo as svelte. Both demos run the same
`tests/e2e/` suite. Unlocks Phase 11, not Phase 12.

Reference: `packages/svelte/src/routes/+page.svelte` (430) +
`packages/svelte/src/demo/palette.svelte.ts` (563).

## Delivered

| File | Lines | Contents |
| ---- | ----- | -------- |
| `packages/vanilla/src/keys.ts` | 126 | Adapter-side `KeyboardEvent` ownership (mitosis Phase 2 split): `normalizeKeystroke` (Ctrl/Alt/Shift/Meta order + aliases), `keystrokeFromEvent`, `createVanillaKeys` (normalized map + `findByTool` + `resolve`), `isEditableTarget`. |
| `packages/vanilla/src/keys.test.ts` | 46 | 3 tests: normalize / resolve / editable-target. |
| `packages/vanilla/src/head.ts` | 503 | Plain-DOM head editors: `renderButton/Toggle/Select/Segmented/Slider(showValue badge)/Stepper/Stars(radiogroup)/Status/CommandBox/Drawer` + `renderHeadItem` dispatch + `surfaceForRegion`. |
| `packages/vanilla/src/ide.ts` | 1024 | `createIDE(container, options)` — adds `palette-ide` + tabindex + `data-palette-id`, wraps existing children (work-zone) in `palette-ide-middle > palette-ide-center`, renders 4 borders + parking + console overlay. Subscribes values/layout/console. |
| `packages/vanilla/demo/palette.ts` | 479 | Plain-data port of svelte demo: same 15 points (incl. `console` toggle point), same `demoKeys`, same 3 configs (`rw-combobox` / `rw-command-first` / `ro-combobox`) + layouts, `demoState` + `resetColony`/`isColonyDirty`. |
| `packages/vanilla/demo/main.ts` | 385 | Parity page: demo-bar (heading, 3 mode buttons, save/load, last-action), `PaletteCore` + `ConsoleStore` + `bindConsoleToggle`, `createIDE` + work-zone (hero, pills, status panel, hint), values→`demoState` sync + theme + mm:ss clock, localStorage persistence (`palettable-demo-layout-v1` + `validateSerializedLayout`). |
| `packages/vanilla/src/index.ts` | 12 | Barrel now exports `adapter` + `head` + `ide` + `keys`. |
| `packages/vanilla/src/adapter.ts` | 51 | Unchanged minimal `<ul>` renderer. Predates the IDE; kept for the barrel smoke test only. Not the adapter surface. |

Interface note landed: `createIDE(container, options)` takes a container element,
adds IDE classes/children, wraps prior children in the workspace div.

## DOM contract (`ide.ts` + `head.ts`)

- Borders: direction/inverse, stack/track spaces (`actualTrackSpaceAt` + `trackGapMinGrow` floor), slots, `toolbar-item-guard` (`pointerdown`→inspect), `inert` content while editing.
- Drawer: trigger `aria-label = label || hint` (label in `<span>`, chevron `aria-hidden`), child axis perpendicular, popup `is-${childAxis}` + `data-placement=center` + role dialog, body-portaled overlay, Escape closes + refocuses trigger. Overlay tracked separately so Escape removes popup + overlay.
- CommandBox: `command-box-combobox/input/results` testids, ✎ open-editor → console edit mode, Enter runs first filtered entry.
- Console: `console-overlay/input/results/mode-toggle/details-panel/add-panel` testids, `is-dimmed` work-zone, edit-only vs command-first vs read-only, click-to-select add flow, presentation-only configurator + delete.
- Keydown: `isEditableTarget` guard, Escape closes, editing suppresses bindings, else boolean-toggle or `core.run(spec)`.

## E2E

`playwright.config.ts`: `svelte` (`:4173`, build+preview) + `vanilla` (`:4174`,
vite dev) run the shared suite; `vanilla-smoke` runs the vanilla-only spec.
Shared suite = 16 (console 9 + palette 5 + drag-invariants 1 + smoke 1).
Total: **33 passed (16 + 16 + 1)**.

Stale specs retired in `tests/e2e/console.spec.ts`: the 2 catalogue-drag specs
(`draggable entries`, `drop lands in gap`) assumed HTML5 drag that no longer
exists — movement stripped for restart (`plans/movement.md`), zero `draggable=`
in `src`, svelte unit `console.test.ts` asserts click-to-select. Replaced with
click-to-select assertions (`addable tools (not draggable)`, `click selects an
entry`). `tests/e2e/vanilla.spec.ts` is the vanilla-only first-paint smoke
(heading + IDE + combobox + work-zone).

## Verification (all green 2026-09-14)

- `pnpm --filter @palettable/core check/build/test` — 212/15.
- `pnpm --filter @palettable/vanilla check/test` — 4/2.
- `pnpm --filter @palettable/vanilla build` — esm/cjs/umd ok.
- `npx biome check packages/core packages/vanilla tests/e2e playwright.config.ts` — clean.
- `pnpm test:e2e` — 33 passed.

## Decisions / deviations

- SSR: demos client-rendered; Phase 7 import-graph rule held (demo code in adapters only).
- Context: parity demos context-free (root bag only); coverage from Phase 8 core tests. Command-box `uses` stays shaped-only.
- Vanilla spike simplified: full re-render on values/layout/console; no dirty-set/rAF batching (fast enough at demo scale).
- `adapter.ts` left in place; real surface is `keys`/`head`/`ide`.

## Leftovers (not Phase 10 debt, for later phases)

- `adapter.ts` `<ul>` renderer vs `ide.ts`: deprecate or delegate during Phase 11/12 cleanup.
- Phase 8 steps 7–8 closed as shaped/simple; full context pass (bags in render, context-bound controls) is future work — note in mitosis.md: vanilla demo is expected to overtake svelte via contexts; vue targets vanilla parity; context e2e on svelte fails/skips until Phase 12.
- Movement engine rebuild (`plans/movement.md`) re-adds drag sessions; e2e drag specs return then.

## Next

Phase 11 (vue adapter + demo parity, gated on this phase): scaffold
`packages/vue/`, reproduce the same demo + DOM contract, own playwright project/port,
same suite green. Then Phase 12 (thin svelte) only.

## References

- Permanent record: `docs/architecture.md` §19 + §21 "Phase 10 status".
- Retired checklist: `plans/mitosis.md` "Phase 10" (status now Phases 2–10 landed).
- Re-verify: `pnpm test:e2e` (both demos), `pnpm --filter @palettable/core test`,
  `pnpm --filter @palettable/vanilla test`, `npx biome check packages/core packages/vanilla tests/e2e playwright.config.ts`.
