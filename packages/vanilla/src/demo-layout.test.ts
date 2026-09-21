/**
 * Regression: `rw-combobox` top is one track with two toolbars.
 * The vanilla demo must load it as one track — not split into two.
 */
import { PaletteCore } from '@palettable/core'
import { describe, expect, it } from 'vitest'
import { demoLayoutFor, demoPoints } from '../demo/palette.js'

describe('demo preset track boundaries', () => {
	it('rw-combobox top is one track holding two toolbars', () => {
		const { borders } = demoLayoutFor('rw-combobox')
		expect(borders.top).toHaveLength(1)
		expect(borders.top[0]).toHaveLength(2)
	})

	it('live load preserves the single top track (the main.ts path)', () => {
		const { borders, parking } = demoLayoutFor('rw-combobox')
		const core = new PaletteCore(demoPoints(), {
			initialLayout: { borders, parking },
		})
		const top = core.layout.getLayout().borders.top
		expect(top).toHaveLength(1)
		expect(top[0]).toHaveLength(2)
	})

	it('setLayout with a live layout preserves the single top track (preset switch)', () => {
		const core = new PaletteCore(demoPoints(), {
			initialLayout: demoLayoutFor('rw-command-first'),
		})
		const { borders, parking } = demoLayoutFor('rw-combobox')
		core.layout.setLayout({ borders, parking })
		const top = core.layout.getLayout().borders.top
		expect(top).toHaveLength(1)
		expect(top[0]).toHaveLength(2)
	})

	it('serialized snapshot round-trip keeps the single top track', () => {
		const { borders, parking } = demoLayoutFor('rw-combobox')
		const core = new PaletteCore(demoPoints(), {
			initialLayout: { borders, parking },
		})
		const snapshot = core.layout.getSnapshot()
		const reloaded = new PaletteCore(demoPoints(), { initialLayout: snapshot })
		const top = reloaded.layout.getLayout().borders.top
		expect(top).toHaveLength(1)
		expect(top[0]).toHaveLength(2)
	})
})
