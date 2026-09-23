# Creating a head

Vocabulary (strict — see `docs/core-concepts.md`): **point** / **tool** /
**control** / **configurator**.

A **head** is presentation only: markup + CSS bound to headless core
presenters. The core owns logic + functioning — **including HTML structure**
(borders, tracks, toolbars, parking, the drawer portal, drag/drop, a11y
semantics). A head never reimplements those; it only renders the values and
forwards user gestures to presenter callbacks.

The shipped head is **`packages/vanilla/src/head.ts`** — plain-DOM `render*`
functions, one per control id. It is the reference for a new head (in another
adapter, or a custom one in the same app).

## 1. The contract

- A head renderer receives exactly one argument: a **`HeadContext`** carrying
  the resolved item, its point, the live value, the control id, the scope,
  the surface (axis + region), and the adapter's flags.
- All reads/mutations go through a **presenter** from `@palettable/core`
  (`packages/core/src/presenters.ts`). Never write `point.value = …` or
  `point.run()` from a head — call the presenter callback
  (`view.select(next)`, `view.set(n)`, `view.toggle()`, `view.run()`).
- Do not call `paletteCommandEntries` / `paletteAddItemEntries` directly from a
  head; use the command-box presenter, which wires those builders from the
  scope.
- Configurators receive the same context shape with an augmented scope
  (`controlChoices` injected). Use `configuratorModel` for the generic panel.
- Drawer triggers: reuse the layout layer's drawer rendering — never re-implement
  the portal, the axis inversion, or the collapse signal.

Presenter cheat-sheet:

| Family | Presenter | View-model |
| ------ | --------- | ---------- |
| run | `buttonPresenter(context)` | `{ label, icon, title, tone, can, run }` |
| boolean | `togglePresenter(context)` | `{ icon, title, tone, pressed, can, toggle() }` |
| enum | `selectPresenter(context)` | `{ title, tone, icon, value, isSkeleton, can, options[{value,icon,label,text}], select }` |
| number | `sliderPresenter(context)` | `{ title, tone, icon, direction, region, min, max, step, value, showValue, can, set }` |
| item | `statusPresenter(item, bound)` | `{ label, icon, title, tone, value, can }` (nothing-point readout from context bags; `can: false` = disabled + placeholder) |
| item | `themePresenter(item, bound)` | `{ label, icon, title, tone, value, valueIcon, cycle }` (enum-shaped nothing-point; `valueIcon` is the current option's icon — heads render icon-value only; the adapter applies the resolved theme to `<html>`) |
| any | `configuratorModel(context)` | `{ label, icon, hint, tone, control, controlChoices, setText, setTone, setControl }` |

`can` on a valued presenter follows `valuedCan(bound)`: an explicit functional
`can` wins; otherwise a **context tool** (`uses` non-empty) is disabled while its
value is skeleton (`undefined`) — the context is absent, so there is nothing to
write to (`writeValue` would throw). Root-only tools (`uses` empty/omitted) stay
enabled: the consumer hydrates the root store first. Heads render `can: false` as
`disabled` (and must guard the write path).

Helpers: `headMeta(item)` (config defaults), `headTooltip(item, suffix)`,
`headLayoutFromSurface(scope, surface)`, `headRegionFromScope(scope)`.

## 2. Minimal custom control (boolean → LED)

A control is the toolbar-bound rendering for one point family — here a
boolean-point control rendering an LED instead of a toggle:

```ts
import { togglePresenter } from '@palettable/core'
import type { HeadContext } from './head.js'

/** A boolean control rendered as an LED dot. */
export function renderLed(context: HeadContext): HTMLElement {
	const view = togglePresenter(context)
	const button = document.createElement('button')
	button.type = 'button'
	button.className = `my-led ${view.pressed ? 'is-on' : 'is-off'}`
	button.title = view.title
	button.setAttribute('aria-pressed', String(view.pressed))
	button.disabled = !view.can
	button.append(Object.assign(document.createElement('span'), { className: 'my-led-dot' }))
	button.addEventListener('click', () => view.toggle())
	return button
}
```

Key points: the presenter is called **fresh on every render** (core has no
reactivity — the adapter re-renders or patches in place); `title` carries the
a11y tooltip (`label · hint`); the click only calls `view.toggle()` — the
presenter mutates through the core store. Style with your own classes; never
depend on the head theme's `palette-default-*` class names (head-owned, not part
of the public contract).

If your adapter can patch in place instead of re-rendering, keep the same rule:
the presenter is the only writer.

## 3. Command-box control

The command-box control is a real commands-combo-box: a text input + results
popup that runs commands inline on the toolbar. Core provides the entry builders
and the pure query model (`filterCommandEntries`, `parseCommandInput`,
`suggestCommandKeywords`, `tokenizeQuery`, …); the adapter owns the DOM.

```ts
import { paletteCommandEntries, filterCommandEntries } from '@palettable/core'

export function renderCommandBox(context: HeadContext): HTMLElement {
	const entries = paletteCommandEntries(context.core.points, {
		values: context.core.values,
		keys: context.keys,
		actionCan: (id, action) => context.core.canRunAction(id, action),
	})
	// …build input + popup, then on every keystroke:
	//   const results = filterCommandEntries(entries, query)
	//   and on Enter: context.core.run(results[0].run)
}
```

See `renderCommandBox` in `packages/vanilla/src/head.ts` for the reference
layout (testids, results popup, keyboard handling, the ✎ button that opens the
console in edit mode).

## 4. Configurator (configuration panel)

A configurator is the configuration panel that ships with a control
(`configure` in the registry entry):

```ts
import { configuratorModel } from '@palettable/core'

export function renderConfigurator(context: HeadContext): HTMLElement {
	const view = configuratorModel(context)
	// label input      -> view.setText('label', value)
	// icon/hint inputs -> view.setText('icon' | 'hint', value)
	// control select   -> view.setControl(id)
	// tone select      -> view.setTone(tone)
}
```

`controlChoices` are computed by `controlChoicesFor` (capability-filtered for the
current surface) — render them as-is; `setControl` handles enum-subset config
cleanup (`values` / `keywords` / `choiceDisplay`).

## 5. Registry + wiring

A registry maps **family → control id → renderer**:

```ts
import * as head from './head.js'

export const myHead = {
	boolean: {
		toggle: head.renderToggle,
		led: renderLed,
	},
	// … one entry per family; spread the shipped head per family
}
```

Resolve a control with core's `resolveControl()` fallback chain (explicit item
`control` → family default → first eligible → compact fallback for an ineligible
explicit → `undefined`), then look the id up in your registry. A per-family
spread keeps the shipped head as the fallback; a top-level spread would drop
whole families.

`controlDefaults` picks the control when an item omits one. Capability
descriptors control the configurator's choices and the surface fallback (wrong
axis → first compact fallback).

## 6. Styles

- Import once per app, from core:
  `@palettable/core/styles/palette.css` (layout + edit chrome, always required)
  + the theme sheets (`head-default.css`, `head-dark.css`, `head-light.css`).
  Never inject CSS at runtime; keep selectors global and specific
  (`.palette-ide.editing .toolbar…`), never bare.
- Drawer popup shell classes (`.palettable-drawer__*`) live in core
  `palette.css`; theme them from your theme stylesheet.