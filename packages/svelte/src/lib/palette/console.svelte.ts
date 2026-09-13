/**
 * Headless console state + model for the palette.
 *
 * The console is a first-class core concept: a headless open/close/toggle
 * signal with a `run` | `edit` mode, plus the add-to-toolbar UI state used by
 * the console's edit mode. A "head" (see `src/lib/head/Console.svelte`) owns
 * markup, CSS, and modal placement — core knows nothing about geometry,
 * masking, or positioning.
 *
 * The `consoleTool` helper returns a run tool whose `run()` toggles the
 * console (quake-style): the app binds it to a key (`\`` → `console`) via its
 * own `keys` config, and may override its label/icon.
 *
 * Pure `$state` — no palette import here, so `palette.svelte.ts` can import
 * this module without a cycle (the head `Console.svelte` wires both together).
 */
import type { PaletteToolRun } from './types'

export type ConsoleMode = 'run' | 'edit'

export type ConsoleState = {
	open: boolean
	mode: ConsoleMode
	selectedEntryId: string | undefined
	selectedVariantId: string | undefined
	booleanValue: string
	setValue: string
	enumValues: string
	enumKeywords: string
}

/** Module-level console state (same `$state` store pattern as `palettes`). */
export const consoleState = $state<ConsoleState>({
	open: false,
	mode: 'run',
	selectedEntryId: undefined,
	selectedVariantId: undefined,
	booleanValue: 'true',
	setValue: '',
	enumValues: '',
	enumKeywords: '',
})

/** Reset the add-to-toolbar UI state (selection + inline value inputs). */
export function resetConsoleAddState(): void {
	consoleState.selectedEntryId = undefined
	consoleState.selectedVariantId = undefined
	consoleState.booleanValue = 'true'
	consoleState.setValue = ''
	consoleState.enumValues = ''
	consoleState.enumKeywords = ''
}

/** Open the console in the given mode (defaults to `run`). */
export function openConsole(mode: ConsoleMode = 'run'): void {
	resetConsoleAddState()
	consoleState.mode = mode
	consoleState.open = true
}

/** Close the console and reset its add-to-toolbar UI state. */
export function closeConsole(): void {
	consoleState.open = false
	resetConsoleAddState()
}

/** Quake-style toggle: open in `run` mode, or close if already open. */
export function toggleConsole(): void {
	if (consoleState.open) closeConsole()
	else openConsole('run')
}

/** Split a comma-separated string into trimmed non-empty tokens. */
export function popupAddList(value: string): string[] {
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
}

/**
 * Build a core `console` run tool.
 *
 * The returned tool's `run()` shows the console (quake toggle). Apps include it
 * in their `tools` map and bind it to a key (`\`` → `console`) in `keys`; pass
 * `options` to override the default label/icon.
 */
export function consoleTool(options?: { label?: string; icon?: string }): PaletteToolRun {
	return {
		label: options?.label ?? 'Console',
		icon: options?.icon ?? '⌘',
		categories: ['system'],
		keywords: ['console', 'terminal', 'command', 'cli', 'shell'],
		get can() {
			return true
		},
		run() {
			toggleConsole()
		},
	}
}
