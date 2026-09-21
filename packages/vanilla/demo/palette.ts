/**
 * Vanilla Stellar Outpost demo — point definitions + layouts + configs.
 *
 * Plain-data port of `packages/svelte/src/demo/palette.svelte.ts`: the same
 * colony points (boolean/enum/number/action + `console`), the same three
 * configurations (`rw-combobox` / `rw-command-first` / `ro-combobox`), and
 * the same toolbar layouts. Core `AnyPoint` descriptors carry no defaults
 * (core holds no defaults — absent key = skeleton); the single consumer
 * defaults object below (`CONSUMER_DEFAULTS`) is the only reset/dirty
 * source, applied via live `core.setMany` (never `initialValues`).
 * Action `run`/`can` never touch `demoState` directly — they read through
 * the value-proxy lens (bound in `main.ts`) or receive bags via `uses`.
 */

import type { AnyPoint, Border, Borders, Parking } from '@palettable/core'

export type DemoMode = 'rw-combobox' | 'rw-command-first' | 'ro-combobox'

export type DemoConfig = {
	readonly id: DemoMode
	readonly label: string
	readonly description: string
	readonly editable: boolean
	readonly layout: Borders
	readonly parking: Parking
}

export type DemoState = {
	autoOxygen: boolean
	shieldGenerator: boolean
	fastMode: boolean
	colonyTheme: 'mars' | 'neptune' | 'void' | 'matrix'
	alertLevel: 'green' | 'yellow' | 'red' | 'black'
	powerPriority: 'research' | 'defense' | 'economy' | 'balanced'
	theme: 'light' | 'dark' | 'system'
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
	theme: 'system',
	gameSpeed: 1,
	taxRate: 15,
	solarEfficiency: 1.2,
	satisfaction: 3,
} as const

/** Keys holding colony values (excludes UI-only `missionElapsed`/`lastAction`). */
export const COLONY_VALUE_KEYS = Object.keys(
	CONSUMER_DEFAULTS
) as (keyof typeof CONSUMER_DEFAULTS)[]

export type DemoLens = {
	alertLevel: DemoState['alertLevel']
	lastAction: string
	[key: string]: unknown
}

/** Bound by `main.ts` to the value-proxy lens (bag = single source). */
export let demoLens: DemoLens = { alertLevel: 'green', lastAction: 'Ready' }

export function bindDemoLens(lens: DemoLens): void {
	demoLens = lens
}

export const demoState: DemoState = {
	...CONSUMER_DEFAULTS,
	missionElapsed: '00:00',
	lastAction: 'Ready',
}

export function resetColonyValues(): Record<string, unknown> {
	return { ...CONSUMER_DEFAULTS }
}

export function isColonyDirtyValues(values: Readonly<Record<string, unknown>>): boolean {
	return COLONY_VALUE_KEYS.some((key) => !Object.is(values[key], CONSUMER_DEFAULTS[key]))
}

/**
 * Legacy direct reset (kept for the `resetSimulation` fallback path only).
 * Preferred path is `core.setMany(resetColonyValues())` via `bindResetViaCore`.
 * Writes via the lens so the single `onChange` render path fires.
 */
export function resetColony(): void {
	Object.assign(demoLens, CONSUMER_DEFAULTS)
	demoLens.lastAction = 'Colony reset to defaults'
}

let consoleToggle: (() => void) | undefined

/** Bound by `main.ts`: reset = live `core.setMany(CONSUMER_DEFAULTS)`. */
let resetViaCore: (() => void) | undefined

export function bindConsoleToggle(toggle: () => void): void {
	consoleToggle = toggle
}

export function bindResetViaCore(reset: () => void): void {
	resetViaCore = reset
}

