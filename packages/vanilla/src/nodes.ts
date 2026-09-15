/**
 * `@palettable/vanilla` — stable node registry for the fine-DOM IDE.
 *
 * One `HTMLElement` per live layout object, keyed by `===` identity:
 * toolbars → `.toolbar`, items → `.toolbar-item` wrappers, tracks →
 * `.toolbar-track`, borders → `.toolbar-border`, parking rows →
 * `.palette-parking-row`. Gap nodes (stack / track / item spaces) are owned
 * by their parent container and re-created with it — they carry no state, so
 * identity tracking buys nothing there.
 *
 * The registry never mutates layout: it only observes live objects returned
 * by `core.layout.getLayout()` (read-only contract) and core `LayoutOp`
 * events. Structural commits (`moveItem` / `moveToolbar` / `insertItem` /
 * `removeItem`) preserve object identity, so a `Map` lookup stays valid
 * across mutations; `setLayout()` (whole-layout loads) invalidates
 * everything and the adapter rebuilds from scratch.
 */

import type { Toolbar, ToolbarItem, Track } from '@palettable/core'

export type NodeKind = 'toolbar' | 'item' | 'track' | 'row'

type NodeRecord = {
	readonly kind: NodeKind
	readonly node: HTMLElement
}

/**
 * Stable identity map: live layout object → rendered element.
 * Drawer child toolbars share the same map (same `===` keys, same ops).
 */
export class NodeRegistry {
	private nodes = new Map<object, NodeRecord>()

	/** Look up the element for a live toolbar / item / track object. */
	get(key: object): HTMLElement | undefined {
		return this.nodes.get(key)?.node
	}

	/** Look up the kind of a registered object (for op dispatch). */
	kindOf(key: object): NodeKind | undefined {
		return this.nodes.get(key)?.kind
	}

	/** Register a toolbar element (keyed by the live `Toolbar` array). */
	setToolbar(toolbar: Toolbar, node: HTMLElement): void {
		this.nodes.set(toolbar, { kind: 'toolbar', node })
	}

	/** Register an item wrapper (keyed by the live `ToolbarItem` object). */
	setItem(item: ToolbarItem, node: HTMLElement): void {
		this.nodes.set(item, { kind: 'item', node })
	}

	/** Register a track element (keyed by the live `Track` array). */
	setTrack(track: Track, node: HTMLElement): void {
		this.nodes.set(track, { kind: 'track', node })
	}

	/** Register a parking row element (keyed by the live `Toolbar` array). */
	setRow(toolbar: Toolbar, node: HTMLElement): void {
		this.nodes.set(toolbar, { kind: 'row', node })
	}

	/** Drop one object (after `removeItem` / prune victims). */
	delete(key: object): void {
		this.nodes.delete(key)
	}

	/** Drop everything (after `setLayout` / `replace` op / dispose). */
	clear(): void {
		this.nodes.clear()
	}

	/** Current registration count (introspection for tests). */
	get size(): number {
		return this.nodes.size
	}
}
