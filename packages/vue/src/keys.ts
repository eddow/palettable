/**
 * `@palettable/vue` — `KeyboardEvent` → keystroke normalization + binding registry.
 *
 * Same contract as the vanilla adapter's `keys.ts`: core owns the
 * headless implementation (`normalizeKeystroke`,
 * `keystrokeFromEventLike`, `createHeadlessKeys`); this module owns
 * everything that touches `KeyboardEvent` (adapter-side by design).
 * Normalization extracted from the original reference UI.
 */

import {
	createHeadlessKeys,
	type HeadlessKeys,
	type KeyBindings,
	type KeyEventLike,
	type Keystroke,
	keystrokeFromEventLike,
	normalizeKeyBindings,
	normalizeKeystroke,
	type Runnable,
} from '@palettable/core'

export type { HeadlessKeys, KeyBindings, KeyEventLike, Keystroke, Runnable }
export { keystrokeFromEventLike, normalizeKeyBindings, normalizeKeystroke }

function toHeadlessEvent(event: KeyboardEvent): KeyEventLike {
	return {
		key: event.key,
		ctrlKey: event.ctrlKey,
		altKey: event.altKey,
		shiftKey: event.shiftKey,
		metaKey: event.metaKey,
	}
}

/** Derive the normalized keystroke for a DOM keyboard event.
 *
 * Shift is consumed producing a symbol: pressing `Shift+=` yields `key: '+'`
 * with `shiftKey: true`, and the numpad `+` yields `key: '+'` with no
 * modifiers — both mean the Plus key. So when the key is a single
 * non-letter character, a held Shift is dropped (`'+'` matches, not
 * `'Shift++'`). Letter keys keep Shift (`'Shift+A'` ≠ `'A'`) so
 * Shift-letter bindings stay distinct.
 */
export function keystrokeFromEvent(event: KeyboardEvent): Keystroke {
	return keystrokeFromEventLike(toHeadlessEvent(event))
}

/** Normalized keyboard binding registry for palette runnables. */
export type VueKeys = HeadlessKeys & {
	resolve(event: KeyboardEvent): Runnable | undefined
}

/** Build a normalized binding registry (raw `{ keystroke: runnable }` map in). */
export function createVueKeys(bindings: KeyBindings = {}): VueKeys {
	const headless = createHeadlessKeys(normalizeKeyBindings(bindings))
	return {
		get bindings() {
			return headless.bindings
		},
		findByTool(toolId: string) {
			return headless.findByTool(toolId)
		},
		resolveKeystroke(keystroke: Keystroke) {
			return headless.resolveKeystroke(keystroke)
		},
		resolve(event: KeyboardEvent) {
			return headless.resolveKeystroke(keystrokeFromEvent(event))
		},
	}
}

/** An input-like target swallows palette shortcuts (typing wins).
 * The select is a custom button + listbox (no native `<select>`), so its
 * buttons must NOT swallow shortcuts — only real text inputs do. */
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
		return true
	}
	return Boolean(target.closest('input, textarea, [contenteditable="true"]'))
}
