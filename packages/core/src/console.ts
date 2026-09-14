/**
 * `@palettable/core` — console state machine (Phase 4).
 *
 * Headless port of the svelte adapter's `console.svelte.ts` (which stays
 * adapter-owned until Phase 7 — svelte wraps this in `$state`). Vanilla
 * state + listener set: adapters subscribe and mirror reactively.
 *
 * SSR: console is resting-state only (no timers/popups/interactivity on
 * the server).
 */
import type { Unsubscribe } from './identifiers.js'

export type ConsoleMode = 'run' | 'edit'

export type ConsoleState = {
	readonly open: boolean
	readonly mode: ConsoleMode
	readonly selectedEntryId: string | undefined
	readonly selectedVariantId: string | undefined
	readonly booleanValue: string
	readonly setValue: string
	readonly enumValues: string
	readonly enumKeywords: string
}

export type ConsoleListener = (state: ConsoleState) => void

const initialConsoleState: ConsoleState = {
	open: false,
	mode: 'run',
	selectedEntryId: undefined,
	selectedVariantId: undefined,
	booleanValue: 'true',
	setValue: '',
	enumValues: '',
	enumKeywords: '',
}

const defaultAddState: Pick<
	ConsoleState,
	| 'selectedEntryId'
	| 'selectedVariantId'
	| 'booleanValue'
	| 'setValue'
	| 'enumValues'
	| 'enumKeywords'
> = {
	selectedEntryId: undefined,
	selectedVariantId: undefined,
	booleanValue: 'true',
	setValue: '',
	enumValues: '',
	enumKeywords: '',
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

	/** Reset the add-to-toolbar UI state (selection + inline value inputs). */
	resetAddState(): void {
		this.state = { ...this.state, ...defaultAddState }
		this.emit()
	}

	/** Patch add-to-toolbar UI state (selection + inline value inputs). */
	patch(
		patch: Partial<
			Pick<
				ConsoleState,
				| 'selectedEntryId'
				| 'selectedVariantId'
				| 'booleanValue'
				| 'setValue'
				| 'enumValues'
				| 'enumKeywords'
			>
		>
	): void {
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
 * Build a `console` action-point descriptor (run point, no svelte import).
 * The adapter binds `run` to a `ConsoleStore` toggle; `label`/`icon` are
 * overridable.
 */
export function consolePointDescriptor(options?: { label?: string; icon?: string }): {
	readonly id: 'console'
	readonly label: string
	readonly type: 'action'
	readonly categories: readonly string[]
	readonly keywords: readonly string[]
	readonly icon: string
} {
	return {
		id: 'console',
		label: options?.label ?? 'Console',
		type: 'action',
		categories: ['system'],
		keywords: ['console', 'terminal', 'command', 'cli', 'shell'],
		icon: options?.icon ?? '⌘',
	}
}
