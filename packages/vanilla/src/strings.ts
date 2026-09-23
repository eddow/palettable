/**
 * `@palettable/vanilla` — localizable IDE chrome strings (intl seam).
 *
 * All user-visible English chrome text lives here as a
 * default-and-overridable table. `defaultIdeStrings` holds today's English
 * verbatim; consumers pass a full or partial table via
 * `IdeOptions.strings` (static) or `IdeOptions.stringsForLocale` (called
 * per render with the live locale value). Templates never fall back to
 * hard-coded English — they read the resolved table.
 *
 * Point `label` / `hint` / option text resolve per render: item-config
 * field → locale-bundle dictionary → definition field → `humanize(id)`.
 * Catalog sentence templates live in core (`CatalogStrings`). This table
 * covers adapter chrome only: placeholders, empty states, console titles,
 * configurator row keys, control names.
 */
import type { LocaleBundle } from '@palettable/core'

/** Per-locale bundle: chrome + catalog tables plus the point dictionaries. */
export type VanillaLocaleBundle = LocaleBundle & {
	readonly ide?: Partial<IdeStrings>
}

export type IdeStrings = {
	/** Toolbar command-box input placeholder. */
	readonly commandPlaceholder: string
	/** Console input placeholder in edit mode. */
	readonly addPlaceholder: string
	/** Console input placeholder in run mode. */
	readonly runPlaceholder: string
	/** Console shell title. */
	readonly consoleTitle: string
	/** Toolbar command-box hint default (no item-config hint). */
	readonly searchHint: string
	/** Select listbox filter placeholder + aria-label. */
	readonly filterPlaceholder: string
	readonly filterAriaLabel: string
	/** Empty states. */
	readonly noMatches: string
	readonly noMatchingCommands: string
	/** Empty-stack drop-zone hint (empty border/parking gap). */
	readonly emptyDropZone: string
	/** Console mode toggle. */
	readonly editToolbars: string
	readonly doneEditing: string
	/** Console chrome. */
	readonly consoleAriaLabel: string
	readonly closeConsole: string
	/** Drawer trigger fallback (no label/hint). */
	readonly moreFallback: string
	/** Details panel titles + empty hint. */
	readonly inspectTitle: string
	readonly addToToolbarTitle: string
	readonly detailsTitle: string
	readonly configureTitle: string
	readonly previewTitle: string
	readonly detailsEmpty: string
	readonly cannotAdd: string
	/** Configurator row keys. */
	readonly labelKey: string
	readonly iconKey: string
	readonly hintKey: string
	readonly controlKey: string
	readonly toneKey: string
	readonly openModeKey: string
	readonly closeOnClickKey: string
	readonly statusKeyKey: string
	readonly displayNumberKey: string
	readonly showTextKey: string
	readonly filterListKey: string
	readonly deleteKey: string
	readonly deleteTool: string
	readonly deleteToolbar: string
	/** Tone + open-mode option labels. */
	readonly toneNeutral: string
	readonly toneAccent: string
	readonly openHover: string
	readonly openToggle: string
	/** Control registry display names (configurator Control row). */
	readonly controlNames: Readonly<Record<string, string>>
}

export const defaultIdeStrings: IdeStrings = {
	commandPlaceholder: 'Command…',
	addPlaceholder: 'Add to toolbar…',
	runPlaceholder: 'Command…',
	consoleTitle: 'Console command box',
	searchHint: 'Search and run a command',
	filterPlaceholder: 'Filter…',
	filterAriaLabel: 'Filter options',
	noMatches: 'No matches',
	noMatchingCommands: 'No matching commands',
	emptyDropZone: 'Empty — drag tools here',
	editToolbars: 'Edit toolbars',
	doneEditing: 'Done editing',
	consoleAriaLabel: 'Palette console',
	closeConsole: 'Close console',
	moreFallback: 'More',
	inspectTitle: 'Inspect',
	addToToolbarTitle: 'Add to toolbar',
	detailsTitle: 'Details',
	configureTitle: 'Configure',
	previewTitle: 'Preview',
	detailsEmpty:
		'Click a toolbar item to inspect its presentation, or select a point or control on the left to add it to a toolbar.',
	cannotAdd: 'This entry cannot be added to a toolbar.',
	labelKey: 'Label',
	iconKey: 'Icon',
	hintKey: 'Hint',
	controlKey: 'Control',
	toneKey: 'Tone',
	openModeKey: 'Open mode',
	closeOnClickKey: 'Close on click',
	statusKeyKey: 'Status key',
	displayNumberKey: 'Display number',
	showTextKey: 'Show text',
	filterListKey: 'Filter list',
	deleteKey: 'Delete',
	deleteTool: 'Delete tool',
	deleteToolbar: 'Delete toolbar',
	toneNeutral: 'Neutral',
	toneAccent: 'Accent',
	openHover: 'Hover',
	openToggle: 'Toggle',
	controlNames: {
		toggle: 'Toggle',
		select: 'Select',
		segmented: 'Segmented',
		slider: 'Slider',
		drawerSlider: 'Drawer slider',
		stepper: 'Stepper',
		stars: 'Stars',
		commandBox: 'Command box',
		drawer: 'Drawer',
		status: 'Status',
		theme: 'Theme',
		button: 'Button',
	},
}

/** Merge a partial override over the English default.
 *
 * Scalar fields replace; `controlNames` merges per control id so a
 * consumer can rename one control without repeating the whole map.
 */
export function resolveIdeStrings(override?: Partial<IdeStrings>): IdeStrings {
	if (override === undefined) return defaultIdeStrings
	return {
		...defaultIdeStrings,
		...override,
		...(override.controlNames !== undefined
			? { controlNames: { ...defaultIdeStrings.controlNames, ...override.controlNames } }
			: {}),
	}
}
