/**
 * `@palettable/core` — key bindings as normalized strings (no `KeyboardEvent`).
 *
 * Adapters normalize platform events into `"Ctrl+Shift+S"`-form keystrokes
 * before touching this module.
 */
import type { Keystroke } from './identifiers.js'
import { canonicalPointId } from './specs.js'

export type KeyBindings = Record<Keystroke, string>

/** Find keystrokes bound to a point id (spec-prefix match, so setters/actions match too). */
export function findKeystrokesFor(bindings: KeyBindings, pointId: string): readonly Keystroke[] {
	return Object.entries(bindings)
		.filter(([, spec]) => canonicalPointId(spec) === pointId)
		.map(([keystroke]) => keystroke)
}
