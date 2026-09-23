/**
 * `@palettable/core` — console state machine (Phase 4).
 *
 * Extracted from the original reference UI's console state. Plain state +
 * listener set: adapters subscribe and mirror reactively.
 *
 * SSR: console is resting-state only (no timers/popups/interactivity on
 * the server).
 */
import type { Unsubscribe } from './identifiers.js'
import { type CatalogStrings, defaultCatalogStrings } from './strings.js'

export type ConsoleMode = 'run' | 'edit'

export type ConsoleState = {
	readonly open: boolean
	readonly mode: ConsoleMode
	readonly selectedEntryId: string | undefined
}

export type ConsoleListener = (state: ConsoleState) => void

const initialConsoleState: ConsoleState = {
	open: false,
	mode: 'run',
	selectedEntryId: undefined,
}

const defaultAddState: Pick<ConsoleState, 'selectedEntryId'> = {
	selectedEntryId: undefined,
}

/** Vanilla console state machine + listener set (no runes, no DOM). */
export class ConsoleStore {
	private state: ConsoleState = { ...initialConsoleState }
	private listeners = new Set<ConsoleListener>()

	/** Current state snapshot (fresh object each call). */
	get snapshot(): ConsoleState {
		return { ...this.state }
	}

	/** Open the console in the given mode (defaults to `run`). */
	open(mode: ConsoleMode = 'run'): void {
		this.state = { ...this.state, ...defaultAddState, mode, open: true }
		this.emit()
	}

	/** Close the console and reset its add-to-toolbar UI state. */
	close(): void {
		this.state = { ...this.state, open: false, ...defaultAddState }
		this.emit()
	}

	/** Quake-style toggle: open in `run` mode, or close if already open. */
	toggle(): void {
		if (this.state.open) this.close()
		else this.open('run')
	}

	/** Reset the add-to-toolbar UI state (selection). */
	resetAddState(): void {
		this.state = { ...this.state, ...defaultAddState }
		this.emit()
	}

	/** Patch add-to-toolbar UI state (selection). */
	patch(patch: Partial<Pick<ConsoleState, 'selectedEntryId'>>): void {
		this.state = { ...this.state, ...patch }
		this.emit()
	}

	subscribe(listener: ConsoleListener): Unsubscribe {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	/** Remove all listeners (adapter teardown). State is kept. */
	clearListeners(): void {
		this.listeners.clear()
	}

	private emit(): void {
		const snapshot = this.snapshot
		for (const listener of [...this.listeners]) listener(snapshot)
	}
}

/**
 * Build a `console` action-point descriptor (run point, no framework import).
 * The adapter binds `run` to a `ConsoleStore` toggle; `label`/`icon` are
 * overridable. Pass the resolved catalog strings (`core.strings`) so the
 * label + keywords follow the locale; explicit `label` still wins.
 */
export function consolePointDescriptor(options?: {
	label?: string
	icon?: string
	strings?: Pick<CatalogStrings, 'consoleKeywords' | 'pointLabels'>
}): {
	readonly id: 'console'
	readonly label: string
	readonly type: 'action'
	readonly keywords: readonly string[]
	readonly icon: string
} {
	const dictLabel = options?.strings?.pointLabels?.['console']
	return {
		id: 'console',
		label: options?.label ?? dictLabel ?? 'Console',
		type: 'action',
		keywords: [...(options?.strings?.consoleKeywords ?? defaultCatalogStrings.consoleKeywords)],
		icon: options?.icon ?? '⌘',
	}
}
