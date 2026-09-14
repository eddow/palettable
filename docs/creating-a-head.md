# Creating a head — tutorial

Vocabulary: **points** are the `PaletteConfig.tools` data definitions (no
layout); **tools** are the toolbar-bound controls you render here (one head
component per tool variant, bound to a headless presenter — usually modifying a
point); **editors** are the configuration panels (`PaletteEditorSpec.configure`,
e.g. `BaseConfigurator`). `status` / `commandBox` / `drawer` are **pointless
tools** (no bound value to modify). See `docs/core-concepts.md` for the full glossary.

A **head** is presentation only: markup + CSS bound to headless core presenters.
The palette core owns logic + functioning, **including HTML structure** (layout
components, drawer portal, drag/drop, a11y). Your head never reimplements those —
it only renders tool values and forwards user gestures to presenter callbacks.

## 1. The contract

- A head component receives exactly one prop: `context: PaletteEditorContext`
  (`{ item, tool, scope, flags, surface }`). The layout (`Toolbar` → `PaletteItem`)
  builds it via `palette.resolveEditorContext(item, tool, scope)` and renders
  `<Editor context={...} />`.
- All reads/mutations go through a **presenter** from
  `$lib/palette/presenters.svelte` (re-exported by `core.svelte.ts` / `edition.svelte.ts`).
  Never write `tool.value = …` or `tool.run()` in `.svelte` — call the presenter
  callback (`view.select(next)`, `view.set(n)`, `view.toggle()`, `view.run()`).
- Do not call `paletteCommandEntries` / `paletteAddItemEntries` directly in `.svelte`;
  use `commandBoxPresenter` (which wires `paletteCommandEntries` from `context.scope.palette`).
- Configurators receive the same `context` shape with an augmented scope
  (`editorChoices` injected). Use `configuratorPresenter` for the generic panel;
  read enum-subset fields via your own presenter or `headMeta`.
- Drawer trigger: reuse core `palette/components/DrawerEditor.svelte` — never
  duplicate the portal (`mount`/`unmount`, axis inversion, collapse signal).

Presenter cheat-sheet:

| Family | Presenter | View-model |
| ------ | --------- | ---------- |
| run | `buttonPresenter(context)` | `{ label, icon, title, tone, can, run }` |
| boolean | `togglePresenter(context)` | `{ icon, title, tone, pressed, toggle() }` |
| enum | `selectPresenter(context)` | `{ title, tone, icon, value, options[{value,text}], select }` |
| number | `sliderPresenter(context)` | `{ title, tone, icon, direction, region, min, max, step, value, set }` |
| item | `commandBoxPresenter({ context })` | `{ title, icon, label, hint, model }` — `model` is a `paletteCommandBoxModel` (combobox) |
| item | `statusPresenter(context)` | `{ label, icon, title, tone, value }` (pointless readout from `config`, no interaction) |
| any | `configuratorPresenter(context)` | `{ label, icon, hint, tone, editor, editorChoices, setText, setTone, setEditor }` |

Helpers: `headMeta(item)` (config defaults), `headTooltip(item, suffix)`,
`headLayoutFromSurface(scope, surface)`, `headRegionFromScope(scope)`.

## 2. Minimal custom tool (boolean `led`)

A tool is the toolbar-bound component for one point-family variant —
here a boolean-point tool rendering an LED instead of a toggle:

```svelte
<script lang="ts">
	import { togglePresenter } from '$lib/palette/core.svelte'
	import type {
		PaletteEditorContext,
		PaletteSchema,
		PaletteToolbarItem,
		PaletteToolBool
	} from '$lib/palette/types'

	type Props = {
		context: PaletteEditorContext<PaletteToolBool, PaletteToolbarItem, PaletteSchema>
	}

	let { context }: Props = $props()
	const view = $derived(togglePresenter(context))
</script>

<button
	type="button"
	class={['my-led', view.pressed ? 'is-on' : 'is-off']}
	title={view.title}
	onclick={() => view.toggle()}
>
	<span class="my-led-dot"></span>
</button>
```

Key points: `$derived(togglePresenter(context))` keeps `pressed`/`icon` reactive;
`title` carries the a11y tooltip (`label · hint`); the click only calls
`view.toggle()` — the presenter mutates the tool. Style with your own classes;
never depend on the head theme's `palette-default-*` class names (head-owned,
not part of the public contract).

