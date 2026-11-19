/**
 * `@palettable/core` — key bindings as runnables (no `KeyboardEvent`).
 *
 * Adapters normalize platform events into `"Ctrl+Shift+S"`-form keystrokes
 * before touching this module. Values are `Runnable` objects (structured,
 * JSON-safe); a key bound to a virtual names its `id` as the runnable point.
 *
 * Normalization is DOM-free string logic owned here so both adapters share
 * one implementation: adapters translate their `KeyboardEvent`s into the
 * headless `KeyEventLike` shape (structurally identical) and re-export
 * `normalizeKeystroke` under their own barrel. Everything touching
 * `KeyboardEvent` / `HTMLElement` (`keystrokeFromEvent`, `isEditableTarget`)
 * stays adapter-owned. Normalization extracted from the original reference UI.
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

/** Headless keyboard-modifier order + string helpers (single shared copy). */
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
 * Plus-key aware: a lone `'+'` / trailing `'+'` names the Plus key.
 */
export function normalizeKeystroke(input: Keystroke): Keystroke {
	const trimmedInput = input.trim()
	if (trimmedInput === '+') return '+'
	if (trimmedInput.endsWith('+') && trimmedInput.length > 1) {
		const prefix = trimmedInput.slice(0, -1)
		const modifiers = new Set<string>()
		for (const part of prefix.split('+')) {
			const piece = part.trim()
			if (piece.length === 0) continue
			const modifier = normalizeModifier(piece)
			if (modifier) modifiers.add(modifier)
			else return genericNormalizeKeystroke(input)
		}
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
		if (key === '=' && modifiers.has('Shift')) key = '+'
		if (key.length === 1 && !(key >= 'A' && key <= 'Z')) modifiers.delete('Shift')
	}
	const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
	return [...orderedModifiers, key].filter((part) => part.length > 0).join('+')
}

/** Headless key-event shape (`KeyboardEvent` satisfies it structurally). */
export type KeyEventLike = {
	readonly key: string
	readonly ctrlKey?: boolean
	readonly altKey?: boolean
	readonly shiftKey?: boolean
	readonly metaKey?: boolean
}

/** Derive the normalized keystroke for a headless key event. */
export function keystrokeFromEventLike(event: KeyEventLike): Keystroke {
	const key = normalizeKey(event.key)
	const isLetter = key.length === 1 && key >= 'A' && key <= 'Z'
	const modifiers: string[] = []
	if (event.ctrlKey) modifiers.push('Ctrl')
	if (event.altKey) modifiers.push('Alt')
	if (event.shiftKey && (isLetter || key.length !== 1)) modifiers.push('Shift')
	if (event.metaKey) modifiers.push('Meta')
	return [...modifiers, key].join('+')
}

/** Normalize every key of a bindings map (single shared implementation). */
export function normalizeKeyBindings(bindings: KeyBindings = {}): KeyBindings {
	const normalizedBindings: KeyBindings = {}
	for (const [keystroke, spec] of Object.entries(bindings)) {
		normalizedBindings[normalizeKeystroke(keystroke)] = spec
	}
	return normalizedBindings
}

/** Headless normalized binding registry for palette runnables. */
export type HeadlessKeys = {
	readonly bindings: KeyBindings
	findByTool(toolId: string): readonly Keystroke[]
	resolveKeystroke(keystroke: Keystroke): Runnable | undefined
}

/** Build a normalized binding registry (raw `{ keystroke: runnable }` map in). */
export function createHeadlessKeys(bindings: KeyBindings = {}): HeadlessKeys {
	const normalizedBindings = normalizeKeyBindings(bindings)
	return {
		get bindings() {
			return normalizedBindings
		},
		findByTool(toolId: string) {
			return findKeystrokesFor(normalizedBindings, toolId)
		},
		resolveKeystroke(keystroke: Keystroke) {
			return normalizedBindings[keystroke]
		},
	}
}
