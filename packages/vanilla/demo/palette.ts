/**
 * Vanilla Stellar Outpost demo — point definitions + layouts + configs.
 *
 * Plain-data port of `packages/svelte/src/demo/palette.svelte.ts`: the same
 * colony points (boolean/enum/number/action + `console`), the same three
 * configurations (`rw-combobox` / `rw-command-first` / `ro-combobox`), and
 * the same toolbar layouts. Core `AnyPoint` descriptors (no closures except
 * action `run`, which the demo binds to its own mutable state).
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

const colonyDefaults = {
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

export const demoState: DemoState = {
	...colonyDefaults,
	theme: 'system',
	missionElapsed: '00:00',
	lastAction: 'Ready',
}

export function resetColony(): void {
	Object.assign(demoState, colonyDefaults)
	demoState.lastAction = 'Colony reset to defaults'
}

function isColonyDirty(): boolean {
	return (
		demoState.autoOxygen !== colonyDefaults.autoOxygen ||
		demoState.shieldGenerator !== colonyDefaults.shieldGenerator ||
		demoState.fastMode !== colonyDefaults.fastMode ||
		demoState.colonyTheme !== colonyDefaults.colonyTheme ||
		demoState.alertLevel !== colonyDefaults.alertLevel ||
		demoState.powerPriority !== colonyDefaults.powerPriority ||
		demoState.gameSpeed !== colonyDefaults.gameSpeed ||
		demoState.taxRate !== colonyDefaults.taxRate ||
		demoState.solarEfficiency !== colonyDefaults.solarEfficiency ||
		demoState.satisfaction !== colonyDefaults.satisfaction
	)
}

let consoleToggle: (() => void) | undefined

export function bindConsoleToggle(toggle: () => void): void {
	consoleToggle = toggle
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
			defaultValue: true,
		},
		{
			id: 'colonyTheme',
			label: 'Outpost Atmosphere',
			type: 'enum',
			icon: '🪐',
			categories: ['appearance'],
			keywords: ['theme', 'style', 'mars', 'void', 'skin', 'color'],
			defaultValue: 'mars',
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
			defaultValue: 'balanced',
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
			defaultValue: 'green',
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
			defaultValue: 'system',
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
			defaultValue: 15,
			constraints: { min: 0, max: 50, step: 5 },
		},
		{
			id: 'gameSpeed',
			label: 'Simulation Speed',
			type: 'number',
			icon: '⏱️',
			categories: ['simulation'],
			keywords: ['speed', 'time', 'rate', 'clock', 'multiplier'],
			defaultValue: 1,
			constraints: { min: 0.5, max: 5, step: 0.5 },
		},
		{
			id: 'solarEfficiency',
			label: 'Solar Array Multiplier',
			type: 'number',
			icon: '☀️',
			categories: ['power'],
			keywords: ['solar', 'energy', 'efficiency', 'multiplier', 'panels'],
			defaultValue: 1.2,
			constraints: { min: 0.8, max: 3, step: 0.1 },
		},
		{
			id: 'satisfaction',
			label: 'Colony Satisfaction',
			type: 'number',
			icon: '⭐',
			categories: ['colony'],
			keywords: ['satisfaction', 'morale', 'happiness', 'rating'],
			defaultValue: 3,
			constraints: { min: 1, max: 5, step: 1 },
		},
		{
			id: 'shieldGenerator',
			label: 'Deflector Shields',
			type: 'boolean',
			icon: '🛡️',
			categories: ['defense'],
			keywords: ['shields', 'defense', 'protection', 'barrier'],
			defaultValue: false,
		},
		{
			id: 'fastMode',
			label: 'Hyper-Tick Mode',
			type: 'boolean',
			icon: '⚡',
			categories: ['simulation'],
			keywords: ['fast', 'speed', 'turbo', 'tick'],
			defaultValue: false,
		},
		{
			id: 'emergencyProtocol',
			label: 'Emergency Lockdown',
			type: 'action',
			icon: '🚨',
			categories: ['system', 'action'],
			keywords: ['lockdown', 'evacuate', 'alert', 'crisis'],
			can: () => demoState.alertLevel !== 'green',
			run() {
				demoState.lastAction = 'Colony lockdown initiated! All personnel to shelters.'
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
					localStorage.setItem('stellar-outpost-save', JSON.stringify({ ...demoState }))
					demoState.lastAction = 'Colony saved'
				} catch {
					demoState.lastAction = 'Colony save failed'
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
			can: () => isColonyDirty(),
			run() {
				resetColony()
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
							demoSlider: true,
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
						tool: 'taxRate',
						editor: 'slider',
						config: {
							icon: '🪙',
							label: 'Tax rate',
							hint: 'Demo slider override',
							demoSlider: true,
						},
					},
					{
						tool: 'solarEfficiency',
						editor: 'stepper',
						config: { icon: '☀️', label: 'Solar', hint: 'Head stepper (number)' },
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
				],
			},
		],
	],
}

const commandFirstLayout: Borders = structuredClone(rwComboboxLayout)
commandFirstLayout.top = commandFirstLayout.top.map((track) =>
	track.map((slot) => ({
		...slot,
		toolbar: slot.toolbar.filter((item) => (item as { editor?: unknown }).editor !== 'commandBox'),
	}))
) as Borders['top']

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
