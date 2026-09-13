<script lang="ts">
	import type {
		PaletteEditorContext,
		PaletteSchema,
		PaletteToolbarItem
	} from '$lib/palette/core.svelte'
	import { commandBoxPresenter, openConsole } from '$lib/palette/core.svelte'
	import CommandBoxView from './CommandBoxView.svelte'

	type Props = {
		context: PaletteEditorContext<undefined, PaletteToolbarItem, PaletteSchema>
	}

	let { context }: Props = $props()
	// Created once at init (the model holds `$state`); `context` is a stable prop.
	// svelte-ignore state_referenced_locally
	const view = commandBoxPresenter({ context })
	const model = view.model

	let open = $state(false)
	let inputEl: HTMLInputElement | undefined = $state(undefined)

	function execute(entryId: string) {
		model.execute(entryId)
		open = false
		inputEl?.blur()
	}

	// The console auto-detects this command box and opens in edit mode, so the
	// button is the edit entry point for a toolbar that already runs commands
	// inline. It is a plain action button (not a toggle/check-button): pressing
	// it always opens the console in edit mode.
	function openEditor() {
		openConsole('edit')
		inputEl?.blur()
	}

	function onEnter(entryId: string | undefined) {
		if (entryId) execute(entryId)
		open = false
		inputEl?.blur()
	}

	function onEscape() {
		open = false
		inputEl?.blur()
	}
</script>

<div class="palette-default-command-box is-floating" data-testid="command-box-combobox">
	<CommandBoxView
		box={model}
		bind:inputEl
		testId="command-box"
		icon={view.icon}
		title={view.title}
		closeOnBlur
		onFocus={() => (open = true)}
		onBlur={() => (open = false)}
		{onEnter}
		onActivate={(entryId) => execute(entryId)}
		{onEscape}
	>
		{#snippet shellExtra()}
			<button
				type="button"
				class="palette-default-command-open"
				data-testid="command-box-open-editor"
				aria-label="Edit toolbars"
				title="Edit toolbars"
				onmousedown={(event) => event.preventDefault()}
				onclick={openEditor}
			>
				✎
			</button>
		{/snippet}
	</CommandBoxView>
	{#if open}
		<div class="palette-default-command-popover">
			<div class="palette-default-command-results">
				{#if model.results.length === 0}
					<div class="palette-default-command-empty">No matching commands</div>
				{:else}
					{#each model.results.slice(0, 8) as entry (entry.id)}
						<button
							type="button"
							class={[
								'palette-default-command-result',
								model.selection.item?.id === entry.id ? 'is-selected' : undefined
							]}
							disabled={entry.can === false}
							onmousedown={(event) => event.preventDefault()}
							onclick={() => execute(entry.id)}
						>
							<span class="palette-default-command-result-copy">
								<span class="palette-default-command-result-label">
									{#if entry.icon && typeof entry.icon === 'string'}
										<span class="palette-default-icon">{entry.icon}</span>
									{/if}
									{entry.label}
								</span>
								<span class="palette-default-command-result-meta">{entry.meta}</span>
							</span>
						</button>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>
