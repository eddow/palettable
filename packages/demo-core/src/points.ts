/**
 * Shared point definitions for the Stellar Outpost demo.
 *
 * Pure-data port of the vanilla demo: the same colony points
 * (boolean/enum/number/action + `console`), ship context points and the
 * `locale` system point. Action `run`/`can` never touch adapter state
 * directly — they read through the injected `DemoActions` seam (bound by
 * each adapter to its own reactivity) or receive bags via `uses`.
 */
import type { AnyPoint } from '@palettable/core'
import { shipById } from './ships.js'
import { isColonyDirtyValues } from './state.js'
import { COLONY_SAVE_KEY } from './storage.js'

/**
 * Adapter-owned behaviour injected into the point factory. Each adapter
 * binds these to its own reactivity (vanilla: value-proxy lens +
 * `core.setMany`; vue/svelte: their own stores).
 */
export type DemoActions = {
	/** Current alert level (drives `emergencyProtocol.can`). */
	getAlertLevel: () => string
	/** Live colony values (drives `resetSimulation.can`). */
	getColonyValues: () => Readonly<Record<string, unknown>>
	/** Report a UI-only message (last-action chrome). */
	setLastAction: (message: string) => void
	/** Reset colony values to defaults (live `core.setMany`). */
	resetColony: () => void
	/** Toggle the developer console. */
	toggleConsole: () => void
	/** Persist a colony snapshot (defaults to localStorage). */
	saveColony: (snapshot: Readonly<Record<string, unknown>>) => boolean
	/** Read the colony snapshot used by `saveColony`. */
	getColonySnapshot: () => Readonly<Record<string, unknown>>
}

