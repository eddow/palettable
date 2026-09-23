/**
 * Vanilla Stellar Outpost demo — EN/FR dictionaries (intl demo).
 *
 * Consumer-owned locale tables: the demo is the only place that knows
 * French. Core ships `defaultCatalogStrings` (English), vanilla ships
 * `defaultIdeStrings` (English); this module holds the FR overrides plus
 * per-point label/hint/option text keyed by point id.
 *
 * Switching is reactive via the `locale` valued point (see `demoPoints`):
 * `main.ts` subscribes to `core.values` and re-resolves both tables per
 * render through `IdeOptions.stringsForLocale` + `core.strings` override
 * maps. `document.documentElement.lang` follows as a side effect.
 */
import type { CatalogStrings } from '@palettable/core'
import type { IdeStrings, VanillaLocaleBundle } from '@palettable/vanilla'

export type DemoLocale = 'en' | 'fr'

export const DEMO_LOCALES: readonly DemoLocale[] = ['en', 'fr']

export function isDemoLocale(value: unknown): value is DemoLocale {
	return value === 'en' || value === 'fr'
}

/** FR catalog sentence templates + keyword families (core seam). */
export const FR_CATALOG_STRINGS: Partial<CatalogStrings> = {
	toggle: (label) => `Basculer ${label}`,
	enable: (label) => `Activer ${label}`,
	disable: (label) => `Désactiver ${label}`,
	setValue: (label) => `Régler ${label}`,
	setTo: (label, valueLabel) => `Régler ${label} sur ${valueLabel}`,
	setGeneric: (label) => `Régler ${label}…`,
	increase: (label) => `Augmenter ${label}`,
	decrease: (label) => `Diminuer ${label}`,
	increaseGeneric: (label) => `Augmenter ${label}…`,
	decreaseGeneric: (label) => `Diminuer ${label}…`,
	adjust: (label) => `Ajuster ${label}`,
	incrementBy: (label, delta) => `Augmenter ${label} de ${delta}`,
	decrementBy: (label, delta) => `Diminuer ${label} de ${delta}`,
	runCommand: 'Exécuter la commande',
	addAction: 'Ajouter une action',
	addTool: 'Ajouter un outil',
	addValued: (type) => `Ajouter un outil ${type}`,
	addControlOnly: 'Ajouter un contrôle seul',
	chooseValue: 'Choisir la valeur lors de l’association',
	chooseStep: 'Choisir le pas lors de l’association',
	presetToggle: 'Basculer',
	presetOn: 'Activé',
	presetOff: 'Désactivé',
	presetRow: (label, preset) => `${label} → ${preset} (préréglage)`,
	presetMeta: 'Préréglage — bascule sur la barre',
	controlAddToolbar:
		'Contrôle — ajouter à la barre ; la valeur se choisit sur la barre ou dans l’inspecteur',
	controlOnlyItem: 'Contrôle seul',
	toolbarCommand: 'Commande de barre',
	configureInInspector: 'Contrôle — à configurer dans l’inspecteur',
	controlParen: (label) => `${label} (contrôle)`,
	configureOnOff: 'Contrôle — activer/désactiver dans l’inspecteur',
	chooseMode: 'Contrôle — choisir le mode dans l’inspecteur',
	numericField: 'Contrôle — champ numérique dans l’inspecteur',
	toggleKeywords: ['basculer', 'inverser', 'commuter'],
	onKeywords: ['activer', 'oui', 'vrai', 'allumer'],
	offKeywords: ['desactiver', 'non', 'faux', 'eteindre', 'effacer'],
	stepUpKeywords: ['augmenter', 'accroitre', 'plus', 'monter'],
	stepDownKeywords: ['diminuer', 'reduire', 'moins', 'baisser'],
	setValueKeywords: ['regler', 'valeur'],
	chooseKeyword: 'choisir',
	addToolKeywords: ['ajouter', 'outil'],
	addControlKeywords: ['ajouter', 'controle', 'boite'],
	consoleKeywords: ['console', 'terminal', 'commande', 'invite', 'shell'],
	pointLabels: { console: 'Console' },
}

/** FR adapter chrome (vanilla seam). */
export const FR_IDE_STRINGS: Partial<IdeStrings> = {
	commandPlaceholder: 'Commande…',
	addPlaceholder: 'Ajouter à la barre…',
	runPlaceholder: 'Commande…',
	consoleTitle: 'Boîte de commande de la console',
	searchHint: 'Chercher et exécuter une commande',
	filterPlaceholder: 'Filtrer…',
	filterAriaLabel: 'Filtrer les options',
	noMatches: 'Aucun résultat',
	noMatchingCommands: 'Aucune commande correspondante',
	emptyDropZone: 'Vide — glissez des outils ici',
	editToolbars: 'Modifier les barres',
	doneEditing: 'Terminé',
	consoleAriaLabel: 'Console Palettable',
	closeConsole: 'Fermer la console',
	moreFallback: 'Plus',
	inspectTitle: 'Inspecter',
	addToToolbarTitle: 'Ajouter à la barre',
	detailsTitle: 'Détails',
	configureTitle: 'Configurer',
	previewTitle: 'Aperçu',
	detailsEmpty:
		'Cliquez sur un élément de la barre pour inspecter sa présentation, ou sélectionnez un point ou un contrôle à gauche pour l’ajouter à une barre.',
	cannotAdd: 'Cette entrée ne peut pas être ajoutée à une barre.',
	labelKey: 'Libellé',
	iconKey: 'Icône',
	hintKey: 'Astuce',
	controlKey: 'Contrôle',
	toneKey: 'Ton',
	openModeKey: 'Mode d’ouverture',
	closeOnClickKey: 'Fermer au clic',
	statusKeyKey: 'Clé de statut',
	displayNumberKey: 'Afficher le nombre',
	showTextKey: 'Afficher le texte',
	filterListKey: 'Filtrer la liste',
	deleteKey: 'Supprimer',
	deleteTool: 'Supprimer l’outil',
	deleteToolbar: 'Supprimer la barre',
	toneNeutral: 'Neutre',
	toneAccent: 'Accent',
	openHover: 'Survol',
	openToggle: 'Bascule',
	controlNames: {
		toggle: 'Interrupteur',
		select: 'Liste',
		segmented: 'Segmenté',
		slider: 'Curseur',
		drawerSlider: 'Curseur tiroir',
		stepper: 'Pas à pas',
		stars: 'Étoiles',
		commandBox: 'Boîte de commande',
		drawer: 'Tiroir',
		status: 'Statut',
		theme: 'Thème',
		button: 'Bouton',
	},
}

