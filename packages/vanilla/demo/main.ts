import { ConsoleStore, PaletteCore, validateSerializedLayout } from '@palettable/core'
import { createIDE } from '@palettable/vanilla'
import '../../core/styles/palette.css'
import '../../core/theme/head-default.css'
import {
	bindConsoleToggle,
	type DemoMode,
	type DemoState,
	demoKeys,
	demoLayoutFor,
	demoPoints,
	demoState,
	resetColony,
} from './palette.js'

const LAYOUT_STORAGE_KEY = 'palettable-demo-layout-v1'

void resetColony

function qs<T extends HTMLElement>(selector: string): T {
	const el = document.querySelector(selector)
	if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`)
	return el as T
}

const saveButton = qs<HTMLButtonElement>('[data-testid="save-layout"]')
const loadButton = qs<HTMLButtonElement>('[data-testid="load-layout"]')
const restoredBadge = qs<HTMLElement>('[data-testid="layout-restored"]')
const lastAction = qs<HTMLElement>('[data-testid="last-action"]')
const ideHost = qs<HTMLElement>('#ide-host')
const strip = qs<HTMLElement>('.demo-strip')
const grid = qs<HTMLElement>('.demo-state-grid')
const chip = qs<HTMLElement>('[data-testid="elapsed"]')

function renderLastAction(): void {
	lastAction.textContent = `Last action: ${demoState.lastAction}`
}

let editable = true
const consoleStore = new ConsoleStore()
bindConsoleToggle(() => {
	if (consoleStore.snapshot.open) consoleStore.close()
	else {
		const hasCommandBox = hasCommandBoxTool()
		consoleStore.open(!editable || hasCommandBox ? 'edit' : 'run')
	}
})

const initial = demoLayoutFor('rw-combobox')
const core = new PaletteCore(demoPoints(), {
	keys: demoKeys,
	initialLayout: {
		version: 1,
		borders: {
			top: initial.borders.top.flat(),
			right: initial.borders.right.flat(),
			bottom: initial.borders.bottom.flat(),
			left: initial.borders.left.flat(),
		},
		parking: initial.parking,
	},
	initialValues: {
		autoOxygen: demoState.autoOxygen,
		shieldGenerator: demoState.shieldGenerator,
		fastMode: demoState.fastMode,
		colonyTheme: demoState.colonyTheme,
		alertLevel: demoState.alertLevel,
		powerPriority: demoState.powerPriority,
		theme: demoState.theme,
		gameSpeed: demoState.gameSpeed,
		taxRate: demoState.taxRate,
		solarEfficiency: demoState.solarEfficiency,
		satisfaction: demoState.satisfaction,
	},
})

function hasCommandBoxTool(): boolean {
	const layout = core.layout.getLayout()
	for (const region of ['top', 'right', 'bottom', 'left'] as const) {
		for (const track of layout.borders[region]) {
			for (const slot of track) {
				if (slot.toolbar.some((item) => (item as { editor?: unknown }).editor === 'commandBox')) {
					return true
				}
			}
		}
	}
	return false
}

function syncDemoState(): void {
	demoState.autoOxygen = (core.values.get('autoOxygen') as boolean | undefined) ?? true
	demoState.shieldGenerator = (core.values.get('shieldGenerator') as boolean | undefined) ?? false
	demoState.fastMode = (core.values.get('fastMode') as boolean | undefined) ?? false
	demoState.colonyTheme =
		(core.values.get('colonyTheme') as DemoState['colonyTheme'] | undefined) ?? 'mars'
	demoState.alertLevel =
		(core.values.get('alertLevel') as DemoState['alertLevel'] | undefined) ?? 'green'
	demoState.powerPriority =
		(core.values.get('powerPriority') as DemoState['powerPriority'] | undefined) ?? 'balanced'
	demoState.theme = (core.values.get('theme') as DemoState['theme'] | undefined) ?? 'system'
	demoState.gameSpeed = (core.values.get('gameSpeed') as number | undefined) ?? 1
	demoState.taxRate = (core.values.get('taxRate') as number | undefined) ?? 15
	demoState.solarEfficiency = (core.values.get('solarEfficiency') as number | undefined) ?? 1.2
	demoState.satisfaction = (core.values.get('satisfaction') as number | undefined) ?? 3
	renderLastAction()
	renderPills()
	applyTheme()
}

function renderPills(): void {
	strip.textContent = ''
	const pills: Array<[string, string]> = [
		['💨', demoState.autoOxygen ? 'O₂ on' : 'O₂ off'],
		['🛡️', demoState.shieldGenerator ? 'Shields up' : 'Shields down'],
		['⚡', demoState.fastMode ? 'Hyper-tick' : 'Normal tick'],
		['⚠️', demoState.alertLevel],
		['🪐', demoState.colonyTheme],
		['🔌', demoState.powerPriority],
		['⏱️', `×${demoState.gameSpeed}`],
		['🪙', `${demoState.taxRate}%`],
		['☀️', `×${demoState.solarEfficiency}`],
		['⭐', `${demoState.satisfaction}/5`],
	]
	for (const [icon, text] of pills) {
		const pill = document.createElement('span')
		pill.className = 'demo-pill'
		pill.textContent = `${icon} ${text}`
		strip.append(pill)
	}
	grid.textContent = ''
	const rows: Array<[string, string]> = [
		['Last action', demoState.lastAction],
		['Threat', demoState.alertLevel],
		['Power', demoState.powerPriority],
		['Atmosphere', demoState.colonyTheme],
	]
	for (const [key, value] of rows) {
		const row = document.createElement('div')
		row.className = 'demo-state-row'
		const keyEl = document.createElement('span')
		keyEl.className = 'demo-state-key'
		keyEl.textContent = key
		const valueEl = document.createElement('span')
		valueEl.className = 'demo-state-value'
		valueEl.textContent = value
		row.append(keyEl, valueEl)
		grid.append(row)
	}
}

function applyTheme(): void {
	const setting = demoState.theme
	const prefersLight =
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-color-scheme: light)').matches
	const resolved = setting === 'system' ? (prefersLight ? 'light' : 'dark') : setting
	document.documentElement.classList.toggle('palette-default-theme-light', resolved === 'light')
	document.documentElement.dataset.theme = resolved
	document.documentElement.style.colorScheme = resolved
}

const ide = createIDE(ideHost, {
	core,
	consoleStore,
	isEditable: () => editable,
	itemEditors: ['commandBox', 'drawer', 'status'],
	paletteId: 'demo',
	// Drag-end save hook: a mid-drag session mutated layout — persist one
	// snapshot (the single "it changed, save it" call vanilla owns).
	onLayoutChange: () => persistLayout(),
})

core.values.subscribe(() => syncDemoState())
consoleStore.subscribe(() => renderLastAction())

function readStoredLayout(): import('@palettable/core').SerializedLayout | undefined {
	try {
		const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
		if (!raw) return undefined
		const parsed: unknown = JSON.parse(raw)
		if (!validateSerializedLayout(parsed)) return undefined
		return parsed
	} catch {
		return undefined
	}
}

function persistLayout(): void {
	try {
		localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(core.layout.getSnapshot()))
		demoState.lastAction = 'Layout saved'
	} catch {
		demoState.lastAction = 'Layout save failed'
	}
	syncDemoState()
}

function loadPreset(id: DemoMode): void {
	const layout = demoLayoutFor(id)
	editable = (['rw-combobox', 'rw-command-first'] as DemoMode[]).includes(id)
	core.layout.setLayout({
		version: 1,
		borders: {
			top: layout.borders.top.flat(),
			right: layout.borders.right.flat(),
			bottom: layout.borders.bottom.flat(),
			left: layout.borders.left.flat(),
		},
		parking: layout.parking,
	})
	restoredBadge.hidden = true
	const labels: Record<DemoMode, string> = {
		'rw-combobox': 'R/W + command box',
		'rw-command-first': 'R/W command-first',
		'ro-combobox': 'R-O + command box',
	}
	demoState.lastAction = `Loaded "${labels[id]}"`
	ide.refresh()
	syncDemoState()
}

function loadStoredLayout(): void {
	const stored = readStoredLayout()
	if (!stored) {
		demoState.lastAction = 'No saved layout'
		syncDemoState()
		return
	}
	core.layout.setLayout(stored)
	restoredBadge.hidden = false
	demoState.lastAction = 'Layout loaded'
	ide.refresh()
	syncDemoState()
}

saveButton.addEventListener('click', persistLayout)
loadButton.addEventListener('click', loadStoredLayout)

for (const button of document.querySelectorAll<HTMLButtonElement>(
	'.demo-modes button[data-testid]'
)) {
	const testid = button.dataset.testid ?? ''
	const id = testid.replace(/^mode-/, '') as DemoMode
	button.addEventListener('click', () => loadPreset(id))
}

const started = Date.now()
window.setInterval(() => {
	const elapsed = Math.floor((Date.now() - started) / 1000)
	demoState.missionElapsed = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
	chip.textContent = `⏱ ${demoState.missionElapsed}`
}, 1000)

const stored = readStoredLayout()
if (stored) {
	core.layout.setLayout(stored)
	restoredBadge.hidden = false
	ide.refresh()
}

syncDemoState()
renderLastAction()
