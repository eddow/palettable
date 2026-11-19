import { ConsoleStore, PaletteCore, ValuesBag, validateSerializedLayout } from '@palettable/core'
import {
	COLONY_VALUE_KEYS,
	CONSUMER_DEFAULTS,
	catalogStringsForLocale,
	createDemoState,
	DEMO_ICON_CHOICES,
	type DemoLens,
	type DemoLocale,
	type DemoMode,
	type DemoState,
	demoIconResolver,
	demoKeys,
	demoLayoutFor,
	demoPoints,
	isDemoLocale,
	LAYOUT_STORAGE_KEY,
	localeBundleForLocale,
	resetColonyValues,
	SHIP_ROSTER,
	SHIP_VALUES,
	type ShipId,
	shipById,
} from '@palettable/demo-core'
import type { VanillaLocaleBundle } from '@palettable/vanilla'
import { applyThemeSetting, createIDE, createValueProxy } from '@palettable/vanilla'
import { renderDemoIconField } from './icons.js'
import '../../core/styles/palette.css'
import '../../core/styles/head-default.css'
import '../../core/styles/head-dark.css'
import '../../core/styles/head-light.css'

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

/** Backing state object (passed to the lens below; bag = single source). */
const demoState: DemoState = createDemoState()

/** Live lens: actions read through it, writes go via core. */
let demoLens: DemoLens = { alertLevel: 'green', lastAction: 'Ready' }

const initial = demoLayoutFor('rw-combobox')
// Single source: core starts empty (skeleton), then the consumer hydrates
// via live `setMany` (never `initialValues` — that path stays the one-shot
// SSR/hydration constructor fill). `demoState` is only the backing object;
// all reads/writes go through the `demo` proxy below.
const core = new PaletteCore(
	demoPoints({
		getAlertLevel: () => String(demoLens.alertLevel),
		getColonyValues: () => demoLens as unknown as Record<string, unknown>,
		setLastAction: (message) => {
			demoLens.lastAction = message
		},
		resetColony: () => {
			core.setMany(resetColonyValues())
			demoLens.lastAction = 'Colony reset to defaults'
		},
		toggleConsole: () => {
			if (consoleStore.snapshot.open) consoleStore.close()
			else consoleStore.open(!editable || hasCommandBoxTool() ? 'edit' : 'run')
		},
		saveColony: (snapshot) => {
			try {
				localStorage.setItem('stellar-outpost-save', JSON.stringify({ ...snapshot }))
				return true
			} catch {
				return false
			}
		},
		getColonySnapshot: () => ({ ...demoLens }),
	}),
	{
		keys: demoKeys,
		// Preset layouts are live `Borders` (tracks preserved): pass them
		// directly — never via `.flat()`/serialized, which drops track
		// boundaries (each slot would reload as its own single-slot track).
		// `demoLayoutFor` returns a fresh clone and the tree clones again,
		// so no extra copy is needed here.
		initialLayout: { borders: initial.borders, parking: initial.parking },
		strings: catalogStringsForLocale('en') ?? {},
	}
)

function hasCommandBoxTool(): boolean {
	const layout = core.layout.getLayout()
	for (const region of ['top', 'right', 'bottom', 'left'] as const) {
		for (const track of layout.borders[region]) {
			for (const slot of track) {
				if (slot.toolbar.some((item) => (item as { control?: unknown }).control === 'commandBox')) {
					return true
				}
			}
		}
	}
	return false
}

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
const demo = valueLens.proxy
demoLens = valueLens.proxy
// `locale` seed happens below (after `applyLocale` is defined) via
// `applyLocaleSeed()` — hydration order matters (before `createIDE`).

// Host-owned context bag for the `missionTime` nothing-point status
// (`uses: ['mission']`). Single key — the presenter reads the first string
// value. Registered before `createIDE` so the status renders live on first
// paint instead of disabled + placeholder.
const missionBag = new ValuesBag({ elapsed: '00:00' })
core.setContext('mission', missionBag)

// Host-owned `ship` context bag for the fleet demo (one-or-none selected).
// Flat keys (`shipId` + per-ship props) so `liveValue` /
// `changed.includes(point.id)` work with zero adapter changes. Starts
// absent (no selection): ship tools render the core-contract fallback
// (disabled + placeholder / skeleton) until the chrome selector picks one.
// Ship point ids never enter the root bag / `CONSUMER_DEFAULTS` — there is
// no colony-wide equivalent.
const shipBag = new ValuesBag<Record<string, unknown>>()
core.setContext('ship', shipBag)

// Fleet selection state: one-or-none selected. Per-ship props live in
// `shipState` (mutable copy of `SHIP_VALUES`); selection swaps a flat
// `ship` bag (`shipId` + props) so `liveValue` /
// `changed.includes(point.id)` work with zero adapter changes. Ship point
// ids never enter the root bag / `CONSUMER_DEFAULTS` — there is no
// colony-wide equivalent. No selection = cleared keys → tools fall back
// to the core-contract skeleton (disabled + placeholder / `?` / mixed).
let selectedShipId: ShipId | undefined
const shipState: Record<ShipId, { shipShields: boolean; shipPower: number }> = {
	aurora: { ...SHIP_VALUES.aurora },
	borealis: { ...SHIP_VALUES.borealis },
	cinder: { ...SHIP_VALUES.cinder },
}

