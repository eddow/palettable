<template>
	<main>
		<div class="demo-bar">
			<h1>Stellar Outpost — palette demo</h1>
			<div class="demo-modes">
				<button type="button" data-testid="mode-rw-combobox" title="Read-write; the toolbar hosts a command-box combobox (console opens in edit mode)." @click="() => loadPreset('rw-combobox')">R/W + command box</button>
				<button type="button" data-testid="mode-rw-command-first" title="Read-write; no combobox — the console opens command-first with a square edit-icon button." @click="() => loadPreset('rw-command-first')">R/W command-first</button>
				<button type="button" data-testid="mode-ro-combobox" title="Read-only; the combobox runs commands inline, but the layout is not editable." @click="() => loadPreset('ro-combobox')">R-O + command box</button>
			</div>
			<div class="demo-io" role="group" aria-label="Layout persistence">
				<button type="button" data-testid="save-layout" @click="persistLayout">Save layout</button>
				<button type="button" data-testid="load-layout" @click="loadStoredLayout">Load layout</button>
			</div>
			<span class="demo-state" data-testid="layout-restored" :hidden="restoredHidden ? '' : undefined">Layout restored from localStorage</span>
			<span class="demo-state" data-testid="last-action">Last action: {{ demo.lastAction }}</span>
		</div>
		<div id="ide-host">
			<PaletteIde
				ref="ide"
				:core="core"
				:console-store="consoleStore"
				:is-editable="isEditable"
				:theme="true"
				:item-controls="['commandBox', 'drawer', 'status', 'theme']"
				palette-id="demo"
				:icon-resolver="demoIconResolver"
				:icon-choices="DEMO_ICON_CHOICES"
				locale-point-id="locale"
				:strings-for-locale="stringsForLocale"
			>
				<template #work-zone>
					<div class="demo-center" data-testid="work-zone" :class="{ 'is-dimmed': consoleOpen }">
						<div class="demo-hero">
							<div><strong>Stellar Outpost</strong><span>Space colony management sim — every colony variable below is bound to a toolbar editor.</span></div>
							<div class="demo-chip" data-testid="elapsed">⏱ {{ demo.missionElapsed }}</div>
						</div>
						<div class="demo-strip">
							<span v-for="pill in pills" :key="pill[1]" class="demo-pill">{{ pill[0] }} {{ pill[1] }}</span>
						</div>
						<div class="demo-panel">
							<div class="demo-panel-title">Colony status</div>
							<div class="demo-state-grid">
								<div v-for="row in stateRows" :key="row[0]" class="demo-state-row">
									<span class="demo-state-key">{{ row[0] }}</span>
									<span class="demo-state-value">{{ row[1] }}</span>
								</div>
							</div>
						</div>
						<div class="demo-panel">
							<div class="demo-panel-title">Fleet — select a ship</div>
							<div class="demo-fleet" data-testid="fleet">
								<button
									v-for="ship in SHIP_ROSTER"
									:key="ship.id"
									type="button"
									class="demo-ship-card"
									:class="{ 'is-selected': selectedShipId === ship.id }"
									:data-testid="`ship-card-${ship.id}`"
									:aria-pressed="selectedShipId === ship.id ? 'true' : 'false'"
									@click="() => toggleShip(ship.id)"
								>
									<span class="demo-ship-name">{{ ship.icon }} {{ ship.name }}</span>
									<span class="demo-ship-props">🛡️ {{ shipProps(ship.id).shipShields ? 'up' : 'down' }} · 🔋 ×{{ shipProps(ship.id).shipPower }}</span>
								</button>
							</div>
						</div>
						<p>Open the console, then click a toolbar item to configure its presentation.</p>
					</div>
				</template>
			</PaletteIde>
		</div>
	</main>
</template>

<script setup lang="ts">
/**
 * `@palettable/vue` demo — Stellar Outpost, ported feature-for-feature
 * from `packages/vanilla/demo/main.ts`.
 *
 * Same points, same initial layout, same controls, same console, same
 * drag behaviour, same DOM contract the e2e specs assert. Chrome
 * (pills/grid/fleet/modes/persistence/timer/locale) is Vue-idiom:
 * reactive lens over `core.values` + host-owned `mission`/`ship` bags.
 */
