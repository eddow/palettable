<script lang="ts">
	import type { Component } from 'svelte'
	import {
		closeConsole,
		consoleState,
		type PaletteAddItemCommandEntry,
		type PaletteBorder,
		type PaletteDerivedVariant,
		type PaletteEditorContext,
		type PaletteParking, 
		type Palette as PaletteRuntime,
		Parking,
		paletteAddItemEntries,
		paletteCommandBoxModel,
		paletteCommandEntries,
		paletteDerivedVariants,
		palettes
	} from '$lib/palette/edition.svelte'
	import CommandBoxView from './editors/CommandBoxView.svelte'

	type Props = {
		palette: PaletteRuntime
		top: PaletteBorder
		left?: PaletteBorder
		right?: PaletteBorder
		bottom?: PaletteBorder
		/** Independent parking stack. Never a live border — parking owns its
		 * toolbars outright (single ownership). */
		parking?: PaletteParking
	}

	let { palette, top, left, right, bottom, parking }: Props = $props()

	// Auto-detect whether a `commandBox` item is displayed in any border. If it
	// is, the console is edit-only (the toolbar launcher is the edit entry
	// point); if not, the console is command-first with optional edit. Adding
	// or removing the `commandBox` item from a toolbar changes this behaviour
	// live, since the borders are reactive.
	const hasCommandBoxTool = $derived(
		[top, left, right, bottom].some((border) =>
			border?.some((track) =>
				track.some((slot) => slot.toolbar.some((item) => item.editor === 'commandBox'))
			)
		)
	)

	// Models must be created during component init (rune init-time constraint).
	// `console` is the core meta-tool that opens this console; exclude it from
	// run/add so it isn't listed — or re-executed — inside the console.
	// Entries are seeded once from the (stable) palette prop.
	// svelte-ignore state_referenced_locally
	const runEntries = paletteCommandEntries({
		palette: palette as never,
		excludeTools: ['console']
	})
	// svelte-ignore state_referenced_locally
	const addEntries = paletteAddItemEntries({
		palette: palette as never,
		excludeTools: ['console']
	})
	const popupCommandBox = paletteCommandBoxModel({
		entries: runEntries,
		placeholder: 'Command…'
	})
	const popupAddCommandBox = paletteCommandBoxModel({
		entries: addEntries,
		placeholder: 'Add to toolbar…',
		enterAction: 'select'
	})

	// Edit-only when a `commandBox` tool is displayed (the launcher is the
	// edit entry point); command-first with optional edit otherwise.
	// Read-only palettes (`editable: false`) never edit: no toggle, run box
	// only — otherwise the toggle would flip `consoleState.mode` to `edit`
	// while `palette.editing` stays `false` (the getter guards on
	// `editable !== false`), leaving a dead add box/catalogue.
	const canEdit = $derived(palette.config.editable !== false)
	const editOnly = $derived(hasCommandBoxTool)
	const isEditing = $derived(canEdit && (editOnly || consoleState.mode === 'edit'))
	const activeBox = $derived(isEditing ? popupAddCommandBox : popupCommandBox)

	// The inspected item (selected on the toolbar via `pointerdown`) drives the
	// configurator: label/icon/hint/editor/tone plus the item-level delete
	// action (G2). The configurator edits presentation in place; deletion
	// removes the item from its live container (border toolbar/track/border
	// or parking toolbar/stack, carried on `palettes.inspecting`) and clears
	// the inspector.
	const inspecting = $derived(
		palettes.inspecting?.palette === (palette as never) ? palettes.inspecting : undefined
	)
	const inspectingItem = $derived(
		inspecting?.item as { tool?: string; editor?: string } | undefined
	)
	const inspectingTool = $derived(
		inspectingItem?.tool ? palette.tool(inspectingItem.tool) : undefined
	)
	const Configurator = $derived.by<Component<{ context: PaletteEditorContext }> | undefined>(() => {
		if (!inspectingItem) return undefined
		try {
			return palette.renderConfigurator(inspectingItem as never, inspectingTool as never, {
				palette: palette as never,
				region: inspecting?.region
			}) as unknown as Component<{ context: PaletteEditorContext }>
		} catch {
			return undefined
		}
	})
	const configuratorContext = $derived.by<PaletteEditorContext | undefined>(() => {
		if (!inspectingItem || !Configurator) return undefined
		try {
			const context = palette.resolveConfiguratorContext(
				inspectingItem as never,
				inspectingTool as never,
				{
					palette: palette as never,
					region: inspecting?.region
				}
			) as unknown as PaletteEditorContext & { scope: Record<string, unknown> }
			// Carry the live container so the configurator's delete button can
			// prune it: parking items carry toolbar+parking (never a border),
			// border items carry toolbar/track/border.
			if (inspecting?.toolbar !== undefined && inspecting?.parking !== undefined) {
				context.scope.toolbar = inspecting.toolbar
				context.scope.parking = inspecting.parking
			} else if (
				inspecting?.toolbar !== undefined &&
				inspecting?.track !== undefined &&
				inspecting?.border !== undefined
			) {
				context.scope.toolbar = inspecting.toolbar
				context.scope.track = inspecting.track
				context.scope.border = inspecting.border
			}
			return context
		} catch {
			return undefined
		}
	})

	// Editing state is mirrored onto `palettes.editing` so the underlying
	// toolbar chrome + inert shield engage while the console is in edit mode.
	// The cleanup clears the mirror on teardown (unmount), so closing the
	// console while editing never leaves the toolbars inert.
	$effect(() => {
		const target = isEditing ? (palette as never) : undefined
		palettes.editing = target
		return () => {
			if (palettes.editing === (palette as never)) palettes.editing = undefined
		}
	})

	// Independent parking stack: the console always renders `parking` (never a
	// live border), so a top-bar drag can never light up a parking row as
	// dragged. Empty parking stays visible as a bordered strip with a hint —
	// like a border stack that never collapses. The command-box item is
	// excluded from the parking *view* (mirrors the reference
	// `popupParkingToolbars`) by filtering at render — the stack itself is
	// untouched.
	const parkingScope = $derived({ palette: palette as never })

	// Console panel-background hover (the `Ide` mask analogue): while editing
	// + dragging, a pointer over the panel but outside the parking rows/gaps
	// (and outside popups/dialogs) keeps the parking end gap lit so the stack
	// reads as a drop target while dragging over the console.
	let parkingMaskHover = $state(false)
	const isConsoleDragging = $derived(palettes.dragging?.palette === (palette as never))

	function onPanelPointerMove(event: PointerEvent): void {
		if (!isEditing || !isConsoleDragging) {
			parkingMaskHover = false
			return
		}
		const target = event.target
		if (!(target instanceof HTMLElement)) {
			parkingMaskHover = false
			return
		}
		// Over parking itself → parking owns the highlight, not the mask.
		if (target.closest('.palette-parking')) {
			parkingMaskHover = false
			return
		}
		// On a popup/dialog → neither parking nor mask.
		if (target.closest('.palettable-drawer__popup, dialog')) {
			parkingMaskHover = false
			return
		}
		parkingMaskHover = true
	}

	function onPanelPointerLeave(): void {
		parkingMaskHover = false
	}

	$effect(() => {
		if (!isEditing || !isConsoleDragging) parkingMaskHover = false
	})

	const selectedEntry = $derived<PaletteAddItemCommandEntry | undefined>(
		consoleState.selectedEntryId
			? (addEntries.find((entry) => entry.id === consoleState.selectedEntryId) as unknown as
					| PaletteAddItemCommandEntry
					| undefined)
			: undefined
	)
	const variants = $derived<readonly PaletteDerivedVariant[]>(
		selectedEntry
			? paletteDerivedVariants({ palette: palette as never, entry: selectedEntry as never })
			: []
	)

	let inputEl: HTMLInputElement | undefined = $state(undefined)
	$effect(() => {
		inputEl?.focus()
	})

	function close() {
		closeConsole()
		// Explicitly clear the edit-mode mirror + inspector so the toolbars
		// are never left inert when the console closes while editing.
		if (palettes.editing === (palette as never)) palettes.editing = undefined
		if (palettes.inspecting?.palette === (palette as never)) delete palettes.inspecting
	}
