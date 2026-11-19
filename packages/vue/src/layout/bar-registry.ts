/**
 * `@palettable/vue` — live element registry (adapter-owned node map).
 *
 * Vue-idiom mirror of the vanilla `NodeRegistry`: maps live layout
 * objects (`Toolbar` / `Track`) to their rendered elements so drag
 * highlight + slide measuring resolve nodes by identity (`===`), never
 * by position. `ToolbarBar` / `BorderTrack` register on mount + update
 * and unregister on unmount; the IDE shell (`PaletteIde`) owns the
 * single instance and provides it via `barRegistryKey`.
 */

import type { Toolbar, ToolbarItem, Track } from '@palettable/core'
import type { InjectionKey } from 'vue'

export type BarRegistry = {
	setToolbar(toolbar: Toolbar, el: HTMLElement): void
	toolbarOf(el: Element): Toolbar | undefined
	elementOfToolbar(toolbar: Toolbar): HTMLElement | undefined
	deleteToolbar(toolbar: Toolbar): void
	setTrack(track: Track, el: HTMLElement): void
	elementOfTrack(track: Track): HTMLElement | undefined
	deleteTrack(track: Track): void
	setItem(item: ToolbarItem, el: HTMLElement): void
	elementOfItem(item: ToolbarItem): HTMLElement | undefined
	deleteItem(item: ToolbarItem): void
	clear(): void
}

export const barRegistryKey: InjectionKey<BarRegistry> = Symbol('palettable-bar-registry')

export function createBarRegistry(): BarRegistry {
	const toolbarEls = new Map<Toolbar, HTMLElement>()
	const elToolbars = new WeakMap<HTMLElement, Toolbar>()
	const trackEls = new Map<Track, HTMLElement>()
	const itemEls = new Map<ToolbarItem, HTMLElement>()
	return {
		setToolbar(toolbar, el) {
			toolbarEls.set(toolbar, el)
			elToolbars.set(el, toolbar)
		},
		toolbarOf(el) {
			const bar = el.closest?.('.toolbar')
			if (!(bar instanceof HTMLElement)) return undefined
			return elToolbars.get(bar)
		},
		elementOfToolbar(toolbar) {
			const el = toolbarEls.get(toolbar)
			if (!(el instanceof HTMLElement) || !el.isConnected) return undefined
			return el
		},
		deleteToolbar(toolbar) {
			const el = toolbarEls.get(toolbar)
			if (el) elToolbars.delete(el)
			toolbarEls.delete(toolbar)
		},
		setTrack(track, el) {
			trackEls.set(track, el)
		},
		elementOfTrack(track) {
			const el = trackEls.get(track)
			if (!(el instanceof HTMLElement) || !el.isConnected) return undefined
			return el
		},
		deleteTrack(track) {
			trackEls.delete(track)
		},
		setItem(item, el) {
			itemEls.set(item, el)
		},
		elementOfItem(item) {
			const el = itemEls.get(item)
			if (!(el instanceof HTMLElement) || !el.isConnected) return undefined
			return el
		},
		deleteItem(item) {
			itemEls.delete(item)
		},
		clear() {
			toolbarEls.clear()
			trackEls.clear()
			itemEls.clear()
		},
	}
}
