import { VanillaAdapter } from '@palettable/vanilla'
import { describe, expect, it } from 'vitest'

describe('VanillaAdapter', () => {
	it('renders one row per point', () => {
		const adapter = new VanillaAdapter([
			{ id: 'saveGame', label: 'Save game', type: 'action', run() {} },
		])
		adapter.mount()
		expect(adapter.root.querySelectorAll('li').length).toBe(1)
		adapter.dispose()
	})
})