import {
	ConsoleStore,
	PaletteCore,
	ValuesBag,
	validateSerializedLayout,
	type AnySerializedLayout,
} from '@palettable/core'
import {
	COLONY_VALUE_KEYS,
	CONSUMER_DEFAULTS,
	catalogStringsForLocale,
	createDemoState,
	DEMO_ICON_CHOICES,
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
	shipById,
	type DemoLocale,
	type DemoMode,
	type DemoState,
	type ShipId,
} from '@palettable/demo-core'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import PaletteIde from '../src/layout/PaletteIde.vue'
import { applyThemeSetting } from '../src/theme.js'
import { useValueLens } from '../src/value-lens.js'
import type { VueLocaleBundle } from '../src/strings.js'
import '../../core/styles/palette.css'
import '../../core/styles/head-default.css'
import '../../core/styles/head-dark.css'
import '../../core/styles/head-light.css'

const editable = ref(true)
const consoleStore = new ConsoleStore()
const restoredHidden = ref(true)
const ideRef = useTemplateRef<{ dragActive?: { value: boolean } }>('ide')
const dragLive = computed(() => ideRef.value?.dragActive?.value === true)

const demoState: DemoState = createDemoState()
const bagKeys = new Set<string>(COLONY_VALUE_KEYS as readonly string[])

const initial = demoLayoutFor('rw-combobox')
const lensTarget: { state: DemoState } = { state: { ...demoState } }
const core = new PaletteCore(
	demoPoints({
		getAlertLevel: () => String(lensTarget.state.alertLevel),
		getColonyValues: () => lensTarget.state as unknown as Record<string, unknown>,
		setLastAction: (message) => {
			lensTarget.state.lastAction = message
		},
		resetColony: () => {
			core.setMany(resetColonyValues())
			lensTarget.state.lastAction = 'Colony reset to defaults'
		},
		toggleConsole: () => {
			if (consoleStore.snapshot.open) consoleStore.close()
			else consoleStore.open(!editable.value || hasCommandBoxTool() ? 'edit' : 'run')
		},
		saveColony: (snapshot) => {
			try {
				localStorage.setItem('stellar-outpost-save', JSON.stringify({ ...snapshot }))
				return true
			} catch {
				return false
			}
		},
		getColonySnapshot: () => ({ ...lensTarget.state }),
	}),
	{
		keys: demoKeys,
		initialLayout: { borders: initial.borders, parking: initial.parking },
		strings: catalogStringsForLocale('en') ?? {},
	}
)

// Live lens over the root store: bag keys render via bag-notify,
// UI-only keys (`lastAction`, `missionElapsed`) render locally.
const lens = useValueLens<DemoState>(core.values as never, {
	isBagKey: (key) => bagKeys.has(key),
	initial: { ...demoState },
})
lensTarget.state = lens.state as DemoState
const demo = computed(() => lens.state)

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

const missionBag = new ValuesBag({ elapsed: '00:00' })
core.setContext('mission', missionBag)

const shipBag = new ValuesBag<Record<string, unknown>>()
core.setContext('ship', shipBag)

const selectedShipId = ref<ShipId | undefined>(undefined)
const shipState: Record<ShipId, { shipShields: boolean; shipPower: number }> = {
	aurora: { ...SHIP_VALUES.aurora },
	borealis: { ...SHIP_VALUES.borealis },
	cinder: { ...SHIP_VALUES.cinder },
}

function selectShip(id: string | undefined): void {
	const entry = id !== undefined ? shipById(id) : undefined
	if (entry === undefined) {
		selectedShipId.value = undefined
		shipBag.setTree({
			shipId: undefined,
			shipName: undefined,
			shipShields: undefined,
			shipPower: undefined,
		})
		demo.value.lastAction = 'No ship selected'
		return
	}
	selectedShipId.value = entry.id as ShipId
	const props = shipState[selectedShipId.value]
	shipBag.setTree({
		shipId: entry.id,
		shipName: `${entry.icon} ${entry.name}`,
		shipShields: props.shipShields,
		shipPower: props.shipPower,
	})
	demo.value.lastAction = `${entry.name} selected`
}

function toggleShip(id: string): void {
	selectShip(selectedShipId.value === id ? undefined : id)
}

function shipProps(id: string): { shipShields: boolean; shipPower: number } {
	return shipState[id as ShipId] ?? { shipShields: false, shipPower: 0 }
}

shipBag.subscribe((changed) => {
	if (selectedShipId.value === undefined) return
	const state = shipState[selectedShipId.value]
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
	if (touched) bumpFleet.value += 1
})
const bumpFleet = ref(0)

function applyLocale(locale: DemoLocale): void {
	document.documentElement.lang = locale
	core.setStrings(catalogStringsForLocale(locale))
}

