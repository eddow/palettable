import { ConsoleStore, PaletteCore, validateSerializedLayout } from '@palettable/core'
import { applyThemeSetting, createIDE, createValueProxy } from '@palettable/vanilla'
import '../../core/styles/palette.css'
import '../../core/styles/head-default.css'
import '../../core/styles/head-dark.css'
import '../../core/styles/head-light.css'
import {
	bindConsoleToggle,
	bindDemoLens,
	bindResetViaCore,
	COLONY_VALUE_KEYS,
	CONSUMER_DEFAULTS,
	type DemoMode,
	type DemoState,
	demoKeys,
	demoLayoutFor,
	demoPoints,
	demoState,
	resetColonyValues,
} from './palette.js'

const LAYOUT_STORAGE_KEY = 'palettable-demo-layout-v1'

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
	lastAction.textContent = `Last action: ${demo.lastAction}`
}

let editable = true
const consoleStore = new ConsoleStore()

const initial = demoLayoutFor('rw-combobox')
// Single source: core starts empty (skeleton), then the consumer hydrates
// via live `setMany` (never `initialValues` — that path stays the one-shot
// SSR/hydration constructor fill). `demoState` is only the backing object;
// all reads/writes go through the `demo` proxy below.
const core = new PaletteCore(demoPoints(), {
	keys: demoKeys,
	// Preset layouts are live `Borders` (tracks preserved): pass them
	// directly — never via `.flat()`/serialized, which drops track
	// boundaries (each slot would reload as its own single-slot track).
	// `demoLayoutFor` returns a fresh clone and the tree clones again,
	// so no extra copy is needed here.
	initialLayout: { borders: initial.borders, parking: initial.parking },
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

bindConsoleToggle(() => {
	if (consoleStore.snapshot.open) consoleStore.close()
	else {
		const hasCommandBox = hasCommandBoxTool()
		consoleStore.open(!editable || hasCommandBox ? 'edit' : 'run')
	}
})

function renderChrome(): void {
	renderLastAction()
	renderPills()
	applyTheme()
}

// Single render path: every HTML update flows from the proxy `onChange`
// event, never from a setter directly. Bag keys (colony values) render via
// bag-notify; local keys (`lastAction`, `missionElapsed`) render via the
// same `onChange` callback. No second `core.values.subscribe` render pass.
const bagKeys = new Set<string>(COLONY_VALUE_KEYS as readonly string[])
const valueLens = createValueProxy<DemoState>(
	core.values as never,
	demoState,
	() => renderChrome(),
	{
		isBagKey: (key) => bagKeys.has(key),
	}
)
bindDemoLens(valueLens.proxy)
const demo = valueLens.proxy
// Hydrate BEFORE createIDE: the IDE renders tool DOM once at construction
// (then subscribes per-tool for updates), so values must be present first.
core.setMany({ ...CONSUMER_DEFAULTS })
bindResetViaCore(() => {
	core.setMany(resetColonyValues())
	demo.lastAction = 'Colony reset to defaults'
})

const ide = createIDE(ideHost, {
	core,
	consoleStore,
	isEditable: () => editable,
	itemEditors: ['commandBox', 'drawer', 'status', 'theme'],
	paletteId: 'demo',
})

// Per-tool DOM updates are owned by the IDE's own bindings; chrome
// (pills/grid/theme/last-action) renders only via the proxy `onChange`.
consoleStore.subscribe(() => renderLastAction())

function renderPills(): void {
	strip.textContent = ''
	const pills: Array<[string, string]> = [
		['💨', demo.autoOxygen ? 'O₂ on' : 'O₂ off'],
		['🛡️', demo.shieldGenerator ? 'Shields up' : 'Shields down'],
		['⚡', demo.fastMode ? 'Hyper-tick' : 'Normal tick'],
		['⚠️', demo.alertLevel],
		['🪐', demo.colonyTheme],
		['🔌', demo.powerPriority],
		['⏱️', `×${demo.gameSpeed}`],
		['🪙', `${demo.taxRate}%`],
		['☀️', `×${demo.solarEfficiency}`],
		['⭐', `${demo.satisfaction}/5`],
	]
	for (const [icon, text] of pills) {
		const pill = document.createElement('span')
		pill.className = 'demo-pill'
		pill.textContent = `${icon} ${text}`
		strip.append(pill)
	}
	grid.textContent = ''
	const rows: Array<[string, string]> = [
		['Last action', demo.lastAction],
		['Threat', demo.alertLevel],
		['Power', demo.powerPriority],
		['Atmosphere', demo.colonyTheme],
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
	applyThemeSetting(document.documentElement, demo.theme)
}

// Per-tool DOM updates are owned by the IDE's own bindings; chrome
// (pills/grid/theme/last-action) renders only via the proxy `onChange`.
consoleStore.subscribe(() => renderLastAction())

function readStoredLayout(): import('@palettable/core').AnySerializedLayout | undefined {
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
		demo.lastAction = 'Layout saved'
	} catch {
		demo.lastAction = 'Layout save failed'
	}
}

function loadPreset(id: DemoMode): void {
	const layout = demoLayoutFor(id)
	editable = (['rw-combobox', 'rw-command-first'] as DemoMode[]).includes(id)
	// Live layout (tracks preserved) — same rule as the initial load above.
	// `demoLayoutFor` returns a fresh clone; the tree clones again.
	core.layout.setLayout({ borders: layout.borders, parking: layout.parking })
	restoredBadge.hidden = true
	const labels: Record<DemoMode, string> = {
		'rw-combobox': 'R/W + command box',
		'rw-command-first': 'R/W command-first',
		'ro-combobox': 'R-O + command box',
	}
	demo.lastAction = `Loaded "${labels[id]}"`
	ide.refresh()
}

function loadStoredLayout(): void {
	const stored = readStoredLayout()
	if (!stored) {
		demo.lastAction = 'No saved layout'
		return
	}
	core.layout.setLayout(stored)
	restoredBadge.hidden = false
	demo.lastAction = 'Layout loaded'
	ide.refresh()
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
	demo.missionElapsed = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
	chip.textContent = `⏱ ${demo.missionElapsed}`
}, 1000)

// Demo always boots on "R/W + command box" (`initial` above): a stored
// layout never auto-applies (explicit Load only), so every configuration
// ships its right-most top toolbar — the `theme` tool — on first paint.
renderChrome()
