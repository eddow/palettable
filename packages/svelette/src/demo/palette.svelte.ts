import { headEditors } from '$lib/head/registry'
import {
	consoleTool,
	Palette,
	type PaletteBorders,
	type PaletteParking,
} from '$lib/palette/edition.svelte'
import { demoEditors } from './editors/registry'

/** The demo's read/write flag, toggled per configuration (reactive). */
let demoEditable = $state(true)

/** Switch the demo palette between read-only and editable. */
export function setDemoEditable(value: boolean): void {
	demoEditable = value
}

/** The distinct demo configurations, each loaded by its own preset command button. */
export type DemoMode = 'rw-combobox' | 'rw-command-first' | 'ro-combobox'

export type DemoConfig = {
	id: DemoMode
	label: string
	description: string
	editable: boolean
	layout: PaletteBorders
	/** Preset parking stack. Presets own their parking like their borders —
	 * loading a preset restores both, so a stale parked row never survives
	 * a preset switch. Empty unless a preset defines parked content. */
	parking: PaletteParking
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
	/** Mission launch elapsed time, formatted `mm:ss`, ticked by the page clock for the work-zone chip. */
	missionElapsed: string
	lastAction: string
}

/** Colony defaults (theme is a system setting and survives resets). */
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

export const demoState = $state<DemoState>({
	...colonyDefaults,
	theme: 'system',
	missionElapsed: '00:00',
	lastAction: 'Ready',
})