</script>

<div
	class="palette-default-command-overlay"
	role="dialog"
	aria-label="Palette console"
	data-testid="console-overlay"
	tabindex={-1}
	onmousedown={(event) => {
		if (event.target === event.currentTarget) close()
	}}
>
	<div
		class="palette-default-command-panel"
		role="presentation"
		onpointermove={onPanelPointerMove}
		onpointerleave={onPanelPointerLeave}
	>
		<button
			type="button"
			class="palette-default-command-close"
			aria-label="Close console"
			onclick={close}
		>
			×
		</button>
		<div class="palette-default-command-top">
			{#if parking}
				<Parking
					{parking}
					palette={palette as never}
					scope={parkingScope}
					el={{ class: 'palette-default-command-parking' }}
					maskActive={parkingMaskHover}
				/>
			{/if}
			<div class="palette-default-command-bottom">
				<div class="palette-default-command-main">
					<div class="palette-default-command-box is-expanded">
						<CommandBoxView
							box={activeBox}
							bind:inputEl
							testId="console"
							icon="⌘"
							title="Console command box"
							onEnter={(entryId) => {
								if (!isEditing) close()
								else if (entryId) {
									consoleState.selectedEntryId = entryId
									consoleState.selectedVariantId = undefined
								}
							}}
							onActivate={(entryId) => {
								if (isEditing) {
									activeBox.select(entryId)
									consoleState.selectedEntryId = entryId
									consoleState.selectedVariantId = undefined
								} else {
									activeBox.execute(entryId)
									close()
								}
							}}
							onEscape={close}
						>
							{#snippet shellExtra()}
								{#if canEdit && !editOnly}
									<button
										type="button"
										class="palette-default-command-mode"
										data-testid="console-mode-toggle"
										aria-pressed={isEditing ? 'true' : 'false'}
										aria-label={isEditing ? 'Done editing' : 'Edit toolbars'}
										title={isEditing ? 'Done editing' : 'Edit toolbars'}
										onclick={() => {
											consoleState.mode = isEditing ? 'run' : 'edit'
										}}
									>
										{isEditing ? '✓' : '✎'}
									</button>
								{/if}
							{/snippet}
						</CommandBoxView>
					</div>
				</div>
				{#if isEditing}
					<div
						class="palette-default-panel palette-default-details-panel"
						data-testid="console-details-panel"
					>
						{#if inspectingItem}
							<div class="palette-default-panel-title">Inspect</div>
							{#if Configurator && configuratorContext}
								<Configurator context={configuratorContext} />
							{:else}
								<div class="palette-default-config-empty">
									No configurator for {inspectingItem.tool ?? inspectingItem.editor}.
								</div>
							{/if}
						{:else if selectedEntry}
							<div class="palette-default-panel-title">Add to toolbar</div>
						{:else}
							<div class="palette-default-panel-title">Details</div>
							<div class="palette-default-config-empty">
								Click a toolbar item to inspect its presentation, or select a tool or editor on the
								left to add it to a toolbar.
							</div>
						{/if}
						{#if selectedEntry && !inspectingItem}
							<div class="palette-default-config-stack" data-testid="console-add-panel">
								<div class="palette-default-config-header">
									<strong>{selectedEntry.label}</strong>
									<span>{selectedEntry.meta}</span>
								</div>
								{#each variants as variant (variant.id)}
									{@const isSelected = consoleState.selectedVariantId === variant.id}
									<div
										class={[
											'palette-default-add-variant',
											variant.kind === 'set' ? 'is-set' : undefined
										]}
									>
										<button
											type="button"
											class={[
												'palette-default-config-header',
												'palette-default-add-variant-trigger',
												isSelected ? 'is-selected' : undefined
											]}
											aria-pressed={isSelected ? 'true' : 'false'}
											onclick={() => {
												consoleState.selectedVariantId = variant.id
											}}
										>
											<strong>
												{#if variant.icon && typeof variant.icon === 'string'}
													<span class="palette-default-icon">{variant.icon}</span>
												{/if}
												{variant.label}
											</strong>
											<span>{variant.meta}</span>
										</button>
										{#if variant.kind === 'set'}
											<div class="palette-default-add-inline-value">
												<strong>Value</strong>
												{#if variant.valueType === 'boolean'}
													<select
														value={consoleState.booleanValue}
														onchange={(e) => {
															consoleState.booleanValue =
																e.currentTarget.value === 'false' ? 'false' : 'true'
														}}
													>
														<option value="true">true</option>
														<option value="false">false</option>
													</select>
												{:else if variant.valueType === 'number'}
													<input
														value={consoleState.setValue}
														placeholder="14"
														oninput={(e) => {
															consoleState.setValue = e.currentTarget.value
														}}
													/>
												{:else if variant.valueType === 'enum'}
													<select
														value={consoleState.setValue}
														onchange={(e) => {
															consoleState.setValue = e.currentTarget.value
														}}
													>
														<option value="">Choose value…</option>
														{#each variant.values ?? [] as value (value.value)}
															<option value={value.value}>{value.label ?? value.value}</option>
														{/each}
													</select>
												{/if}
											</div>
										{/if}
										{#if variant.kind === 'tool'}
											<label class="palette-default-add-inline-value">
												<strong>Allowed values</strong>
												<input
													value={consoleState.enumValues}
													placeholder="comma-separated subset"
													oninput={(e) => {
														consoleState.enumValues = e.currentTarget.value
													}}
												/>
											</label>
											<label class="palette-default-add-inline-value">
												<strong>Keyword filter</strong>
												<input
													value={consoleState.enumKeywords}
													placeholder="row, column"
													oninput={(e) => {
														consoleState.enumKeywords = e.currentTarget.value
													}}
												/>
											</label>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.palette-default-command-mode {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2rem;
		block-size: 2rem;
		flex: 0 0 auto;
		margin: -4px;
		padding: 0;
		border: 1px solid rgba(71, 85, 105, 0.95);
		border-radius: 10px;
		background: rgba(15, 23, 42, 0.88);
		color: #94a3b8;
		cursor: pointer;
		font-size: 0.95rem;
		line-height: 1;
		transition:
			border-color 120ms ease,
			background 120ms ease,
			color 120ms ease;
	}
	.palette-default-command-mode:hover,
	.palette-default-command-mode[aria-pressed='true'] {
		border-color: #60a5fa;
		background: #1d4ed8;
		color: #eff6ff;
	}
	:global(.palette-default-theme-light) .palette-default-command-mode {
		border-color: rgba(148, 163, 184, 0.9);
		background: #ffffff;
		color: #475569;
	}
	:global(.palette-default-theme-light) .palette-default-command-mode:hover,
	:global(.palette-default-theme-light) .palette-default-command-mode[aria-pressed='true'] {
		border-color: #60a5fa;
		background: #1d4ed8;
		color: #eff6ff;
	}
	.palette-default-config-stack {
		display: grid;
		gap: 10px;
	}
	.palette-default-config-header {
		display: grid;
		gap: 2px;
	}
	.palette-default-config-empty {
		color: #94a3b8;
		font-size: 0.85rem;
	}
</style>
