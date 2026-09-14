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

const app = document.querySelector('#app')
if (!(app instanceof HTMLElement)) throw new Error('missing #app')

const main = document.createElement('main')
app.append(main)

const demoBar = document.createElement('div')
demoBar.className = 'demo-bar'
main.append(demoBar)

const heading = document.createElement('h1')
heading.textContent = 'Stellar Outpost — palette demo'
demoBar.append(heading)

const modes = document.createElement('div')
modes.className = 'demo-modes'
demoBar.append(modes)

const io = document.createElement('div')
io.className = 'demo-io'
io.setAttribute('role', 'group')
io.setAttribute('aria-label', 'Layout persistence')
demoBar.append(io)

const saveButton = document.createElement('button')
saveButton.type = 'button'
saveButton.dataset.testid = 'save-layout'
saveButton.textContent = 'Save layout'
io.append(saveButton)

const loadButton = document.createElement('button')
loadButton.type = 'button'
loadButton.dataset.testid = 'load-layout'
loadButton.textContent = 'Load layout'
io.append(loadButton)

const restoredBadge = document.createElement('span')
restoredBadge.className = 'demo-state'
restoredBadge.dataset.testid = 'layout-restored'
restoredBadge.textContent = 'Layout restored from localStorage'
restoredBadge.hidden = true
demoBar.append(restoredBadge)

const lastAction = document.createElement('span')
lastAction.className = 'demo-state'
lastAction.dataset.testid = 'last-action'
demoBar.append(lastAction)

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

const ideHost = document.createElement('div')
main.append(ideHost)

const workZone = document.createElement('div')
workZone.className = 'demo-center'
workZone.dataset.testid = 'work-zone'
ideHost.append(workZone)

const hero = document.createElement('div')
hero.className = 'demo-hero'
workZone.append(hero)
const heroText = document.createElement('div')
const heroStrong = document.createElement('strong')
heroStrong.textContent = 'Stellar Outpost'
const heroSpan = document.createElement('span')
heroSpan.textContent =
	'Space colony management sim — every colony variable below is bound to a toolbar editor.'
heroText.append(heroStrong, heroSpan)
hero.append(heroText)
const chip = document.createElement('div')
chip.className = 'demo-chip'
chip.dataset.testid = 'elapsed'
chip.textContent = '⏱ 00:00'
hero.append(chip)

const strip = document.createElement('div')
strip.className = 'demo-strip'
workZone.append(strip)

const panel = document.createElement('div')
panel.className = 'demo-panel'
workZone.append(panel)
const panelTitle = document.createElement('div')
panelTitle.className = 'demo-panel-title'
panelTitle.textContent = 'Colony status'
panel.append(panelTitle)
const grid = document.createElement('div')
grid.className = 'demo-state-grid'
panel.append(grid)

const hint = document.createElement('p')
hint.textContent = 'Open the console, then click a toolbar item to configure its presentation.'
workZone.append(hint)

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

for (const config of [
	{
		id: 'rw-combobox',
		label: 'R/W + command box',
		description:
			'Read-write; the toolbar hosts a command-box combobox (console opens in edit mode).',
	},
	{
		id: 'rw-command-first',
		label: 'R/W command-first',
		description:
			'Read-write; no combobox — the console opens command-first with a square edit-icon button.',
	},
	{
		id: 'ro-combobox',
		label: 'R-O + command box',
		description: 'Read-only; the combobox runs commands inline, but the layout is not editable.',
	},
] as const) {
	const button = document.createElement('button')
	button.type = 'button'
	button.dataset.testid = `mode-${config.id}`
	button.title = config.description
	button.textContent = config.label
	button.addEventListener('click', () => loadPreset(config.id))
	modes.append(button)
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

const style = document.createElement('style')
style.textContent = `
main { display: flex; flex-direction: column; gap: 0.75rem; min-height: 100vh; block-size: 100dvh; font-family: system-ui, sans-serif; background: #020617; color: #e2e8f0; }
html[data-theme='light'] main { background: #f1f5f9; color: #0f172a; }
html, body { block-size: 100%; }
body { margin: 0; }
main > .palette-ide { flex: 1 1 auto; min-block-size: 0; }
.demo-bar { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1rem; flex-wrap: wrap; }
.demo-bar h1 { font-size: 1.1rem; margin: 0; }
.demo-modes { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.demo-modes button, .demo-io button { padding: 0.34rem 0.72rem; border: 1px solid rgba(71, 85, 105, 0.9); border-radius: 999px; background: rgba(15, 23, 42, 0.88); color: #e2e8f0; cursor: pointer; font-size: 0.82rem; }
.demo-io { display: inline-flex; align-items: center; }
.demo-center { position: relative; padding: 1rem; display: grid; gap: 1rem; align-content: start; }
.palette-ide-center { position: relative; }
.demo-center.is-dimmed { opacity: 0.45; filter: grayscale(0.4); pointer-events: none; user-select: none; }
.demo-hero, .demo-panel { display: grid; gap: 10px; padding: 14px; border: 1px solid rgba(51, 65, 85, 0.9); border-radius: 16px; background: rgba(15, 23, 42, 0.82); box-shadow: 0 16px 36px rgba(2, 6, 23, 0.28); color: #e2e8f0; }
.demo-hero { grid-template-columns: 1fr auto; align-items: center; }
.demo-chip { display: inline-flex; align-items: center; gap: 8px; padding: 0.42rem 0.8rem; border-radius: 999px; background: rgba(30, 41, 59, 0.96); border: 1px solid rgba(96, 165, 250, 0.24); color: #bfdbfe; }
.demo-strip { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; border: 1px dashed rgba(71, 85, 105, 0.9); border-radius: 14px; background: rgba(15, 23, 42, 0.56); }
.demo-pill { display: inline-flex; align-items: center; gap: 6px; padding: 0.34rem 0.7rem; border-radius: 999px; background: linear-gradient(180deg, #2563eb, #1d4ed8); color: #eff6ff; font-size: 0.78rem; font-weight: 600; }
.demo-panel-title { font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; }
.demo-state-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 8px; }
.demo-state-row { display: flex; align-items: center; gap: 8px; padding: 0.52rem 0.82rem; border: 1px solid rgba(71, 85, 105, 0.65); border-radius: 11px; background: rgba(15, 23, 42, 0.64); }
.demo-state-key { font-size: 0.74rem; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; }
.demo-state-value { font-weight: 600; }
`
document.head.append(style)
