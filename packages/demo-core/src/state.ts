/**
 * Shared demo state: types + the single consumer defaults object.
 *
 * Core `AnyPoint` descriptors carry no defaults (core holds no defaults —
 * absent key = skeleton); `CONSUMER_DEFAULTS` is the only reset/dirty
 * source, applied via live `core.setMany` (never `initialValues`).
 * `theme` is a nothing-point system value (document root class) — it never
 * enters the bag, so it stays out of defaults/dirty/reset. `locale` is a
 * valued enum point (system value like `theme`, but it needs a store value
 * for the segmented control) — also excluded from defaults/dirty/reset.
 */

export type DemoMode = 'rw-combobox' | 'rw-command-first' | 'ro-combobox'

export type DemoState = {
	autoOxygen: boolean
	shieldGenerator: boolean
	fastMode: boolean
	colonyTheme: 'mars' | 'neptune' | 'void' | 'matrix'
	alertLevel: 'green' | 'yellow' | 'red' | 'black'
	powerPriority: 'research' | 'defense' | 'economy' | 'balanced'
	gameSpeed: number
	taxRate: number
	solarEfficiency: number
	satisfaction: number
	missionElapsed: string
	lastAction: string
}

/**
 * Single consumer defaults object: the only reset/dirty source.
 * Reset = `core.setMany(CONSUMER_DEFAULTS)`; dirty = diff of live bag
 * values vs these defaults. Point definitions carry no `defaultValue`.
 */
export const CONSUMER_DEFAULTS = {
	autoOxygen: true,
	shieldGenerator: false,
	fastMode: false,
	colonyTheme: 'mars',
	alertLevel: 'green',
	powerPriority: 'balanced',
	gameSpeed: 1,
	taxRate: 15,
	solarEfficiency: 1.2,
	satisfaction: 3,
} as const

/** Keys holding colony values (excludes UI-only `missionElapsed`/`lastAction`). */
export const COLONY_VALUE_KEYS = Object.keys(
	CONSUMER_DEFAULTS
) as (keyof typeof CONSUMER_DEFAULTS)[]

/** Fresh initial state: defaults + UI-only keys. */
export function createDemoState(): DemoState {
	return {
		...CONSUMER_DEFAULTS,
		missionElapsed: '00:00',
		lastAction: 'Ready',
	}
}

export function resetColonyValues(): Record<string, unknown> {
	return { ...CONSUMER_DEFAULTS }
}

export function isColonyDirtyValues(values: Readonly<Record<string, unknown>>): boolean {
	return COLONY_VALUE_KEYS.some((key) => !Object.is(values[key], CONSUMER_DEFAULTS[key]))
}
