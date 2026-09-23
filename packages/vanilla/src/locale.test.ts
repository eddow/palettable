/**
 * `@palettable/vanilla` — locale switch (intl seam probe).
 *
 * The IDE owns the catalog locale: `stringsForLocale` bundles flow into
 * `core.strings` (`syncCatalogStrings`) plus chrome (`currentStrings`) and
 * toolbar dictionaries (`currentDisplay`). Switching the `locale` valued
 * point re-renders borders + console with no definition rebuild.
 */
import { ConsoleStore, PaletteCore } from '@palettable/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createIDE } from './ide.js'

const hosts: HTMLElement[] = []
afterEach(() => {
	for (const host of hosts.splice(0)) host.remove()
})

function setup() {
	const core = new PaletteCore(
		[
			{ id: 'lamp', label: 'Lamp', type: 'boolean' },
			{
				id: 'locale',
				label: 'Language',
				type: 'enum',
				constraints: { options: [{ value: 'en' }, { value: 'fr' }] },
			},
		],
		{
			initialValues: { lamp: false, locale: 'en' },
			initialLayout: {
				version: 1,
				borders: {
					top: [
						[
							{
								space: 1,
								toolbar: [
									{ point: 'lamp', control: 'toggle' },
									{ point: 'locale', control: 'segmented' },
								],
							},
						],
					],
					right: [],
					bottom: [],
					left: [],
				},
			},
		}
	)
	const consoleStore = new ConsoleStore()
	const host = document.createElement('div')
	document.body.append(host)
	hosts.push(host)
	const ide = createIDE(host, {
		core,
		consoleStore,
		isEditable: () => false,
		stringsForLocale: (locale) =>
			locale === 'fr'
				? {
						ide: { commandPlaceholder: 'Commande…' },
						catalog: { toggle: (label: string) => `Basculer ${label}` },
						pointLabels: { lamp: 'Lampe' },
					}
				: undefined,
	})
	return { core, consoleStore, ide, host }
}

describe('locale switch', () => {
	it('toolbar label follows the bundle dictionary (no rebuild)', () => {
		const { core, ide, host } = setup()
		expect((host.querySelector('.toolbar-item-content button') as HTMLElement)?.title).toBe('Lamp')
		core.values.set('locale' as never, 'fr' as never)
		expect((host.querySelector('.toolbar-item-content button') as HTMLElement)?.title).toBe('Lampe')
		ide.dispose()
	})

	it('catalog strings follow the bundle (IDE owns core.strings)', () => {
		const { core, ide } = setup()
		expect(core.strings.toggle('Lamp')).toBe('Toggle Lamp')
		core.values.set('locale' as never, 'fr' as never)
		expect(core.strings.toggle('Lamp')).toBe('Basculer Lamp')
		ide.dispose()
	})

	it('unknown locale falls back to English', () => {
		const { core, ide, host } = setup()
		core.values.set('locale' as never, 'fr' as never)
		expect((host.querySelector('.toolbar-item-content button') as HTMLElement)?.title).toBe('Lampe')
		core.values.set('locale' as never, 'de' as never)
		expect((host.querySelector('.toolbar-item-content button') as HTMLElement)?.title).toBe('Lamp')
		expect(core.strings.toggle('Lamp')).toBe('Toggle Lamp')
		ide.dispose()
	})
})