function selectShip(id: string | undefined): void {
	const entry = id !== undefined ? shipById(id) : undefined
	if (entry === undefined) {
		selectedShipId = undefined
		// Bag stays registered — key change, per-tool in-place update;
		// tools fall back to root skeleton.
		shipBag.setTree({
			shipId: undefined,
			shipName: undefined,
			shipShields: undefined,
			shipPower: undefined,
		})
		demo.lastAction = 'No ship selected'
		renderFleet()
		return
	}
	selectedShipId = entry.id as ShipId
	const props = shipState[selectedShipId]
	shipBag.setTree({
		shipId: entry.id,
		shipName: `${entry.icon} ${entry.name}`,
		shipShields: props.shipShields,
		shipPower: props.shipPower,
	})
	demo.lastAction = `${entry.name} selected`
	renderFleet()
}

// Fleet panels in the game center (work-zone): one card per ship showing
// its icon + name + live prop values. Click toggles selection (click the
// selected card again to deselect). Re-rendered on selection + on ship-bag
// writes (toolbar edits flow back into the cards).
function renderFleet(): void {
	const fleet = document.querySelector('[data-testid="fleet"]')
	if (!(fleet instanceof HTMLElement)) return
	fleet.textContent = ''
	for (const ship of SHIP_ROSTER) {
		const props = shipState[ship.id as ShipId]
		const card = document.createElement('button')
		card.type = 'button'
		card.className = 'demo-ship-card'
		card.dataset.testid = `ship-card-${ship.id}`
		card.setAttribute('aria-pressed', selectedShipId === ship.id ? 'true' : 'false')
		if (selectedShipId === ship.id) card.classList.add('is-selected')
		const name = document.createElement('span')
		name.className = 'demo-ship-name'
		name.textContent = `${ship.icon} ${ship.name}`
		const values = document.createElement('span')
		values.className = 'demo-ship-props'
		values.textContent = `🛡️ ${props.shipShields ? 'up' : 'down'} · 🔋 ×${props.shipPower}`
		card.append(name, values)
		card.addEventListener('click', () => {
			selectShip(selectedShipId === ship.id ? undefined : ship.id)
		})
		fleet.append(card)
	}
}

// Toolbar edits write into the `ship` bag (context-routed `writeValue`);
// mirror them back into `shipState` + the cards so the fleet stays live.
shipBag.subscribe((changed) => {
	if (selectedShipId === undefined) return
	const state = shipState[selectedShipId]
	let touched = false
	if (changed.includes('shipShields')) {
		const next = shipBag.get('shipShields')
		if (typeof next === 'boolean' && next !== state.shipShields) {
			state.shipShields = next
			touched = true
		}
	}
	if (changed.includes('shipPower')) {
		const next = shipBag.get('shipPower')
		if (typeof next === 'number' && next !== state.shipPower) {
			state.shipPower = next
			touched = true
		}
	}
	if (touched) renderFleet()
})
renderFleet()

// Demo locale: system value like `theme` — never enters the colony bag,
// stays out of defaults/dirty/reset. Seeded before `createIDE` so the
// first paint already uses the right tables; `document.lang` follows.
// (The live locale lives in `core.values`; no local mirror needed.)
function applyLocale(locale: DemoLocale): void {
	document.documentElement.lang = locale
	// Catalog strings follow via the IDE (`stringsForLocale` bundle →
	// `syncCatalogStrings`); keep the direct call as the pre-IDE seed so
	// the first paint already uses the right table.
	core.setStrings(catalogStringsForLocale(locale))
}

/** Seed `locale` before `createIDE` (hydration order matters — see above). */
function applyLocaleSeed(): void {
	applyLocale('en')
	core.setMany({ ...CONSUMER_DEFAULTS, locale: 'en' })
	core.values.subscribe('locale', (value) => {
		if (!isDemoLocale(value)) return
		applyLocale(value)
	})
}

// Hydrate BEFORE createIDE: the IDE renders tool DOM once at construction
// (then subscribes per-tool for updates), so values must be present first.
// `locale` is a valued enum point (system value like `theme` is nothing —
// but locale needs a store value for the segmented control), seeded here
// and excluded from CONSUMER_DEFAULTS/dirty/reset by convention.
applyLocaleSeed()

const ide = createIDE(ideHost, {
	core,
	consoleStore,
	isEditable: () => editable,
	theme: true,
	itemControls: ['commandBox', 'drawer', 'status', 'theme'],
	paletteId: 'demo',
	iconResolver: demoIconResolver,
	iconChoices: DEMO_ICON_CHOICES,
	renderIconField: renderDemoIconField,
	localePointId: 'locale',
	stringsForLocale: (locale) =>
		isDemoLocale(locale)
			? (localeBundleForLocale(locale) as VanillaLocaleBundle | undefined)
			: undefined,
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
	// Theme is a nothing-point system value: the document root is the source
	// of truth. Seed `system` on first load so the toggle has a defined start.
	if (document.documentElement.dataset.theme === undefined) {
		applyThemeSetting(document.documentElement, 'system')
		return
	}
	applyThemeSetting(
		document.documentElement,
		document.documentElement.dataset.theme as 'light' | 'dark' | 'system'
	)
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
	const formatted = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
	demo.missionElapsed = formatted
	chip.textContent = `⏱ ${demo.missionElapsed}`
	missionBag.set('elapsed', formatted)
}, 1000)

// A stored layout auto-applies on boot (validated): reload restores the
// saved arrangement and shows the "restored" badge; explicit Load
// re-applies it after a preset switch. Every configuration still boots
// deterministically when nothing is stored.
const stored = readStoredLayout()
if (stored !== undefined) {
	try {
		core.layout.setLayout(stored)
		restoredBadge.hidden = false
		ide.refresh()
	} catch {
		restoredBadge.hidden = true
	}
}
renderChrome()
