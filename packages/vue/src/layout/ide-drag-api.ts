/**
 * `@palettable/vue` — IDE drag API (provided by `PaletteIde`, injected
 * by nested renderers that sit outside the border emit chain).
 *
 * Drawer-child tracks (`DrawerChildTrack`) and the console parking stack
 * (`ConsoleParking`) render `ToolbarBar`s whose Vue emits cannot reach
 * the shell through props alone (drawer popups nest inside head
 * components). They inject this API and call it directly — same handlers
 * the border emit chain reaches.
 */

import type { PaletteRegion, Toolbar, ToolbarItem } from '@palettable/core'
import type { InjectionKey } from 'vue'

export type IdeDragApi = {
	barPointerdown(event: PointerEvent, toolbar: Toolbar, region: PaletteRegion): void
	barPointermove(event: PointerEvent, toolbar: Toolbar): void
	barPointerover(event: PointerEvent, toolbar: Toolbar): void
	guardPointerdown(event: PointerEvent, toolbar: Toolbar, item: ToolbarItem): void
	inspect(item: ToolbarItem): void
	parkingPointermove(event: PointerEvent): void
	parkingPointerleave(event: PointerEvent): void
	panelPointermove(event: PointerEvent): void
	panelPointerleave(event: PointerEvent): void
	dragActive(): boolean
	trackDrawerOpen(item: ToolbarItem): void
	trackDrawerClose(item: ToolbarItem): void
	closeUnrelatedDrawers(target: EventTarget | null, spare?: HTMLElement): void
}

export const ideDragApiKey: InjectionKey<IdeDragApi> = Symbol('palettable-ide-drag-api')
