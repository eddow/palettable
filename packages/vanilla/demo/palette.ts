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

import type { AnyPoint, Border, Borders, KeyBindings, Parking } from '@palettable/core'

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
 * `theme` is a nothing-point system value (document root class) — it never
 * enters the bag, so it stays out of defaults/dirty/reset.
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

/**
 * Fixed ship roster for the context demo: one-or-none selected via the
 * chrome `<select>` in `main.ts`. Selection swaps a flat `ship` ValuesBag
 * (`shipId` + per-ship props); None removes the bag. Ship point ids never
 * enter the root bag / `CONSUMER_DEFAULTS` — no-selection renders the
 * core-contract fallback (disabled + placeholder / skeleton).
 */
export const SHIP_ROSTER = [
	{ id: 'aurora', name: 'Aurora', icon: '🚀' },
	{ id: 'borealis', name: 'Borealis', icon: '🛸' },
	{ id: 'cinder', name: 'Cinder', icon: '🛰️' },
] as const

export type ShipId = (typeof SHIP_ROSTER)[number]['id']

/** Per-ship property values, keyed by ship id (flat keys land in the `ship` bag). */
export const SHIP_VALUES: Record<ShipId, { shipShields: boolean; shipPower: number }> = {
	aurora: { shipShields: true, shipPower: 3 },
	borealis: { shipShields: false, shipPower: 1.5 },
	cinder: { shipShields: true, shipPower: 4.5 },
}

export function shipById(id: string | undefined): (typeof SHIP_ROSTER)[number] | undefined {
	return SHIP_ROSTER.find((ship) => ship.id === id)
}

export function demoPoints(): AnyPoint[] {
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
			keywords: ['console', 'terminal', 'command', 'cli', 'shell'],
			can: () => true,
			run() {
				consoleToggle?.()
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
				demoLens.lastAction =
					entry !== undefined
						? `${entry.name} fired a torpedo!`
						: 'No ship selected — torpedo held.'
			},
		},
	]
}

export const demoKeys: KeyBindings = {
	'`': { kind: 'action', point: 'console' },
	N: { kind: 'toggle', point: 'autoOxygen' },
	S: { kind: 'toggle', point: 'shieldGenerator' },
	E: { kind: 'action', point: 'emergencyProtocol' },
	'Ctrl+S': { kind: 'action', point: 'saveGame' },
	'+': { kind: 'inc', point: 'gameSpeed', delta: 0.5 },
	'-': { kind: 'dec', point: 'gameSpeed', delta: 0.5 },
	'1': { kind: 'set', point: 'alertLevel', value: 'green' },
	'2': { kind: 'set', point: 'alertLevel', value: 'yellow' },
	'3': { kind: 'set', point: 'alertLevel', value: 'red' },
}

