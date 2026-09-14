<script lang="ts">
	import { onMount } from 'svelte'
	import {
		type DemoMode,
		demoConfigs,
		demoLayoutFor,
		demoPalette,
		demoState
	} from '$demo/palette.svelte'
	import { Console } from '$lib/head/registry'
	import {
		consoleState,
		Ide,
		type PaletteBorder,
		type PaletteParking,
		type SerializedPaletteLayout, 
		serializePaletteLayout,
		validatePaletteLayout
	} from '$lib/palette/edition.svelte'
	import '$lib/palette/styles/palette.css'
	import '$lib/head/styles/head-default.css'

	const LAYOUT_STORAGE_KEY = 'palettable-demo-layout-v1'

	// Preset loads are plain commands, not toggle state: each button loads a
	// fresh clone of its configuration's layout. The demo seeds `rw-combobox`
	// (matches the legacy demo).

	function readStoredLayout(): SerializedPaletteLayout | undefined {
		try {
			const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
			if (!raw) return undefined
			const parsed: unknown = JSON.parse(raw)
			if (!validatePaletteLayout(parsed)) return undefined
			return parsed
		} catch {
			return undefined
		}
	}

	// Seed fresh clones so edits never mutate the shared config layout objects,
	// and so server + client first render are identical. Parking is its own
	// independent stack — never a live border, never shared references.
	const initial = demoLayoutFor('rw-combobox')
	const top = $state(structuredClone(initial.borders.top))
	const left = $state(structuredClone(initial.borders.left))
	const right = $state(structuredClone(initial.borders.right))
	const bottom = $state(structuredClone(initial.borders.bottom))
	const parking: PaletteParking = $state(structuredClone(initial.parking))
	let layoutRestored = $state(false)

	// Theme resolution: `demoState.theme` is the setting (`light`/`dark`/`system`);
	// `resolvedTheme` is what actually renders. `system` follows the OS via
	// `prefers-color-scheme`. The `palette-default-theme-light` CSS class (the
	// only theme override in the head theme `head-default.css`; the base is
	// dark) is synced onto `<html>` so it also covers body-portaled drawer
	// popups, which live outside `<main>`.
	let systemPrefersLight = $state(false)
	$effect(() => {
		const query = window.matchMedia('(prefers-color-scheme: light)')
		systemPrefersLight = query.matches
		const onChange = (event: MediaQueryListEvent) => {
			systemPrefersLight = event.matches
		}
		query.addEventListener('change', onChange)
		return () => query.removeEventListener('change', onChange)
	})
	const resolvedTheme = $derived<'light' | 'dark'>(
		demoState.theme === 'system' ? (systemPrefersLight ? 'light' : 'dark') : demoState.theme
	)
	$effect(() => {
		const root = document.documentElement
		root.classList.toggle('palette-default-theme-light', resolvedTheme === 'light')
		root.dataset.theme = resolvedTheme
		root.style.colorScheme = resolvedTheme
	})

	// Mission clock (mm:ss) — ticks `demoState.missionElapsed`, rendered by the
	// work-zone chip. The bottom toolbar `status` item is pointless (config display
	// only) and does not bind this value.
	onMount(() => {
		const started = Date.now()
		const timer = setInterval(() => {
			const elapsed = Math.floor((Date.now() - started) / 1000)
			demoState.missionElapsed = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
		}, 1000)
		return () => clearInterval(timer)
	})
	// Restore a saved layout client-side after mount: SSR always renders the
	// initial layout (no hydration mismatch), then the stored borders are
	// spliced into the existing `$state` proxies. `hydratePaletteLayout` can't
	// run here (its `$state` is init-only), so the plain stored data is spliced
	// directly — the deep proxies make the inserted data reactive.
	onMount(() => {
		const stored = readStoredLayout()
		if (!stored) return
		applyStoredLayout(stored)
		layoutRestored = true
	})

	function applyStoredLayout(stored: SerializedPaletteLayout): void {
		// Serialized borders are flat slot lists (`{ space, toolbar }[]`);
		// runtime borders are track lists (`{ space, toolbar }[][]`). Re-nest
		// each stored slot as its own single-slot track — the same shape
		// `hydratePaletteLayout` produces — then splice into the `$state`
		// proxies so the inserted data stays reactive. Parking splices as
		// plain rows into its own stack (never into a border).
		const nest = (slots: SerializedPaletteLayout['borders']['top']): PaletteBorder =>
			slots.map((slot) => [
				{ space: slot.space, toolbar: slot.toolbar as PaletteBorder[number][number]['toolbar'] }
			]) as PaletteBorder
		top.splice(0, top.length, ...nest(stored.borders.top))
		left.splice(0, left.length, ...nest(stored.borders.left))
		right.splice(0, right.length, ...nest(stored.borders.right))
		bottom.splice(0, bottom.length, ...nest(stored.borders.bottom))
		parking.splice(0, parking.length, ...(structuredClone(stored.parking ?? []) as PaletteParking))
	}

	function persistLayout() {
		try {
			const serialized = serializePaletteLayout({ top, left, right, bottom }, parking)
			localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(serialized))
			demoState.lastAction = 'Layout saved'
		} catch {
			demoState.lastAction = 'Layout save failed'
		}
	}

	/** Load a preset configuration layout (a command, not a state). */
	function loadPreset(id: DemoMode) {
		// A preset is the whole configuration: borders AND parking. Splice
		// both into the `$state` proxies so a stale parked row never survives
		// a preset switch.
		const layout = demoLayoutFor(id)
		top.splice(0, top.length, ...structuredClone(layout.borders.top))
		left.splice(0, left.length, ...structuredClone(layout.borders.left))
		right.splice(0, right.length, ...structuredClone(layout.borders.right))
		bottom.splice(0, bottom.length, ...structuredClone(layout.borders.bottom))
		parking.splice(0, parking.length, ...structuredClone(layout.parking))
		layoutRestored = false
		demoState.lastAction = `Loaded "${demoConfigs.find((c) => c.id === id)?.label ?? id}"`
	}

	/** Load the persisted layout from localStorage (explicit load command). */
	function loadStoredLayout() {
		const stored = readStoredLayout()
		if (!stored) {
			demoState.lastAction = 'No saved layout'
			return
		}
		applyStoredLayout(stored)
		layoutRestored = true
		demoState.lastAction = 'Layout loaded'
	}
