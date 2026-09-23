# Drawer edit handoff (2026-09-23)

## Scope
Drawer editing in the vanilla adapter: edit-mode hover handles on drawer-child
bars (perpendicular axis), drawer popup stacking/placement, spec-grammar
canonicalization. Core model: a drawer is a `DrawerToolbarItem`
(`{control:'drawer', toolbar: Track}`) living inside a parent toolbar; the
child `Track` renders perpendicular (`drawerChildAxis`).

## What is in the working tree (uncommitted, do NOT commit/stash per AGENTS.md)
`git status` is dirty (`master ⇡1 *1 +52 !20`): mix of staged pre-existing
changes + unstaged drawer-edit work. Drawer-relevant diffs:

- `packages/core/styles/palette.css`
  - `.toolbar` base: `border: 0 solid transparent`; **`border` removed from
    `transition`** (kept `opacity, box-shadow, background-color`). This is the
    handle-paint fix — see §Root cause.
  - Border handle rules rescoped to DIRECT children
    (`> .toolbar-track > .toolbar-track-slot > .toolbar`) so the parent axis
    never leaks into inline drawer popups.
  - Drawer-child handle rules scoped per popup level
    (`.palettable-drawer__popup.is-horizontal/-vertical > track > slot > bar`),
    plus `@container palette style(--layout)` variants.
  - Popup base `z-index: 211` + flipped-side chrome
    (`[style*='right: 100%']` etc. mirror radii/padding to the flipped joint).
  - Center-seeking comment updates.
- `packages/vanilla/src/head.ts` (`renderDrawer`)
  - `openPopup`: depth stacking (`zIndex = 210 + depth`, depth = ancestor
    drawer count + 1; cleared on close) + center-seeking side flip toward IDE
    center (horizontal popups `left/right`, vertical `top/bottom`).
  - Measures the WRAPPER rect, not the trigger (nested trigger at popup far
    edge would otherwise always flip outward). Skipped on zero rects.
  - `HeadContext` gains test-only `ideRect`/`triggerRect` overrides.
  - `applyPreviewSpec` now delegates to `parsePointSpec` (`setter/toggle/step`
    kinds); doc comments `id+=x` / `id-=x`.
- `packages/vanilla/src/ide.ts`
  - `IdeOptions.headContext` threaded into every `HeadContext` as
    `ideRect`/`triggerRect` (border bars, drawer tracks, parking).
  - `pointFor` uses `core.getDefinition(point)` (canonicalizes) instead of
    manual `[=!+-]` cut. Key-press comment `id+=x` / `id-=x`.
- `packages/core/src/layout.ts`
  - `canonicalItemPoint` delegates to `canonicalPointId` (single source for
    `=` / `!` / `+=x` / `-=x`; bare `+`/`-` in ids untouched). Doc fix
    `id+x` → `id+=x`.
- `packages/core/src/specs.ts` (+ tests), `command-box.ts`, `core.ts`,
  `context/keys/phase2` tests: spec-grammar `+=` / `-=` shape (bare `+`/`-`
  in ids like `fontSize+` no longer cut). Vanilla `value-sync.test.ts`
  key/spec cases updated to `speed+=1` / `speed-=1`.
- `packages/vanilla/src/value-sync.test.ts`: new `nested drawer opens toward
  the IDE center and stacks above its parent` (geometry override via
  `headContext`; asserts outer z=211, nested z>outer, nested `right: 100%`).

## Root cause found this session (handle paint)
Symptom: drawer-child bar hover matched the handle rule
(`matches()=true`, `hover=true`, popup `is-horizontal`, `--layout:horizontal`,
bar 250x40) but computed `border-*-width: 0px` — even inline
`border-left: 16px double blue !important` computed `0px/double`, while a
detached probe div painted `16px` fine. `background-color`/`width` inline
styles were ALSO ignored.
Cause: `.toolbar { transition: ... border 120ms ... }` — every hover/re-render
retriggered the border-width CSSTransition, wedging 7 `CSSTransition`s at
`currentTime: 0, progress: 0` (`border-left-width`, `border-right-width`,
border colors, `background-color`). Computed style stayed at the transition
start (0px) forever. `cancel()`-ing the animations snapped to `16px/red`
instantly, confirming it.
Fix: `border` out of `transition` (handles apply instantly). Verified live
after reload: child-bar hover → `blw: 16px/double, btw: 0px, brw: 16px`
(left/right handles on a horizontal child bar in the left-border drawer —
correct perpendicular axis). Screenshot confirms blue double side handles.

## Test inventory (drawer functionality)
- Core `layout.test.ts` — `drawer locations + child-track prune`: drawer
  location resolve, non-last prune, last-bar-persists-empty drop target,
  move into drawer, `dragStart` drawer origin, `commitDraggedToDrawer`.
- Core `presenters.test.ts`: `drawerChildAxis` inversion, drawerSlider
  perpendicular axis.
- Core `drag.test.ts` / `render.test.ts`: grab resolution, recursive resolve.
- Vanilla `value-sync.test.ts` — `drawer drag editing`: popup DZs, border→drawer
  merge, rest hover-open, flanking gaps mid-drag, drag-hover identity gate,
  last-tool-out drop target, toggle semantics, nested center/stack (new).
- E2E: `drawer-drag-open.spec.ts` (drag-over-trigger opens), `palette.spec.ts`
  (axis inversion, Escape/keyboard, closeOnClick chain), `vanilla.spec.ts`
  (drawer slider, select in popup).

## TODO (matches todo list)
- [x] Fix rest hover-open race
- [-] Verify drawer DZ highlight in browser (handles verified; DZ highlight
  re-verify pending after CSS change)
- [ ] Add Playwright rest-open + DZ specs
- [ ] Update docs + full suite + biome
  - `docs/layout-and-drag.md` still documents the old persistent-empty rule —
    update to child-track prune + last-bar drop target.
  - Run: `pnpm --filter @palettable/core exec vitest run`,
    `pnpm --filter @palettable/vanilla exec vitest run`,
    `pnpm exec biome check` on touched files. Full e2e after.

## Resume
- Demo: `packages/vanilla` vite on `:4174` (`pnpm dev:vanilla`; watch for stale
  vite — `reuseExistingServer` serves stale code; kill before measuring e2e).
- Live probe pattern: `run_playwright_code` on the shared page —
  `getComputedStyle(bar).borderLeftWidth`, `bar.matches(':hover')`,
  `bar.getAnimations().map(a => a.transitionProperty + '/' + a.currentTime)`.
- Stuck-transition check: `getAnimations()` non-empty at `ct=0` + inline
  styles ignored = transition wedge, not specificity.
