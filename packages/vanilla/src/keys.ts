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
		case 'plus':
			return '+'
		default:
			return trimmed[0]?.toUpperCase() + trimmed.slice(1)
	}
}

/**
 * Canonicalize a keystroke string so bindings compare reliably.
 * Modifiers order as `Ctrl`, `Alt`, `Shift`, `Meta`; aliases (`cmd`,
 * `command`, `escape`, …) are normalized.
 *
 * `+` is both the separator and a key: a lone `'+'` (or a trailing `'+'`
 * as in `'Shift++'`) names the Plus key, not a separator. Splitting naively
 * on `'+'` would erase it (`'+'` → `''`), silently unbinding `inc`
 * shortcuts while `dec` (`'-'`) keeps working.
 */
export function normalizeKeystroke(input: Keystroke): Keystroke {
	const trimmedInput = input.trim()
	// Lone plus: the Plus key, not a separator.
	if (trimmedInput === '+') return '+'
	// Trailing plus: the last `+` is the Plus key (`'Shift++'` → Shift + Plus).
	// Everything before it is `modifier+modifier+…`.
	if (trimmedInput.endsWith('+') && trimmedInput.length > 1) {
		const prefix = trimmedInput.slice(0, -1)
		const modifiers = new Set<string>()
		for (const part of prefix.split('+')) {
			const piece = part.trim()
			if (piece.length === 0) continue
			const modifier = normalizeModifier(piece)
			if (modifier) modifiers.add(modifier)
			else {
				// Non-modifier prefix with a trailing `+` key is malformed
				// (`'A+'`); fall through to the generic path.
				return genericNormalizeKeystroke(input)
			}
		}
		// Shift is consumed producing `+` (see `keystrokeFromEvent`), so an
		// explicit `'Shift++'` names the same Plus key as `'+'`.
		modifiers.delete('Shift')
		const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
		return [...orderedModifiers, '+'].join('+')
	}
	return genericNormalizeKeystroke(input)
}

function genericNormalizeKeystroke(input: Keystroke): Keystroke {
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
		// Mirror `keystrokeFromEvent`: Shift is consumed producing a symbol,
		// so `'Shift+='` (Shift+= on US layouts) is the Plus key, and any
		// `Shift+<symbol>` binding names the symbol itself.
		if (key === '=' && modifiers.has('Shift')) {
			key = '+'
		}
		if (key.length === 1 && !(key >= 'A' && key <= 'Z')) {
			modifiers.delete('Shift')
		}
	}
	const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
	return [...orderedModifiers, key].filter((part) => part.length > 0).join('+')
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
	const key = normalizeKey(event.key)
	const isLetter = key.length === 1 && key >= 'A' && key <= 'Z'
	const modifiers: string[] = []
	if (event.ctrlKey) modifiers.push('Ctrl')
	if (event.altKey) modifiers.push('Alt')
	if (event.shiftKey && (isLetter || key.length !== 1)) modifiers.push('Shift')
	if (event.metaKey) modifiers.push('Meta')
	return [...modifiers, key].join('+')
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