</script>

<main>
	<div class="demo-bar">
		<h1>Stellar Outpost — palette demo</h1>
		<div class="demo-modes">
			{#each demoConfigs as config (config.id)}
				<button
					type="button"
					data-testid={`mode-${config.id}`}
					title={config.description}
					onclick={() => loadPreset(config.id)}
				>
					{config.label}
				</button>
			{/each}
		</div>
		<div class="demo-io" role="group" aria-label="Layout persistence">
			<button type="button" data-testid="save-layout" onclick={persistLayout}>Save layout</button>
			<button type="button" data-testid="load-layout" onclick={loadStoredLayout}>Load layout</button
			>
		</div>
		{#if layoutRestored}
			<span class="demo-state" data-testid="layout-restored">Layout restored from localStorage</span
			>
		{/if}
		<span class="demo-state" data-testid="last-action">Last action: {demoState.lastAction}</span>
	</div>
	<Ide palette={demoPalette} {top} {left} {right} {bottom}>
		{#if consoleState.open}
			<Console palette={demoPalette as never} {top} {left} {right} {bottom} {parking} />
		{/if}
		<div class="demo-center" class:is-dimmed={consoleState.open} data-testid="work-zone">
			<div class="demo-hero">
				<div>
					<strong>Stellar Outpost</strong>
					<span
						>Space colony management sim — every colony variable below is bound to a toolbar editor.</span
					>
				</div>
				<div class="demo-chip" data-testid="elapsed">⏱ {demoState.missionElapsed}</div>
			</div>
			<div class="demo-strip">
				<span class="demo-pill">💨 {demoState.autoOxygen ? 'O₂ on' : 'O₂ off'}</span>
				<span class="demo-pill">🛡️ {demoState.shieldGenerator ? 'Shields up' : 'Shields down'}</span
				>
				<span class="demo-pill">⚡ {demoState.fastMode ? 'Hyper-tick' : 'Normal tick'}</span>
				<span class="demo-pill">⚠️ {demoState.alertLevel}</span>
				<span class="demo-pill">🪐 {demoState.colonyTheme}</span>
				<span class="demo-pill">🔌 {demoState.powerPriority}</span>
				<span class="demo-pill">⏱️ ×{demoState.gameSpeed}</span>
				<span class="demo-pill">🪙 {demoState.taxRate}%</span>
				<span class="demo-pill">☀️ ×{demoState.solarEfficiency}</span>
				<span class="demo-pill">⭐ {demoState.satisfaction}/5</span>
			</div>
			<div class="demo-panel">
				<div class="demo-panel-title">Colony status</div>
				<div class="demo-state-grid">
					<div class="demo-state-row">
						<span class="demo-state-key">Last action</span>
						<span class="demo-state-value">{demoState.lastAction}</span>
					</div>
					<div class="demo-state-row">
						<span class="demo-state-key">Threat</span>
						<span class="demo-state-value">{demoState.alertLevel}</span>
					</div>
					<div class="demo-state-row">
						<span class="demo-state-key">Power</span>
						<span class="demo-state-value">{demoState.powerPriority}</span>
					</div>
					<div class="demo-state-row">
						<span class="demo-state-key">Atmosphere</span>
						<span class="demo-state-value">{demoState.colonyTheme}</span>
					</div>
				</div>
			</div>
			<p>Open the console, then click a toolbar item to configure its presentation.</p>
		</div>
	</Ide>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 100vh;
		block-size: 100dvh;
		font-family: system-ui, sans-serif;
		background: #020617;
		color: #e2e8f0;
	}
	/* Light mode follows the resolved theme on `<html data-theme>` (see script). */
	:global(html[data-theme='light']) main {
		background: #f1f5f9;
		color: #0f172a;
	}
	:global(html),
	:global(body) {
		block-size: 100%;
	}
	:global(body) {
		margin: 0;
	}
	:global(main > .palette-ide) {
		flex: 1 1 auto;
		min-block-size: 0;
	}
	.demo-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
	}
	.demo-bar h1 {
		font-size: 1.1rem;
		margin: 0;
	}
	.demo-modes {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.demo-modes button,
	.demo-io button {
		padding: 0.34rem 0.72rem;
		border: 1px solid rgba(71, 85, 105, 0.9);
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.88);
		color: #e2e8f0;
		cursor: pointer;
		font-size: 0.82rem;
	}
	.demo-io {
		display: inline-flex;
		align-items: center;
	}
	.demo-io button:first-child {
		border-start-end-radius: 0;
		border-end-end-radius: 0;
	}
	.demo-io button:last-child {
		border-start-start-radius: 0;
		border-end-start-radius: 0;
		border-inline-start-width: 0;
	}
	:global(html[data-theme='light']) .demo-modes button,
	:global(html[data-theme='light']) .demo-io button {
		border-color: rgba(148, 163, 184, 0.9);
		background: #ffffff;
		color: #0f172a;
	}
	.demo-center {
		position: relative;
		padding: 1rem;
		display: grid;
		gap: 1rem;
		align-content: start;
	}
	:global(.palette-ide-center) {
		position: relative;
	}
	.demo-center.is-dimmed {
		opacity: 0.45;
		filter: grayscale(0.4);
		pointer-events: none;
		user-select: none;
	}
	.demo-hero,
	.demo-panel {
		display: grid;
		gap: 10px;
		padding: 14px;
		border: 1px solid rgba(51, 65, 85, 0.9);
		border-radius: 16px;
		background: rgba(15, 23, 42, 0.82);
		box-shadow: 0 16px 36px rgba(2, 6, 23, 0.28);
		color: #e2e8f0;
	}
	.demo-hero {
		grid-template-columns: 1fr auto;
		align-items: center;
	}
	:global(html[data-theme='light']) .demo-hero,
	:global(html[data-theme='light']) .demo-panel {
		border-color: rgba(148, 163, 184, 0.9);
		background: #ffffff;
		box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
		color: #0f172a;
	}
	.demo-hero span {
		color: #94a3b8;
	}
	:global(html[data-theme='light']) .demo-hero span {
		color: #475569;
	}
	.demo-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 0.42rem 0.8rem;
		border-radius: 999px;
		background: rgba(30, 41, 59, 0.96);
		border: 1px solid rgba(96, 165, 250, 0.24);
		color: #bfdbfe;
	}
	:global(html[data-theme='light']) .demo-chip {
		background: rgba(241, 245, 249, 0.96);
		border-color: rgba(148, 163, 184, 0.9);
		color: #0f172a;
	}
	.demo-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 10px 12px;
		border: 1px dashed rgba(71, 85, 105, 0.9);
		border-radius: 14px;
		background: rgba(15, 23, 42, 0.56);
	}
	:global(html[data-theme='light']) .demo-strip {
		border-color: rgba(148, 163, 184, 0.9);
		background: rgba(241, 245, 249, 0.96);
	}
	.demo-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0.34rem 0.7rem;
		border-radius: 999px;
		background: linear-gradient(180deg, #2563eb, #1d4ed8);
		color: #eff6ff;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.demo-panel-title {
		font-size: 0.82rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #94a3b8;
	}
	:global(html[data-theme='light']) .demo-panel-title {
		color: #475569;
	}
	.demo-state-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 8px;
	}
	.demo-state-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0.52rem 0.82rem;
		border: 1px solid rgba(71, 85, 105, 0.65);
		border-radius: 11px;
		background: rgba(15, 23, 42, 0.64);
	}
	:global(html[data-theme='light']) .demo-state-row {
		border-color: rgba(148, 163, 184, 0.9);
		background: rgba(241, 245, 249, 0.96);
	}
	.demo-state-key {
		font-size: 0.74rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #94a3b8;
	}
	:global(html[data-theme='light']) .demo-state-key {
		color: #475569;
	}
	.demo-state-value {
		font-weight: 600;
	}
</style>
