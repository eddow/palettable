/**
 * Vanilla demo icon field: proves a consumer can own the configurator Icon
 * field without touching the adapter.
 *
 * The shared dictionary + resolver live in `@palettable/demo-core`; only
 * this DOM-specific field renderer stays adapter-owned: combo + free text
 * (a native `input` + `datalist` bound to `DEMO_ICON_CHOICES`, so
 * predefined values are selectable and arbitrary text stays typable). It
 * calls `onChange` exactly like the default text input, so
 * `patchLive`/`patchDraft` keep working.
 */

let demoIconDatalistSeq = 0

/** Demo field for `IdeOptions.renderIconField`: combo + free text. */
export function renderDemoIconField(options: {
	readonly value: string
	readonly onChange: (next: string) => void
	readonly choices: readonly string[]
}): HTMLElement {
	const wrap = document.createElement('span')
	wrap.className = 'demo-icon-field'
	const field = document.createElement('input')
	const listId = `demo-icon-choices-${(demoIconDatalistSeq += 1)}`
	field.value = options.value
	field.setAttribute('list', listId)
	field.setAttribute('aria-label', 'Icon (name or emoji)')
	field.addEventListener('input', () => options.onChange(field.value))
	const list = document.createElement('datalist')
	list.id = listId
	for (const choice of options.choices) {
		const option = document.createElement('option')
		option.value = choice
		list.append(option)
	}
	wrap.append(field, list)
	return wrap
}