export function demoPoints(): AnyPoint[] {
	return [
		{
			id: 'autoOxygen',
			label: 'Automated Life Support',
			type: 'boolean',
			icon: '💨',
			categories: ['systems', 'automation'],
			keywords: ['oxygen', 'air', 'breathing', 'recycling', 'auto'],
		},
		{
			id: 'colonyTheme',
			label: 'Outpost Atmosphere',
			type: 'enum',
			icon: '🪐',
			categories: ['appearance'],
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
			categories: ['economy', 'power'],
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
			categories: ['security'],
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
			type: 'enum',
			icon: '🎨',
			categories: ['appearance'],
			keywords: ['color'],
			constraints: {
				options: [
					{ value: 'light', icon: '☀️', label: 'Light' },
					{ value: 'dark', icon: '🌙', label: 'Dark' },
					{ value: 'system', icon: '💻', label: 'System' },
				],
			},
		},
		{
			id: 'taxRate',
			label: 'Colony Tax Rate',
			type: 'number',
			icon: '🪙',
			categories: ['economy'],
			keywords: ['tax', 'credits', 'economy', 'money', 'revenue'],
			constraints: { min: 0, max: 50, step: 5 },
		},
		{
			id: 'gameSpeed',
			label: 'Simulation Speed',
			type: 'number',
			icon: '⏱️',
			categories: ['simulation'],
			keywords: ['speed', 'time', 'rate', 'clock', 'multiplier'],
			constraints: { min: 0.5, max: 5, step: 0.5 },
		},
		{
			id: 'solarEfficiency',
			label: 'Solar Array Multiplier',
			type: 'number',
			icon: '☀️',
			categories: ['power'],
			keywords: ['solar', 'energy', 'efficiency', 'multiplier', 'panels'],
			constraints: { min: 0.8, max: 3, step: 0.1 },
		},
		{
			id: 'satisfaction',
			label: 'Colony Satisfaction',
			type: 'number',
			icon: '⭐',
			categories: ['colony'],
			keywords: ['satisfaction', 'morale', 'happiness', 'rating'],
			constraints: { min: 1, max: 5, step: 1 },
		},
		{
			id: 'shieldGenerator',
			label: 'Deflector Shields',
			type: 'boolean',
			icon: '🛡️',
			categories: ['defense'],
			keywords: ['shields', 'defense', 'protection', 'barrier'],
		},
		{
			id: 'fastMode',
			label: 'Hyper-Tick Mode',
			type: 'boolean',
			icon: '⚡',
			categories: ['simulation'],
			keywords: ['fast', 'speed', 'turbo', 'tick'],
		},
		{
			id: 'emergencyProtocol',
			label: 'Emergency Lockdown',
			type: 'action',
			icon: '🚨',
			categories: ['system', 'action'],
			keywords: ['lockdown', 'evacuate', 'alert', 'crisis'],
			can: () => demoLens.alertLevel !== 'green',
			run() {
				demoLens.lastAction = 'Colony lockdown initiated! All personnel to shelters.'
			},
		},
		{
			id: 'saveGame',
			label: 'Save Colony State',
			type: 'action',
			icon: '💾',
			categories: ['system'],
			keywords: ['save', 'serialize', 'export', 'backup'],
			can: () => true,
			run() {
				try {
					localStorage.setItem('stellar-outpost-save', JSON.stringify({ ...demoLens }))
					demoLens.lastAction = 'Colony saved'
				} catch {
					demoLens.lastAction = 'Colony save failed'
				}
			},
		},
		{
			id: 'resetSimulation',
			label: 'Reset Colony',
			type: 'action',
			icon: '🔄',
			categories: ['system'],
			keywords: ['reset', 'wipe', 'restart', 'default'],
			can: () => isColonyDirtyValues(demoLens as unknown as Record<string, unknown>),
			run() {
				if (resetViaCore !== undefined) resetViaCore()
				else resetColony()
			},
		},
		{
			id: 'console',
			label: 'Developer Console',
			type: 'action',
			icon: '💻',
			categories: ['system'],
			keywords: ['console', 'terminal', 'command', 'cli', 'shell'],
			can: () => true,
			run() {
				consoleToggle?.()
			},
		},
	]
}

export const demoKeys: Record<string, string> = {
	'`': 'console',
	N: 'autoOxygen',
	S: 'shieldGenerator',
	E: 'emergencyProtocol',
	'Ctrl+S': 'saveGame',
	'+': 'gameSpeed:inc',
	'-': 'gameSpeed:dec',
	'1': 'alertLevel=green',
	'2': 'alertLevel=yellow',
	'3': 'alertLevel=red',
}