export function resetColony() {
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

export const demoPalette: Palette = new Palette({
	tools: {
		autoOxygen: {
			type: 'boolean',
			label: 'Automated Life Support',
			icon: '💨',
			categories: ['systems', 'automation'],
			keywords: ['oxygen', 'air', 'breathing', 'recycling', 'auto'],
			get value() {
				return demoState.autoOxygen
			},
			set value(value) {
				demoState.autoOxygen = value
			},
			default: true,
		},
		colonyTheme: {
			type: 'enum',
			label: 'Outpost Atmosphere',
			icon: '🪐',
			categories: ['appearance'],
			keywords: ['theme', 'style', 'mars', 'void', 'skin', 'color'],
			get value() {
				return demoState.colonyTheme
			},
			set value(value) {
				demoState.colonyTheme = value
			},
			default: 'mars',
			values: [
				{ value: 'mars', icon: '🔴', label: 'Mars', keywords: ['red', 'dust'] },
				{ value: 'neptune', icon: '🔵', label: 'Neptune', keywords: ['blue', 'ice'] },
				{ value: 'void', icon: '⚫', label: 'Void', keywords: ['dark', 'deep'] },
				{ value: 'matrix', icon: '🟢', label: 'Matrix', keywords: ['green', 'grid'] },
			],
		},
		powerPriority: {
			type: 'enum',
			label: 'Power Grid Focus',
			icon: '🔌',
			categories: ['economy', 'power'],
			keywords: ['power', 'energy', 'grid', 'priority', 'research', 'defense', 'economy'],
			get value() {
				return demoState.powerPriority
			},
			set value(value) {
				demoState.powerPriority = value
			},
			default: 'balanced',
			values: [
				{ value: 'research', icon: '🔬', label: 'Research', keywords: ['science', 'lab'] },
				{ value: 'defense', icon: '🎯', label: 'Defense', keywords: ['turret', 'guard'] },
				{ value: 'economy', icon: '💰', label: 'Economy', keywords: ['trade', 'credits'] },
				{ value: 'balanced', icon: '⚖️', label: 'Balanced', keywords: ['even', 'auto'] },
			],
		},
		alertLevel: {
			type: 'enum',
			label: 'Threat Level',
			icon: '⚠️',
			categories: ['security'],
			keywords: ['alert', 'threat', 'status', 'defcon', 'green', 'yellow', 'red', 'black'],
			get value() {
				return demoState.alertLevel
			},
			set value(value) {
				demoState.alertLevel = value
			},
			default: 'green',
			values: [
				{ value: 'green', icon: '🟢', label: 'Green', keywords: ['safe', 'calm'] },
				{ value: 'yellow', icon: '🟡', label: 'Yellow', keywords: ['caution', 'watch'] },
				{ value: 'red', icon: '🔴', label: 'Red', keywords: ['danger', 'attack'] },
				{ value: 'black', icon: '⬛', label: 'Black', keywords: ['critical', 'doom'] },
			],
		},
		theme: {
			type: 'enum',
			label: 'Theme',
			icon: '🎨',
			categories: ['appearance'],
			keywords: ['color'],
			get value() {
				return demoState.theme
			},
			set value(value) {
				demoState.theme = value
			},
			default: 'system',
			values: [
				{ value: 'light', icon: '☀️', label: 'Light' },
				{ value: 'dark', icon: '🌙', label: 'Dark' },
				{ value: 'system', icon: '💻', label: 'System' },
			],
		},
		taxRate: {
			type: 'number',
			label: 'Colony Tax Rate',
			icon: '🪙',
			categories: ['economy'],
			keywords: ['tax', 'credits', 'economy', 'money', 'revenue'],
			get value() {
				return demoState.taxRate
			},
			set value(value) {
				demoState.taxRate = value
			},
			default: 15,
			min: 0,
			max: 50,
			step: 5,
		},
		gameSpeed: {
			type: 'number',
			label: 'Simulation Speed',
			icon: '⏱️',
			categories: ['simulation'],
			keywords: ['speed', 'time', 'rate', 'clock', 'multiplier'],
			get value() {
				return demoState.gameSpeed
			},
			set value(value) {
				demoState.gameSpeed = value
			},
			default: 1,
			min: 0.5,
			max: 5,
			step: 0.5,
		},
		solarEfficiency: {
			type: 'number',
			label: 'Solar Array Multiplier',
			icon: '☀️',
			categories: ['power'],
			keywords: ['solar', 'energy', 'efficiency', 'multiplier', 'panels'],
			get value() {
				return demoState.solarEfficiency
			},
			set value(value) {
				demoState.solarEfficiency = value
			},
			default: 1.2,
			min: 0.8,
			max: 3,
			step: 0.1,
		},
		satisfaction: {
			type: 'number',
			label: 'Colony Satisfaction',
			icon: '⭐',
			categories: ['colony'],
			keywords: ['satisfaction', 'morale', 'happiness', 'rating'],
			get value() {
				return demoState.satisfaction
			},
			set value(value) {
				demoState.satisfaction = value
			},
			default: 3,
			min: 1,
			max: 5,
			step: 1,
		},
		shieldGenerator: {
			type: 'boolean',
			label: 'Deflector Shields',
			icon: '🛡️',
			categories: ['defense'],
			keywords: ['shields', 'defense', 'protection', 'barrier'],
			get value() {
				return demoState.shieldGenerator
			},
			set value(value) {
				demoState.shieldGenerator = value
			},
			default: false,
		},
		fastMode: {
			type: 'boolean',
			label: 'Hyper-Tick Mode',
			icon: '⚡',
			categories: ['simulation'],
			keywords: ['fast', 'speed', 'turbo', 'tick'],
			get value() {
				return demoState.fastMode
			},
			set value(value) {
				demoState.fastMode = value
			},
			default: false,
		},
		emergencyProtocol: {
			label: 'Emergency Lockdown',
			icon: '🚨',
			categories: ['system', 'action'],
			keywords: ['lockdown', 'evacuate', 'alert', 'crisis'],
			get can() {
				return demoState.alertLevel !== 'green'
			},
			run() {
				demoState.lastAction = 'Colony lockdown initiated! All personnel to shelters.'
			},
		},
		saveGame: {
			label: 'Save Colony State',
			icon: '💾',
			categories: ['system'],
			keywords: ['save', 'serialize', 'export', 'backup'],
			get can() {
				return true
			},
			run() {
				try {
					localStorage.setItem('stellar-outpost-save', JSON.stringify({ ...demoState }))
					demoState.lastAction = 'Colony saved'
				} catch {
					demoState.lastAction = 'Colony save failed'
				}
			},
		},
		resetSimulation: {
			label: 'Reset Colony',
			icon: '🔄',
			categories: ['system'],
			keywords: ['reset', 'wipe', 'restart', 'default'],
			get can() {
				return isColonyDirty()
			},
			run() {
				resetColony()
			},
		},
		console: {
			// The core `console` tool — running it shows the console (quake toggle).
			// The demo overrides its label/icon to fit the Stellar Outpost theme;
			// the key binding (`` ` `` → `console`) is pure config below.
			...consoleTool({ label: 'Developer Console', icon: '💻' }),
		},
	},
	keys: {
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
	},
	get editable() {
		return demoEditable
	},
	// Demo proves the default head: every family resolves through `headEditors`,
	// and the single demo override (`number.slider`) replaces the head's slider
	// because the demo spread comes last. `boolean`/`enum`/`item`/`run` have no
	// demo variants at all, so they are the head verbatim.
	editors: {
		boolean: { ...headEditors.boolean, ...demoEditors.boolean },
		enum: { ...headEditors.enum, ...demoEditors.enum },
		number: { ...headEditors.number, ...demoEditors.number },
		item: { ...headEditors.item, ...demoEditors.item },
		run: { ...headEditors.run, ...demoEditors.run },
	} as never,
	editorDefaults: {
		run: 'button',
		boolean: 'toggle',
		enum: 'select',
		number: 'slider',
	},
})

/**
 * The full colony layout with a top-bar `commandBox` combobox (the "R/W +
 * command box" and "R-O + command box" configurations share this shape).
 */
const rwComboboxLayout: PaletteBorders = {
	// Top bar: instant actions + high-priority states. The command box opens
	// first (VS-Code style), followed by the icon-only edit-mode toggle.
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
	// Left border: simulation pacing + environmental settings.
	left: [
		[
			{
				space: 1,
				toolbar: [
					{
						tool: 'gameSpeed',
						editor: 'slider',
						config: { icon: '⏱️', label: 'Sim speed', hint: 'Demo slider override' },
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
	// Right border: economic + hardware performance parameters.
	right: [
		[
			{
				space: 0,
				toolbar: [
					{
						tool: 'taxRate',
						editor: 'slider',
						config: { icon: '🪙', label: 'Tax rate', hint: 'Demo slider override' },
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
	// Bottom bar: developer utilities, save triggers, secondary commands.
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

/**
 * Command-first layout: same colony tools, but **no** `commandBox` combobox on
 * any toolbar. The console opens command-first (its own run box) and, when the
 * palette is editable, shows a square edit-icon button to enter/leave edit mode.
 */
const commandFirstLayout: PaletteBorders = structuredClone(rwComboboxLayout)
// Drop the `commandBox` item from the top toolbar so no combobox is displayed.
commandFirstLayout.top = commandFirstLayout.top.map((track) =>
	track.map((slot) => ({
		...slot,
		toolbar: slot.toolbar.filter((item) => item.editor !== 'commandBox'),
	}))
)

/** All demo configurations; each gets its own "reset" button in the demo bar. */
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

/**
 * Default configuration (matches the legacy `initialIdeConfig`).
 *
 * Returns the borders AND the preset parking: a preset load restores the
 * whole configuration, never borders alone.
 */
export function demoLayoutFor(id: DemoMode): { borders: PaletteBorders; parking: PaletteParking } {
	const config = demoConfigs.find((config) => config.id === id) ?? demoConfigs[0]
	setDemoEditable(config.editable)
	return { borders: config.layout, parking: config.parking }
}

/** Back-compat alias removed in favour of `demoLayoutFor('rw-combobox')`. */
export const initialIdeConfig: PaletteBorders = rwComboboxLayout
