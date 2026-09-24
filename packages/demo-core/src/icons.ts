/**
 * Shared demo icon dictionary: `icon:<name>` → glyph.
 *
 * The demo proves a consumer can own icon resolution without touching the
 * adapter: adapters pass `demoIconResolver` as their `iconResolver` seam
 * and `DEMO_ICON_CHOICES` as the configurator Icon-field choices. The
 * DOM-specific field renderer (`renderDemoIconField`, a native
 * input+datalist) stays adapter-owned — see `packages/vanilla/demo/icons.ts`.
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
	'flag-en': '🇬🇧',
	'flag-fr': '🇫🇷',
}

export const DEMO_ICON_CHOICES: readonly string[] = Object.keys(DEMO_ICONS).map(
	(name) => `icon:${name}`
)

/** Demo resolver for the adapter `iconResolver` seam: `icon:<name>` → dict
 * glyph, everything else passes through untouched. */
export function demoIconResolver(token: string): string | undefined {
	if (!token.startsWith('icon:')) return token
	return DEMO_ICONS[token.slice('icon:'.length)] ?? token
}