const rwComboboxLayout: Borders = {
	top: [
		[
			{
				space: 0.1,
				toolbar: [
					{
						editor: 'commandBox',
						config: { icon: '⌘', label: 'Command', hint: 'Search and run a command' },
					},
					{
						tool: 'emergencyProtocol',
						editor: 'button',
						config: { icon: '🚨', label: 'Lockdown', hint: 'Head button (run)', tone: 'accent' },
					},
					{
						tool: 'autoOxygen',
						editor: 'toggle',
						config: { icon: '💨', label: 'Life support', hint: 'Compact icon toggle' },
					},
					{
						tool: 'shieldGenerator',
						editor: 'toggle',
						config: { icon: '🛡️', label: 'Shields', hint: 'Compact icon toggle' },
					},
					{
						tool: 'alertLevel',
						editor: 'segmented',
						config: { icon: '⚠️', label: 'Threat', hint: 'Head segmented (enum)' },
					},
				],
			},
			{
				space: 0.9,
				toolbar: [
					{
						tool: 'theme',
						editor: 'theme',
						config: { icon: '🎨', label: 'Theme', hint: 'Pointless theme cycle' },
					},
				],
			},
		],
	],
	left: [
		[
			{
				space: 1,
				toolbar: [
					{
						tool: 'gameSpeed',
						editor: 'slider',
						config: {
							icon: '⏱️',
							label: 'Sim speed',
							hint: 'Demo slider override',
						},
					},
					{
						tool: 'colonyTheme',
						editor: 'select',
						config: { icon: '🪐', label: 'Atmosphere', hint: 'Head select (enum)' },
					},
					{
						tool: 'powerPriority',
						editor: 'segmented',
						config: { icon: '🔌', label: 'Power focus', hint: 'Head segmented (enum)' },
					},
					{
						editor: 'drawer',
						toolbar: [
							{
								space: 1,
								toolbar: [
									{
										tool: 'colonyTheme',
										editor: 'select',
										config: { icon: '🪐', label: 'Atmosphere', hint: 'Nested drawer select' },
									},
									{
										tool: 'gameSpeed',
										editor: 'stepper',
										config: { icon: '⏱️', label: 'Sim speed', hint: 'Nested drawer stepper' },
									},
								],
							},
						],
						config: { icon: '🗂', label: 'More', hint: 'Nested drawer (axis inversion)' },
					},
				],
			},
		],
	],
	right: [
		[
			{
				space: 0,
				toolbar: [
					{
						editor: 'commandBox',
						config: {
							icon: '⌘',
							label: 'Command',
							hint: 'Vertical command box (icon-only, drawer overlay)',
						},
					},
					{
						tool: 'taxRate',
						editor: 'slider',
						config: {
							icon: '🪙',
							label: 'Tax rate',
							hint: 'Demo slider override',
						},
					},
					{
						tool: 'solarEfficiency',
						editor: 'stepper',
						config: { icon: '☀️', label: 'Solar', hint: 'Head stepper (number)' },
					},
					{
						tool: 'gameSpeed',
						editor: 'drawerSlider',
						config: { icon: '⏩', label: 'Sim speed drawer', hint: 'Drawer slider (vertical)' },
					},
					{
						tool: 'satisfaction',
						editor: 'stars',
						config: { icon: '⭐', label: 'Morale', hint: 'Demo stars rating' },
					},
				],
			},
		],
	],
	bottom: [
		[
			{
				space: 0.5,
				toolbar: [
					{
						tool: 'console',
						editor: 'button',
						config: { icon: '💻', label: 'Terminal', hint: 'Head button (run)' },
					},
					{
						tool: 'saveGame',
						editor: 'button',
						config: { icon: '💾', label: 'Save', hint: 'Head button (run)' },
					},
					{
						tool: 'resetSimulation',
						editor: 'button',
						config: { icon: '🔄', label: 'Reset', hint: 'Head button (run)', tone: 'accent' },
					},
					{
						tool: 'fastMode',
						editor: 'toggle',
						config: { icon: '⚡', label: 'Hyper-tick', hint: 'Compact icon toggle' },
					},
					{
						editor: 'status',
						config: { icon: '⏱️', label: 'Mission time', hint: 'Pointless status readout' },
					},
					{
						tool: 'taxRate',
						editor: 'drawerSlider',
						config: { icon: '📉', label: 'Tax drawer', hint: 'Drawer slider (horizontal)' },
					},
				],
			},
		],
	],
}

const commandFirstLayout: Borders = structuredClone(rwComboboxLayout)
// Command-first means *no* combobox anywhere: strip every region, not just
// the top one (the right border hosts a vertical command box too).
for (const region of ['top', 'right', 'bottom', 'left'] as const) {
	commandFirstLayout[region] = commandFirstLayout[region].map((track) =>
		track.map((slot) => ({
			...slot,
			toolbar: slot.toolbar.filter(
				(item) => (item as { editor?: unknown }).editor !== 'commandBox'
			),
		}))
	) as Borders[typeof region]
}

export const demoConfigs: readonly DemoConfig[] = [
	{
		id: 'rw-combobox',
		label: 'R/W + command box',
		description:
			'Read-write; the toolbar hosts a command-box combobox (console opens in edit mode).',
		editable: true,
		layout: rwComboboxLayout,
		parking: [],
	},
	{
		id: 'rw-command-first',
		label: 'R/W command-first',
		description:
			'Read-write; no combobox — the console opens command-first with a square edit-icon button.',
		editable: true,
		layout: commandFirstLayout,
		parking: [],
	},
	{
		id: 'ro-combobox',
		label: 'R-O + command box',
		description: 'Read-only; the combobox runs commands inline, but the layout is not editable.',
		editable: false,
		layout: rwComboboxLayout,
		parking: [],
	},
]

export function demoLayoutFor(id: DemoMode): { borders: Borders; parking: Parking } {
	const config = demoConfigs.find((entry) => entry.id === id) ?? demoConfigs[0]!
	return {
		borders: structuredClone(config.layout) as Borders,
		parking: structuredClone(config.parking) as Parking,
	}
}

export type { Border }
