/**
 * `@palettable/core` — key bindings as normalized strings (no `KeyboardEvent`).
 *
 * Adapters normalize platform events into `"Ctrl+Shift+S"`-form keystrokes
 * before touching this module. Values are string specs (references by name);
 * inline virtual definitions live on toolbar items (`ToolToolbarItem.tool`),
 * never in this map — a key bound to an inline stash uses the stash's `id`
 * as its spec string, resolved via `canonicalSpecId`.
 */
import type { Keystroke } from './identifiers.js'
import { canonicalPointId, canonicalSpecId, type PointTarget } from './specs.js'

export type KeyBindings = Record<Keystroke, string>

/** Find keystrokes bound to a point id (spec-prefix match, so setters/actions match too). */
export function findKeystrokesFor(bindings: KeyBindings, pointId: string): readonly Keystroke[] {
	return Object.entries(bindings)
		.filter(([, spec]) => canonicalPointId(spec) === pointId)
		.map(([keystroke]) => keystroke)
}

/**
 * Find keystrokes bound to a point target: string specs match by canonical
 * id, inline virtual definitions match by their own `id`. Lets a key-shortcut
 * stay associated with an action point (even a derived one) regardless of
 * which spec form names it.
 */
export function findKeystrokesForTarget(
	bindings: KeyBindings,
	target: PointTarget<string, unknown>
): readonly Keystroke[] {
	return findKeystrokesFor(bindings, canonicalSpecId(target))
}