const rwComboboxLayout: Borders = {
	top: [
		[
			{
				space: 0.1,
				toolbar: [
					{
						point: 'commandBox',
						control: 'commandBox',
						config: { icon: '⌘', label: 'Command', hint: 'Search and run a command' },
					},
					{
						point: 'emergencyProtocol',
						control: 'button',
						config: { icon: '🚨', label: 'Lockdown', hint: 'Head button (run)', tone: 'accent' },
					},
					{
						point: 'autoOxygen',
						control: 'toggle',
						config: { icon: '💨', label: 'Life support', hint: 'Compact icon toggle' },
					},
					{
						point: 'shieldGenerator',
						control: 'toggle',
						config: { icon: '🛡️', label: 'Shields', hint: 'Compact icon toggle' },
					},
					{
						point: 'alertLevel',
						control: 'segmented',
						config: { icon: '⚠️', label: 'Threat', hint: 'Head segmented (enum)' },
					},
				],
			},
			{
				space: 0.9,
				toolbar: [
					{
						point: 'theme',
						control: 'theme',
						config: { icon: '🎨', label: 'Theme', hint: 'Theme cycle (nothing-point)' },
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
						point: 'gameSpeed',
						control: 'slider',
						config: {
							icon: '⏱️',
							label: 'Sim speed',
							hint: 'Demo slider override',
						},
					},
					{
						point: 'colonyTheme',
						control: 'select',
						config: {
							icon: '🪐',
							label: 'Atmosphere',
							hint: 'Head select (enum)',
							showFilter: true,
						},
					},
					{
						point: 'powerPriority',
						control: 'segmented',
						config: {
							icon: '🔌',
							label: 'Power focus',
							hint: 'Head segmented (enum)',
							showText: false,
						},
					},
					{
						point: 'moreDrawer',
						control: 'drawer',
						config: {
							icon: '🗂',
							label: 'More',
							hint: 'Outer drawer (toggle, closes on command)',
							closeOnClick: true,
						},
						toolbar: [
							{
								space: 1,
								toolbar: [
									{
										point: 'colonyTheme',
										control: 'select',
										config: {
											icon: '🪐',
											label: 'Atmosphere',
											hint: 'Nested drawer select',
											showFilter: true,
										},
									},
									{
										point: 'gameSpeed',
										control: 'stepper',
										config: { icon: '⏱️', label: 'Sim speed', hint: 'Nested drawer stepper' },
									},
								],
							},
							{
								space: 1,
								toolbar: [
									{
										point: 'moreDrawer',
										control: 'drawer',
										config: {
											icon: '🗂',
											label: 'More',
											hint: 'Nested drawer (axis inversion)',
											open: 'hover',
											closeOnClick: true,
										},
										toolbar: [
											{
												space: 1,
												toolbar: [
													{
														point: 'saveGame',
														control: 'button',
														config: {
															icon: '💾',
															label: 'Save',
															hint: 'Nested command (closes drawers)',
														},
													},
												],
											},
										],
									},
								],
							},
						],
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
						point: 'commandBox',
						control: 'commandBox',
						config: {
							icon: '⌘',
							label: 'Command',
							hint: 'Vertical command box (icon-only, drawer overlay)',
						},
					},
					{
						point: 'taxRate',
						control: 'slider',
						config: {
							icon: '🪙',
							label: 'Tax rate',
							hint: 'Demo slider override',
						},
					},
					{
						point: 'solarEfficiency',
						control: 'stepper',
						config: { icon: '☀️', label: 'Solar', hint: 'Head stepper (number)' },
					},
					{
						point: 'gameSpeed',
						control: 'drawerSlider',
						config: { icon: '⏩', label: 'Sim speed drawer', hint: 'Drawer slider (vertical)' },
					},
					{
						point: 'satisfaction',
						control: 'stars',
						config: { icon: '⭐', label: 'Morale', hint: 'Demo stars rating' },
					},
					{
						point: 'missionTime',
						control: 'status',
						config: {
							icon: '⏱️',
							label: 'Mission time',
							hint: 'Vertical time status (nothing-point)',
						},
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
						point: 'console',
						control: 'button',
						config: { icon: '💻', label: 'Terminal', hint: 'Head button (run)' },
					},
					{
						point: 'saveGame',
						control: 'button',
						config: { icon: '💾', label: 'Save', hint: 'Head button (run)' },
					},
					{
						point: 'resetSimulation',
						control: 'button',
						config: { icon: '🔄', label: 'Reset', hint: 'Head button (run)', tone: 'accent' },
					},
					{
						point: 'fastMode',
						control: 'toggle',
						config: { icon: '⚡', label: 'Hyper-tick', hint: 'Compact icon toggle' },
					},
					{
						point: 'missionTime',
						control: 'status',
						config: { icon: '⏱️', label: 'Mission time', hint: 'Status readout (nothing-point)' },
					},
					{
						point: 'taxRate',
						control: 'drawerSlider',
						config: { icon: '📉', label: 'Tax drawer', hint: 'Drawer slider (horizontal)' },
					},
					{
						point: 'shipStatus',
						control: 'status',
						config: {
							icon: '🚀',
							label: 'Selected ship',
							hint: 'Ship selection status (contextual)',
							statusKey: 'shipName',
						},
					},
					{
						point: 'shipShields',
						control: 'toggle',
						config: {
							icon: '🛡️',
							label: 'Ship shields',
							hint: 'Contextual toggle (selected ship)',
						},
					},
					{
						point: 'shipPower',
						control: 'slider',
						config: {
							icon: '🔋',
							label: 'Ship reactor',
							hint: 'Contextual slider (selected ship)',
						},
					},
					{
						point: 'fireTorpedo',
						control: 'button',
						config: {
							icon: '💥',
							label: 'Fire',
							hint: 'Gated action (needs a selected ship)',
							tone: 'accent',
						},
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
				(item) => (item as { control?: unknown }).control !== 'commandBox'
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