/**
 * FR per-point label/hint/option text, keyed by point id. Consulted as
 * render-time dictionaries (toolbar tools via `HeadContext.display`,
 * catalog rows via `CatalogStrings.pointLabels/optionLabels`) —
 * definitions stay English, no rebuild on switch.
 */
export const FR_POINT_LABELS: Record<string, string> = {
	autoOxygen: 'Assistance respiratoire',
	colonyTheme: 'Ambiance de l’avant-poste',
	powerPriority: 'Priorité énergétique',
	alertLevel: 'Niveau de menace',
	theme: 'Thème',
	commandBox: 'Commande',
	moreDrawer: 'Plus',
	missionTime: 'Temps de mission',
	taxRate: 'Taxe coloniale',
	gameSpeed: 'Vitesse de simulation',
	solarEfficiency: 'Rendement solaire',
	satisfaction: 'Satisfaction',
	locale: 'Langue',
	shieldGenerator: 'Boucliers déflecteurs',
	fastMode: 'Mode hyper-tic',
	emergencyProtocol: 'Confinement d’urgence',
	saveGame: 'Sauvegarder la colonie',
	resetSimulation: 'Réinitialiser la colonie',
	console: 'Console développeur',
	shipStatus: 'Vaisseau sélectionné',
	shipShields: 'Boucliers du vaisseau',
	shipPower: 'Réacteur du vaisseau',
	fireTorpedo: 'Tirer une torpille',
}

export const FR_POINT_HINTS: Record<string, string> = {
	autoOxygen: 'Interrupteur compact',
	colonyTheme: 'Liste (enum)',
	powerPriority: 'Segmenté (enum)',
	alertLevel: 'Segmenté (enum)',
	theme: 'Cycle du thème (point-vide)',
	commandBox: 'Chercher et exécuter une commande',
	moreDrawer: 'Tiroir imbriqué',
	missionTime: 'Lecture de statut (point-vide)',
	taxRate: 'Curseur numérique',
	gameSpeed: 'Curseur numérique',
	solarEfficiency: 'Pas à pas numérique',
	satisfaction: 'Note par étoiles',
	locale: 'Drapeau de langue (enum)',
	shieldGenerator: 'Interrupteur compact',
	fastMode: 'Interrupteur compact',
	emergencyProtocol: 'Action — exécuter',
	saveGame: 'Action — exécuter',
	resetSimulation: 'Action — exécuter',
	console: 'Action — exécuter',
	shipStatus: 'Lecture de statut (point-vide)',
	shipShields: 'Interrupteur compact',
	shipPower: 'Curseur numérique',
	fireTorpedo: 'Action — exécuter',
}

export const FR_OPTION_LABELS: Record<string, Record<string, string>> = {
	colonyTheme: { mars: 'Mars', neptune: 'Neptune', void: 'Vide', matrix: 'Matrice' },
	powerPriority: {
		research: 'Recherche',
		defense: 'Défense',
		economy: 'Économie',
		balanced: 'Équilibrée',
	},
	alertLevel: { green: 'Vert', yellow: 'Jaune', red: 'Rouge', black: 'Noir' },
	locale: { en: 'Anglais', fr: 'Français' },
	theme: { light: 'Clair', dark: 'Sombre', system: 'Système' },
}

/** Resolve the full locale bundle (`undefined` = English default).
 *
 * Render-time dictionaries live top-level (authoritative);
 * `catalog.pointLabels` / `catalog.optionLabels` are kept as a legacy
 * alias until `LocaleBundle` collapses the duplication.
 */
export function localeBundleForLocale(locale: DemoLocale): VanillaLocaleBundle | undefined {
	if (locale !== 'fr') return undefined
	return {
		ide: FR_IDE_STRINGS,
		catalog: FR_CATALOG_STRINGS,
		pointLabels: FR_POINT_LABELS,
		pointHints: FR_POINT_HINTS,
		optionLabels: FR_OPTION_LABELS,
	}
}

/** Resolve the catalog override for a locale (`undefined` = English default). */
export function catalogStringsForLocale(locale: DemoLocale): Partial<CatalogStrings> | undefined {
	return localeBundleForLocale(locale)?.catalog
}

/** Resolve the IDE chrome override for a locale (`undefined` = English default). */
export function ideStringsForLocale(locale: DemoLocale): Partial<IdeStrings> | undefined {
	return localeBundleForLocale(locale)?.ide
}
