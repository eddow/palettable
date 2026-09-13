/**
 * Standard minimal head for the svelette palette.
 *
 * A small standard set of tools per point family (button/toggle/select+
 * segmented/slider+stepper/commandBox) plus the generic editor (`BaseConfigurator`,
 * the configuration panel that comes with every tool). The
 * core `DrawerEditor` trigger is reused from `palette/components/` — never
 * duplicated here. `status` / `commandBox` / `drawer` are **pointless tools**:
 * `item`-family variants binding no point (no bound value to modify).
 *
 * Heads are presentation-only: every tool component binds a headless presenter
 * from the palette barrel (all point/config reads and mutations
 * live there). No `tool.value = …`, no `tool.run()`, no command-box entry
 * builders inside `.svelte` files.
 */
import DrawerEditor from '$lib/palette/components/DrawerEditor.svelte'
import {
	type PaletteEditorRegistry,
	type PaletteSchema,
	defineEditorSpec as spec,
} from '$lib/palette/core.svelte'
import BaseConfigurator from './editors/BaseConfigurator.svelte'
import ButtonEditor from './editors/ButtonEditor.svelte'
import CommandBoxEditor from './editors/CommandBoxEditor.svelte'
import SegmentedEditor from './editors/SegmentedEditor.svelte'
import SelectEditor from './editors/SelectEditor.svelte'
import SliderEditor from './editors/SliderEditor.svelte'
import StatusEditor from './editors/StatusEditor.svelte'
import StepperEditor from './editors/StepperEditor.svelte'
import ToggleEditor from './editors/ToggleEditor.svelte'

export { default as SliderEditor } from './editors/SliderEditor.svelte'

/**
 * Minimal family→tool-variant map: a small standard set of tools per point family.
 *
 * - boolean point: `toggle` tool
 * - enum point: `select` tool (dropdown), `segmented` tool (joined buttons; the selected one
 *   reads as "pushed in")
 * - number point: `slider` tool, `stepper` tool (± buttons)
 * - pointless (no bound point): `commandBox` tool (+ core `drawer` trigger),
 *   `status` tool (read-only display from item `config`)
 * - run point: `button` tool
 *
 * Extra variants live in a consumer layer (e.g. the demo's
 * `src/demo/editors/registry.ts`),
 * which proves custom heads can extend or replace this map.
 */
export const headEditors: PaletteEditorRegistry<PaletteSchema> = {
	boolean: {
		toggle: spec(ToggleEditor, BaseConfigurator, 'square'),
	},
	enum: {
		select: spec(SelectEditor, BaseConfigurator, 'horizontal'),
		segmented: spec(SegmentedEditor, BaseConfigurator, 'free'),
	},
	number: {
		slider: spec(SliderEditor, BaseConfigurator, 'horizontal'),
		stepper: spec(StepperEditor, BaseConfigurator, 'free'),
	},
	item: {
		commandBox: spec(CommandBoxEditor, BaseConfigurator, 'horizontal'),
		drawer: spec(DrawerEditor, BaseConfigurator, 'horizontal'),
		status: spec(StatusEditor, BaseConfigurator, 'horizontal'),
	},
	run: {
		button: spec(ButtonEditor, BaseConfigurator, 'horizontal'),
	},
}

export {
	type ButtonPresenter,
	buttonPresenter,
	type CommandBoxPresenter,
	type ConfiguratorPresenter,
	commandBoxPresenter,
	configuratorPresenter,
	defineEditorSpec,
	type HeadChoiceDisplay,
	type HeadEnumSubsetConfig,
	type HeadItemConfigBase,
	headLayoutFromSurface,
	headMeta,
	headRegionFromScope,
	headTooltip,
	type SelectOption,
	type SelectPresenter,
	type SliderPresenter,
	type StatusPresenter,
	selectPresenter,
	sliderPresenter,
	statusPresenter,
	type TogglePresenter,
	togglePresenter,
} from '$lib/palette/core.svelte'
export { default as Console } from './Console.svelte'
export { default as BaseConfigurator } from './editors/BaseConfigurator.svelte'
export { default as Icon } from './Icon.svelte'
export { type IconFactory, icons } from './icons.svelte'
