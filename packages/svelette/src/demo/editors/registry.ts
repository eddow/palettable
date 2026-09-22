import { BaseConfigurator, defineEditorSpec as spec } from '$lib/head/registry'
import DemoSlider from './DemoSlider.svelte'
import StarsEditor from './StarsEditor.svelte'

/**
 * The demo layer proves both extension mechanisms (see
 * `docs/using-the-default-head.md`):
 *
 * - **Override (same key)** — the head `SliderEditor` with `showValue` replaces
 *   the head's `number.slider` because the demo spread comes last.
 * - **Extend (new key)** — `StarsEditor` is a `number` variant the head lacks:
 *   a play/rating row of "▶"/"▷" triangles.
 *
 * The other families are empty objects so the per-family spread keeps its shape
 * (a top-level spread would be equivalent here, but the empty entries make
 * "demo only touches `number`" explicit).
 */
export const demoEditors = {
	boolean: {},
	enum: {},
	number: {
		slider: spec(DemoSlider as never, BaseConfigurator, 'horizontal'),
		stars: spec(StarsEditor, BaseConfigurator, 'free'),
	},
	item: {},
	run: {},
}
