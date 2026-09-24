/**
 * `@palettable/demo-core` — shared Stellar Outpost demo definitions.
 *
 * Framework-agnostic pure data + factories consumed by every adapter demo
 * (vanilla, vue, …) via dev-dependencies. No DOM, no reactivity, no
 * framework components: each adapter wires its own state (vanilla uses a
 * `ValuesBag` + value-proxy lens) and passes it into the factories through
 * the `DemoActions` seam.
 *
 * Ownership rule: demo-core owns definitions and data (points, layouts,
 * ships, locales, icons, storage keys). Adapters own components and chrome
 * (DOM rendering, custom editors, configurator fields).
 *
 * Custom components are NOT part of this package: adapters define their
 * own editors/fields with their own characteristics.
 */

export * from './i18n.js'
export * from './icons.js'
export * from './keys.js'
export * from './layouts.js'
export * from './points.js'
export * from './ships.js'
export * from './state.js'
export * from './storage.js'

/** Adapter lens shape for UI-only reads (`alertLevel`, `lastAction`, …). */
export type DemoLens = {
	alertLevel: string
	lastAction: string
	[key: string]: unknown
}
