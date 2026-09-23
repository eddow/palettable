/**
 * Vanilla demo icon customization: proves a consumer can own icon
 * resolution + the configurator Icon field without touching the adapter.
 *
 * - `DEMO_ICONS`: hard-coded `icon:<name>` → glyph dictionary (a few icons
 *   the demo uses a lot).
 * - `demoIconResolver`: strips the `icon:` prefix, dict lookup, passthrough
 *   otherwise (emoji + unknown `icon:` names render as-is).
 * - `renderDemoIconField`: combo + free text — a native `input` + `datalist`
 *   bound to `DEMO_ICON_CHOICES`, so predefined values are selectable and
 *   arbitrary text stays typable. Calls `onChange` exactly like the default
 *   text input, so `patchLive`/`patchDraft` keep working.
 */

export const DEMO_ICONS: Record<string, string> = {
	moon: '🌙',
	sun: '☀️',
	rocket: '🚀',
	planet: '🪐',
	command: '⌘',
	alert: '⚠️',
	shield: '🛡️',
	bolt: '⚡',
	save: '💾',
	reset: '🔄',
	terminal: '💻',
	theme: '🎨',
}

export const DEMO_ICON_CHOICES: readonly string[] = Object.keys(DEMO_ICONS).map(
	(name) => `icon:${name}`
)

/** Demo resolver for `IdeOptions.iconResolver`: `icon:<name>` → dict glyph,
 * everything else passes through untouched. */
export function demoIconResolver(token: string): string | undefined {
	if (!token.startsWith('icon:')) return token
	return DEMO_ICONS[token.slice('icon:'.length)] ?? token
}

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
