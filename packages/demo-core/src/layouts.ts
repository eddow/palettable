/**
 * Shared toolbar layouts + demo configurations for the Stellar Outpost demo.
 *
 * The same three configurations (`rw-combobox` / `rw-command-first` /
 * `ro-combobox`) and the same toolbar layouts in the canonical core
 * `Borders`/`Parking` item shape (`{point, control}`). Preset layouts are
 * live data (tracks preserved): consumers pass them directly to the core —
 * never via `.flat()`/serialized, which drops track boundaries.
 */
import type { Border, Borders, Parking } from '@palettable/core'
import type { DemoMode } from './state.js'

export type DemoConfig = {
	readonly id: DemoMode
	readonly label: string
	readonly description: string
	readonly editable: boolean
	readonly layout: Borders
	readonly parking: Parking
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
						point: 'locale',
						control: 'segmented',
						config: { icon: '🌐', label: 'Language', hint: 'Demo language flag (enum)' },
					},
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
						point: 'saveGame',
						control: 'button',
						config: {
							icon: '💾',
							label: 'Save',
							hint: 'Head button (run)',
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
