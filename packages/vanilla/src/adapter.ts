import { type AnyPoint, PaletteCore, type PaletteCoreOptions } from '@palettable/core'

export type VanillaAdapterOptions = PaletteCoreOptions & {
	/** Root element the adapter renders into. Defaults to a fresh `<div>`. */
	target?: HTMLElement
}

/**
 * Minimal vanilla-DOM adapter: owns a `PaletteCore`, renders its points as
 * plain DOM, and re-renders on every value change. Layout rendering,
 * drag sessions and head components land here as the adapter grows —
 * core stays DOM-free.
 */
export class VanillaAdapter {
	readonly core: PaletteCore
	readonly root: HTMLElement
	private unsubscribe: (() => void) | null = null

	constructor(points: readonly AnyPoint[], options: VanillaAdapterOptions = {}) {
		const { target, ...coreOptions } = options
		this.core = new PaletteCore(points, coreOptions)
		this.root = target ?? document.createElement('div')
		this.root.dataset.palettableVanilla = ''
	}

	/** Mount: subscribe to the value store and render once. Idempotent. */
	mount(): void {
		if (this.unsubscribe !== null) return
		this.unsubscribe = this.core.subscribe(() => this.render())
		this.render()
	}

	/** Unmount: drop subscriptions, keep values + layout. */
	dispose(): void {
		this.unsubscribe?.()
		this.unsubscribe = null
		this.core.dispose()
	}

	private render(): void {
		this.root.textContent = ''
		const list = document.createElement('ul')
		for (const point of this.core.points) {
			const item = document.createElement('li')
			item.dataset.pointId = point.id
			item.textContent = point.label
			list.append(item)
		}
		this.root.append(list)
	}
}
