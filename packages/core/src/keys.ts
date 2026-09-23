/**
 * `@palettable/core` — key bindings as runnables (no `KeyboardEvent`).
 *
 * Adapters normalize platform events into `"Ctrl+Shift+S"`-form keystrokes
 * before touching this module. Values are `Runnable` objects (structured,
 * JSON-safe); a key bound to a virtual names its `id` as the runnable point.
 */
import type { Keystroke } from './identifiers.js'
import type { Runnable } from './runnable.js'
import type { VirtualPoint } from './virtual.js'

export type KeyBindings = Record<Keystroke, Runnable>

/** Find keystrokes bound to a point id (runnable point match). */
export function findKeystrokesFor(bindings: KeyBindings, pointId: string): readonly Keystroke[] {
	return Object.entries(bindings)
		.filter(([, runnable]) => runnable.point === pointId)
		.map(([keystroke]) => keystroke)
}

/**
 * Find keystrokes bound to a runnable or a virtual definition
 * (matched by `point` / `id`).
 */
export function findKeystrokesForTarget(
	bindings: KeyBindings,
	target: Runnable | VirtualPoint
): readonly Keystroke[] {
	if ('point' in target && typeof (target as Runnable).point === 'string')
		return findKeystrokesFor(bindings, (target as Runnable).point)
	return findKeystrokesFor(bindings, (target as VirtualPoint).id)
}
