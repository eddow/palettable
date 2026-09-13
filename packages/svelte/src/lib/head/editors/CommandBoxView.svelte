<script lang="ts">
	import {
		handlePaletteCommandChipKeydown,
		type PaletteCommandBoxModel, 
		setPaletteCommandBoxInput
	} from '$lib/palette/core.svelte'

	type Props = {
		box: PaletteCommandBoxModel
		inputEl?: HTMLInputElement | undefined
		/** Test id prefix: `command-box` or `console`. */
		testId?: string
		/** Leading icon shown before the tokens (toolbar shell renders its own). */
		icon?: string | undefined
		/** Shell title tooltip. */
		title?: string | undefined
		/** Extra shell content (e.g. the console mode toggle). */
		shellExtra?: import('svelte').Snippet
		/** Called on Enter after execute; return value ignored. */
		onEnter?: (entryId: string | undefined) => void
		/** Called when a result is activated (click or Enter-select). */
		onActivate?: (entryId: string) => void
		/** Called on Escape. */
		onEscape?: () => void
		/** Keep the popover open on blur (toolbar combobox closes, console stays). */
		closeOnBlur?: boolean
		/** Focus/blur hooks for the floating combobox open state. */
		onFocus?: () => void
		onBlur?: () => void
	}

	let {
		box,
		inputEl = $bindable(undefined),
		testId = 'command-box',
		icon,
		title,
		shellExtra,
		onEnter,
		onActivate,
		onEscape,
		closeOnBlur = false,
		onFocus,
		onBlur
	}: Props = $props()

	function acceptSuggestion(keyword: string) {
		box.keywords.addToken(keyword)
		box.input.value = ''
		inputEl?.focus()
	}
</script>

<div class="palette-default-command-shell" {title}>
	{#if icon !== undefined}
		<span class="palette-default-icon">{icon}</span>
	{/if}
	<div class="palette-default-command-tokens">
		{#each box.categories.active as category (category)}
			<button
				type="button"
				class="palette-default-command-chip"
				onclick={() => box.categories.toggle(category)}
				onkeydown={(event) =>
					handlePaletteCommandChipKeydown({
						commandBox: box as never,
						event,
						token: category,
						type: 'category'
					})}
			>
				#{category}
			</button>
		{/each}
		{#each box.keywords.tokens as token (token.keyword)}
			<button
				type="button"
				class="palette-default-command-chip"
				onclick={() => box.keywords.removeToken(token.keyword)}
				onkeydown={(event) =>
					handlePaletteCommandChipKeydown({
						commandBox: box as never,
						event,
						token: token.keyword
					})}
			>
				{token.keyword}
			</button>
		{/each}
		<input
			bind:this={inputEl}
			class="palette-default-command-input"
			data-testid={`${testId}-input`}
			value={box.input.value}
			placeholder={box.input.placeholder}
			onfocus={() => onFocus?.()}
			onblur={() => {
				if (closeOnBlur) onBlur?.()
			}}
			oninput={(event) => setPaletteCommandBoxInput(box as never, event)}
			onkeydown={(event) => {
				const handled = box.handleKeyDown(event)
				if (handled && event.key === 'Enter') {
					event.preventDefault()
					onEnter?.(box.selection.item?.id ?? box.results[0]?.id)
				}
				if (event.key === 'Escape') onEscape?.()
			}}
		/>
		{@render shellExtra?.()}
	</div>
</div>
<div class="palette-default-command-popover">
	{#if box.suggestions.length > 0}
		<div class="palette-default-command-suggestions">
			{#each box.suggestions as suggestion (suggestion.keyword)}
				<button
					type="button"
					class="palette-default-command-suggestion"
					onmousedown={(event) => event.preventDefault()}
					onclick={() => acceptSuggestion(suggestion.keyword)}
				>
					{suggestion.keyword}
				</button>
			{/each}
		</div>
	{/if}
	<div class="palette-default-command-results" data-testid={`${testId}-results`}>
		{#if box.results.length === 0}
			<div class="palette-default-command-empty">No matching commands</div>
		{:else}
			{#each box.results.slice(0, 8) as entry (entry.id)}
				<button
					type="button"
					data-testid={testId === 'console' ? `console-result-${entry.id}` : undefined}
					class={[
						'palette-default-command-result',
						box.selection.item?.id === entry.id ? 'is-selected' : undefined
					]}
					disabled={entry.can === false}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => onActivate?.(entry.id)}
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