## 3. Command-box combobox editor

`commandBoxPresenter` returns a real commands-combo-box: a text input + results
popup that runs commands inline on the toolbar. It builds its own
`paletteCommandBoxModel` from `context.scope.palette` — call it **once at
component init** (not inside `$derived`; the model holds `$state`):

```svelte
<script lang="ts">
	import { commandBoxPresenter } from '$lib/palette/core.svelte'

	let { context }: Props = $props()
	const view = commandBoxPresenter({ context })
	const model = view.model
</script>

<input
	value={model.input.value}
	placeholder={model.input.placeholder}
	oninput={(e) => setPaletteCommandBoxInput(model, e)}
/>
{#each model.results as entry (entry.id)}
	<button onclick={() => model.execute(entry.id)}>{entry.label}</button>
{/each}
```

Copy `head/editors/CommandBoxEditor.svelte` as the reference layout (chips,
suggestions, keyboard handling via `handlePaletteCommandBoxInputKeydown` /
`handlePaletteCommandChipKeydown`).

## 4. Editor (configuration panel)

An editor is the configuration panel that comes with a tool (`spec.configure`):

```svelte
<script lang="ts">
	import { configuratorPresenter } from '$lib/palette/core.svelte'
	let { context }: Props = $props()
	const view = $derived(configuratorPresenter(context))
</script>

<input value={view.label} oninput={(e) => view.setText('label', e.currentTarget.value)} />
<select value={view.editor} onchange={(e) => view.setEditor(e.currentTarget.value)}>
	{#each view.editorChoices as option (option.id)}
		<option value={option.id}>{option.label}</option>
	{/each}
</select>
```

`editorChoices` are computed by `describeItemConfiguration` (capability-filtered
for the current surface) — render them as-is; `setEditor` handles enum-subset
config cleanup (`values`/`keywords`/`choiceDisplay`).

## 5. Registry + wiring

```ts
// my-head/registry.ts
import DrawerEditor from '$lib/palette/components/DrawerEditor.svelte'
import BaseConfigurator from './BaseConfigurator.svelte'
import LedEditor from './LedEditor.svelte'
// … default head editors for the rest

export const myHeadEditors = {
	boolean: {
		toggle: spec(ToggleEditor, BaseConfigurator, 'square'),
		led: spec(LedEditor, BaseConfigurator, 'square')
	},
	// … spread headEditors per family, override what you replace
}
```

```ts
new Palette({
	tools: { /* … */ },
	keys: { /* … */ },
	editable: true,
	editors: {
		boolean: { ...headEditors.boolean, ...myHeadEditors.boolean },
		// … per family, so the default head stays the fallback
	} as never,
	editorDefaults: { boolean: 'toggle' }
})
```

Per-family spread keeps the default fallback; top-level spread would drop whole
families. `editorDefaults` picks the variant when an item omits `editor`.
Capability descriptors (`paletteDefaultEditorCapabilities`, overridable via
`PaletteConfig.editorCapabilities`) control inspector choices and surface
fallback (wrong axis → first compact fallback).

## 6. Styles

- Import once per app: `$lib/palette/styles/palette.css` (core layout + edit
  chrome, always required) + your head theme (default:
  `$lib/head/styles/head-default.css`). Never inject CSS at runtime; keep
  selectors global and specific (`.palette-ide.editing .toolbar…`), never bare.
- Drawer popup shell classes (`.palettable-drawer__*`) live in core
  `palette.css`; theme them from your head stylesheet.
- Light theme: if you add a dark base rule, add its
  `.palette-default-theme-light` (or your own theme class) counterpart in the
  same block — see `docs/theming.md`.

## 7. Checklist

- [ ] One `context` prop, typed per family (`PaletteToolBool`, `PaletteToolEnum<string>`, …).
- [ ] All tool/config access through a core presenter; no direct mutation in `.svelte`.
- [ ] `commandBoxPresenter` for the `commandBox` item (a real combobox, created once at init).
- [ ] Drawer reused from core, not reimplemented.
- [ ] Registered per family with `BaseConfigurator` (or custom) + footprint flags.
- [ ] `check` / `lint` / `test` / `build` green; demo renders the new variant in one
      region while the rest stays on the default head.
