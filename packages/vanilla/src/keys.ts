/**
 * `@palettable/vanilla` — `KeyboardEvent` → keystroke normalization + binding registry.
 *
 * Core owns only the headless lookup (`KeyBindings`, `findKeystrokesFor`);
 * this module owns everything that touches `KeyboardEvent` (adapter-side per
 * the mitosis Phase 2 decision). Headless port of the svelte adapter's
 * `keys.ts` normalization (which stays adapter-owned until Phase 12).
 */

export type Keystroke = string

export type KeyBindings = Record<Keystroke, string>

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const

function normalizeModifier(value: string): string | undefined {
	switch (value.trim().toLowerCase()) {
		case 'ctrl':
		case 'control':
			return 'Ctrl'
		case 'alt':
		case 'option':
			return 'Alt'
		case 'shift':
			return 'Shift'
		case 'meta':
		case 'cmd':
		case 'command':
		case 'super':
			return 'Meta'
		default:
			return undefined
	}
}

function normalizeKey(value: string): string {
	if (value === ' ') return 'Space'
	const trimmed = value.trim()
	if (trimmed.length === 1) return trimmed.toUpperCase()
	switch (trimmed.toLowerCase()) {
		case 'space':
		case 'spacebar':
			return 'Space'
		case 'escape':
			return 'Esc'
		default:
			return trimmed[0]?.toUpperCase() + trimmed.slice(1)
	}
}

/**
 * Canonicalize a keystroke string so bindings compare reliably.
 * Modifiers order as `Ctrl`, `Alt`, `Shift`, `Meta`; aliases (`cmd`,
 * `command`, `escape`, …) are normalized.
 */
export function normalizeKeystroke(input: Keystroke): Keystroke {
	const parts = input
		.split('+')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
	if (parts.length === 0) return ''
	const modifiers = new Set<string>()
	let key = ''
	for (const part of parts) {
		const modifier = normalizeModifier(part)
		if (modifier) {
			modifiers.add(modifier)
			continue
		}
		key = normalizeKey(part)
	}
	const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
	return [...orderedModifiers, key].filter((part) => part.length > 0).join('+')
}

/** Derive the normalized keystroke for a DOM keyboard event. */
export function keystrokeFromEvent(event: KeyboardEvent): Keystroke {
	const modifiers: string[] = []
	if (event.ctrlKey) modifiers.push('Ctrl')
	if (event.altKey) modifiers.push('Alt')
	if (event.shiftKey) modifiers.push('Shift')
	if (event.metaKey) modifiers.push('Meta')
	return [...modifiers, normalizeKey(event.key)].join('+')
}

/** Normalized keyboard binding registry for palette command specs. */
export type VanillaKeys = {
	readonly bindings: KeyBindings
	findByTool(toolId: string): readonly Keystroke[]
	resolve(event: KeyboardEvent): string | undefined
}

/** Build a normalized binding registry (raw `{ keystroke: spec }` map in). */
export function createVanillaKeys(bindings: KeyBindings = {}): VanillaKeys {
	const normalizedBindings: KeyBindings = {}
	for (const [keystroke, spec] of Object.entries(bindings)) {
		normalizedBindings[normalizeKeystroke(keystroke)] = spec
	}
	return {
		get bindings() {
			return normalizedBindings
		},
		findByTool(toolId: string) {
			return Object.entries(normalizedBindings)
				.filter(([, bindingSpec]) => bindingSpec === toolId)
				.map(([keystroke]) => keystroke)
		},
		resolve(event: KeyboardEvent) {
			return normalizedBindings[keystrokeFromEvent(event)]
		},
	}
}

/** An input-like target swallows palette shortcuts (typing wins). */
export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	) {
		return true
	}
	return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}