function applyLocaleSeed(): void {
	applyLocale('en')
	core.setMany({ ...CONSUMER_DEFAULTS, locale: 'en' })
	core.values.subscribe('locale', (value) => {
		if (!isDemoLocale(value)) return
		applyLocale(value)
	})
}
applyLocaleSeed()

function stringsForLocale(locale: string | undefined): VueLocaleBundle | undefined {
	if (!isDemoLocale(locale)) return undefined
	return localeBundleForLocale(locale) as VueLocaleBundle | undefined
}

function isEditable(): boolean {
	return editable.value
}

const consoleOpen = ref(false)
const unsubConsole = consoleStore.subscribe(() => {
	consoleOpen.value = consoleStore.snapshot.open
})

const pills = computed<Array<[string, string]>>(() => {
	void bumpFleet.value
	return [
		['💨', demo.value.autoOxygen ? 'O₂ on' : 'O₂ off'],
		['🛡️', demo.value.shieldGenerator ? 'Shields up' : 'Shields down'],
		['⚡', demo.value.fastMode ? 'Hyper-tick' : 'Normal tick'],
		['⚠️', demo.value.alertLevel],
		['🪐', demo.value.colonyTheme],
		['🔌', demo.value.powerPriority],
		['⏱️', `×${demo.value.gameSpeed}`],
		['🪙', `${demo.value.taxRate}%`],
		['☀️', `×${demo.value.solarEfficiency}`],
		['⭐', `${demo.value.satisfaction}/5`],
	]
})

const stateRows = computed<Array<[string, string]>>(() => [
	['Last action', demo.value.lastAction],
	['Threat', demo.value.alertLevel],
	['Power', demo.value.powerPriority],
	['Atmosphere', demo.value.colonyTheme],
])

function applyTheme(): void {
	if (document.documentElement.dataset.theme === undefined) {
		applyThemeSetting(document.documentElement, 'system')
		return
	}
	applyThemeSetting(
		document.documentElement,
		document.documentElement.dataset.theme as 'light' | 'dark' | 'system'
	)
}
applyTheme()

function readStoredLayout(): AnySerializedLayout | undefined {
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
		demo.value.lastAction = 'Layout saved'
	} catch {
		demo.value.lastAction = 'Layout save failed'
	}
}

function loadPreset(id: DemoMode): void {
	const layout = demoLayoutFor(id)
	editable.value = (['rw-combobox', 'rw-command-first'] as DemoMode[]).includes(id)
	core.layout.setLayout({ borders: layout.borders, parking: layout.parking })
	restoredHidden.value = true
	const labels: Record<DemoMode, string> = {
		'rw-combobox': 'R/W + command box',
		'rw-command-first': 'R/W command-first',
		'ro-combobox': 'R-O + command box',
	}
	demo.value.lastAction = `Loaded "${labels[id]}"`
}

function loadStoredLayout(): void {
	const stored = readStoredLayout()
	if (!stored) {
		demo.value.lastAction = 'No saved layout'
		return
	}
	core.layout.setLayout(stored)
	restoredHidden.value = false
	demo.value.lastAction = 'Layout loaded'
}

const started = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
	timer = setInterval(() => {
		// Skip the tick while a drag session is live: the shell re-renders
		// borders on context key changes, and a mid-gesture re-render
		// would replace the dwell gap node under the pointer (the dwell
		// timer then never fires). The elapsed chip catches up on release.
		if (dragLive.value) return
		const elapsed = Math.floor((Date.now() - started) / 1000)
		const formatted = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
		demo.value.missionElapsed = formatted
		missionBag.set('elapsed', formatted)
	}, 1000)
	const stored = readStoredLayout()
	if (stored !== undefined) {
		try {
			core.layout.setLayout(stored)
			restoredHidden.value = false
		} catch {
			restoredHidden.value = true
		}
	}
})

onBeforeUnmount(() => {
	if (timer !== undefined) clearInterval(timer)
	unsubConsole()
})
</script>

<style>
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
.demo-fleet { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: 8px; }
.demo-ship-card { display: grid; gap: 4px; padding: 0.6rem 0.8rem; border: 1px solid rgba(71, 85, 105, 0.65); border-radius: 11px; background: rgba(15, 23, 42, 0.64); color: inherit; font: inherit; text-align: start; cursor: pointer; }
.demo-ship-card:hover { border-color: rgba(96, 165, 250, 0.6); }
.demo-ship-card.is-selected { border-color: #60a5fa; box-shadow: 0 0 0 1px #60a5fa; }
.demo-ship-name { font-weight: 700; }
.demo-ship-props { font-size: 0.82rem; color: #94a3b8; display: flex; gap: 8px; }
</style>
