import { describe, expect, it } from 'vitest'
import { NodeRegistry } from './nodes.js'

describe('NodeRegistry', () => {
	it('registers and looks up toolbars, items, tracks, and rows by identity', () => {
		const registry = new NodeRegistry()
		const toolbar = [{ point: 'a' }]
		const item = { point: 'a' }
		const track = [{ space: 1, toolbar }]
		const bar = document.createElement('div')
		const wrapper = document.createElement('div')
		const trackEl = document.createElement('div')
		const row = document.createElement('div')
		registry.setToolbar(toolbar, bar)
		registry.setItem(item, wrapper)
		registry.setTrack(track, trackEl)
		registry.setRow(toolbar, row)
		// Row registration overwrites the toolbar key (same live array) —
		// parking rows own their toolbar element, so `row` wins.
		expect(registry.get(toolbar)).toBe(row)
		expect(registry.kindOf(toolbar)).toBe('row')
		expect(registry.get(item)).toBe(wrapper)
		expect(registry.kindOf(item)).toBe('item')
		expect(registry.get(track)).toBe(trackEl)
		expect(registry.kindOf(track)).toBe('track')
		expect(registry.size).toBe(3)
	})

	it('deletes single keys and clears everything', () => {
		const registry = new NodeRegistry()
		const item = { point: 'a' }
		const node = document.createElement('div')
		registry.setItem(item, node)
		expect(registry.get(item)).toBe(node)
		registry.delete(item)
		expect(registry.get(item)).toBe(undefined)
		registry.setItem(item, node)
		registry.clear()
		expect(registry.size).toBe(0)
	})

	it('misses on structural duplicates (identity, not fingerprint)', () => {
		const registry = new NodeRegistry()
		const item = { point: 'a' }
		const twin = { point: 'a' }
		const node = document.createElement('div')
		registry.setItem(item, node)
		expect(registry.get(twin)).toBe(undefined)
	})
})