export function demoPoints(actions: DemoActions): AnyPoint[] {
	return [
		{
			id: 'autoOxygen',
			label: 'Automated Life Support',
			type: 'boolean',
			icon: '💨',
			keywords: ['oxygen', 'air', 'breathing', 'recycling', 'auto'],
		},
		{
			id: 'colonyTheme',
			label: 'Outpost Atmosphere',
			type: 'enum',
			icon: '🪐',
			keywords: ['theme', 'style', 'mars', 'void', 'skin', 'color'],
			constraints: {
				options: [
					{ value: 'mars', icon: '🔴', label: 'Mars', keywords: ['red', 'dust'] },
					{ value: 'neptune', icon: '🔵', label: 'Neptune', keywords: ['blue', 'ice'] },
					{ value: 'void', icon: '⚫', label: 'Void', keywords: ['dark', 'deep'] },
					{ value: 'matrix', icon: '🟢', label: 'Matrix', keywords: ['green', 'grid'] },
				],
			},
		},
		{
			id: 'powerPriority',
			label: 'Power Grid Focus',
			type: 'enum',
			icon: '🔌',
			keywords: ['power', 'energy', 'grid', 'priority', 'research', 'defense', 'economy'],
			constraints: {
				options: [
					{ value: 'research', icon: '🔬', label: 'Research', keywords: ['science', 'lab'] },
					{ value: 'defense', icon: '🎯', label: 'Defense', keywords: ['turret', 'guard'] },
					{ value: 'economy', icon: '💰', label: 'Economy', keywords: ['trade', 'credits'] },
					{ value: 'balanced', icon: '⚖️', label: 'Balanced', keywords: ['even', 'auto'] },
				],
			},
		},
		{
			id: 'alertLevel',
			label: 'Threat Level',
			type: 'enum',
			icon: '⚠️',
			keywords: ['alert', 'threat', 'status', 'defcon', 'green', 'yellow', 'red', 'black'],
			constraints: {
				options: [
					{ value: 'green', icon: '🟢', label: 'Green', keywords: ['safe', 'calm'] },
					{ value: 'yellow', icon: '🟡', label: 'Yellow', keywords: ['caution', 'watch'] },
					{ value: 'red', icon: '🔴', label: 'Red', keywords: ['danger', 'attack'] },
					{ value: 'black', icon: '⬛', label: 'Black', keywords: ['critical', 'doom'] },
				],
			},
		},
		{
			id: 'theme',
			label: 'Theme',
			type: 'nothing',
			icon: 'icon:theme',
			keywords: ['color', 'theme', 'dark', 'light', 'system'],
			controls: ['theme'],
			options: [
				{ value: 'light', icon: 'icon:sun', label: 'Light' },
				{ value: 'dark', icon: 'icon:moon', label: 'Dark' },
				{ value: 'system', icon: 'icon:terminal', label: 'System' },
			],
		},
		{
			id: 'locale',
			label: 'Language',
			type: 'enum',
			icon: '🌐',
			keywords: ['language', 'locale', 'english', 'french', 'flag', 'langue'],
			constraints: {
				options: [
					{ value: 'en', icon: 'icon:flag-en', label: 'EN', keywords: ['english', 'anglais'] },
					{ value: 'fr', icon: 'icon:flag-fr', label: 'FR', keywords: ['french', 'francais'] },
				],
			},
		},
		{
			id: 'commandBox',
			label: 'Command',
			type: 'nothing',
			icon: '⌘',
			keywords: ['command', 'search', 'run', 'palette'],
			controls: ['commandBox'],
		},
		{
			id: 'moreDrawer',
			label: 'More',
			type: 'nothing',
			icon: '🗂',
			keywords: ['drawer', 'more', 'nested'],
			controls: ['drawer'],
		},
		{
			id: 'missionTime',
			label: 'Mission time',
			type: 'nothing',
			icon: '⏱️',
			keywords: ['mission', 'time', 'status', 'clock'],
			controls: ['status'],
			uses: ['mission'],
		},
		{
			id: 'taxRate',
			label: 'Colony Tax Rate',
			type: 'number',
			icon: '🪙',
			keywords: ['tax', 'credits', 'economy', 'money', 'revenue'],
			constraints: { min: 0, max: 50, step: 5 },
		},
		{
			id: 'gameSpeed',
			label: 'Simulation Speed',
			type: 'number',
			icon: '⏱️',
			keywords: ['speed', 'time', 'rate', 'clock', 'multiplier'],
			constraints: { min: 0.5, max: 5, step: 0.5 },
		},
		{
			id: 'solarEfficiency',
			label: 'Solar Array Multiplier',
			type: 'number',
			icon: '☀️',
			keywords: ['solar', 'energy', 'efficiency', 'multiplier', 'panels'],
			constraints: { min: 0.8, max: 3, step: 0.1 },
		},
		{
			id: 'satisfaction',
			label: 'Colony Satisfaction',
			type: 'number',
			icon: '⭐',
			keywords: ['satisfaction', 'morale', 'happiness', 'rating'],
			constraints: { min: 1, max: 5, step: 1 },
		},
		{
			id: 'shieldGenerator',
			label: 'Deflector Shields',
			type: 'boolean',
			icon: '🛡️',
			keywords: ['shields', 'defense', 'protection', 'barrier'],
		},
		{
			id: 'fastMode',
			label: 'Hyper-Tick Mode',
			type: 'boolean',
			icon: '⚡',
			keywords: ['fast', 'speed', 'turbo', 'tick'],
		},
		{
			id: 'emergencyProtocol',
			label: 'Emergency Lockdown',
			type: 'action',
			icon: '🚨',
			keywords: ['lockdown', 'evacuate', 'alert', 'crisis'],
			can: () => actions.getAlertLevel() !== 'green',
			run() {
				actions.setLastAction('Colony lockdown initiated! All personnel to shelters.')
			},
		},
		{
			id: 'saveGame',
			label: 'Save Colony State',
			type: 'action',
			icon: '💾',
			keywords: ['save', 'serialize', 'export', 'backup'],
			can: () => true,
			run() {
				const saved = actions.saveColony(actions.getColonySnapshot())
				actions.setLastAction(saved ? 'Colony saved' : 'Colony save failed')
			},
		},
		{
			id: 'resetSimulation',
			label: 'Reset Colony',
			type: 'action',
			icon: '🔄',
			keywords: ['reset', 'wipe', 'restart', 'default'],
			can: () => isColonyDirtyValues(actions.getColonyValues()),
			run() {
				actions.resetColony()
				actions.setLastAction('Colony reset to defaults')
			},
		},
		{
			id: 'console',
			label: 'Developer Console',
			type: 'action',
			icon: '💻',
			keywords: ['console', 'terminal', 'command', 'cli', 'shell'],
			can: () => true,
			run() {
				actions.toggleConsole()
			},
		},
		{
			id: 'shipStatus',
			label: 'Selected ship',
			type: 'nothing',
			icon: '🚀',
			keywords: ['ship', 'fleet', 'selection', 'status'],
			controls: ['status'],
			uses: ['ship'],
		},
		{
			id: 'shipShields',
			label: 'Ship Shields',
			type: 'boolean',
			icon: '🛡️',
			keywords: ['ship', 'shields', 'defense', 'fleet'],
			uses: ['ship'],
		},
		{
			id: 'shipPower',
			label: 'Ship Reactor',
			type: 'number',
			icon: '🔋',
			keywords: ['ship', 'reactor', 'power', 'fleet'],
			constraints: { min: 0.5, max: 5, step: 0.5 },
			uses: ['ship'],
		},
		{
			id: 'fireTorpedo',
			label: 'Fire Torpedo',
			type: 'action',
			icon: '💥',
			keywords: ['ship', 'fire', 'torpedo', 'weapon', 'fleet'],
			uses: ['ship'],
			can: (bag) => bag?.get('shipId') !== undefined,
			run(ship) {
				const id = ship?.get('shipId')
				const entry = shipById(typeof id === 'string' ? id : undefined)
				actions.setLastAction(
					entry !== undefined
						? `${entry.name} fired a torpedo!`
						: 'No ship selected — torpedo held.'
				)
			},
		},
	]
}

/**
 * Default `saveColony` implementation: persists the snapshot to
 * localStorage under `COLONY_SAVE_KEY`. Returns `false` when storage is
 * unavailable (private mode, SSR, …). Adapters may pass their own
 * implementation; this one keeps the vanilla behaviour verbatim.
 */
export function saveColonyToStorage(snapshot: Readonly<Record<string, unknown>>): boolean {
	try {
		localStorage.setItem(COLONY_SAVE_KEY, JSON.stringify({ ...snapshot }))
		return true
	} catch {
		return false
	}
}
