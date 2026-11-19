/**
 * `@palettable/vue` — structural revision injection key.
 *
 * The core layout mutates in place (`getLayout()` returns the same live
 * object across commits), so a `computed` caching that reference never
 * notifies (same `Object.is` reference). Every renderer that reads live
 * layout arrays must additionally track this revision counter — bumped by
 * the IDE shell on every `structure` event — so commits re-render even
 * though the array references are stable.
 */
import type { InjectionKey, Ref } from 'vue'

export const layoutRevisionKey: InjectionKey<Ref<number>> = Symbol('palettable-layout-revision')
