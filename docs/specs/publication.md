# First public release

Ship `@palettable/core`, `@palettable/vanilla`, and `@palettable/vue`. A consumer should be able to install either adapter, mount a working palette, and get the same editing behaviour and saved layout from both. Svelte can be reconsidered after publication.

## 1. Restore a reliable baseline

The workspace type check, 532 unit tests and 97 browser tests passed in the November 19 review. The following cases remain open.

- [x] Correct Vue's track registration after a structural edit on a right or bottom border. With two tracks on a reversed border, verify each live track maps to its own rendered element and a subsequent drag paints the intended gap. Assert that releasing the pointer clears the drag marker and highlighted gaps. [done 2026-11-20: single DOM-order mapping in `syncBarRegistryToLiveDom`; `reversed-track-highlight.spec.ts` fails crossed, passes fixed]
- [x] Preserve opaque object values in the Vue lens. Verify that reading an object from a store-backed lens preserves its identity and assigning it back emits zero notifications. [done 2026-11-20: `toRaw` on lens reads, pulls and writes; round-trip test with negative control]
- [x] Make disposed lens reads consistent for previously defined, undefined and newly added keys. Verify the documented disposal behaviour for each case. [done 2026-11-20: live-bag fallback gated on subscribed lenses; post-disposal-added-key test with negative control]

## 2. Verify ownership across the two implementations

- [x] Verify equivalent state and serialized layouts for adding a tool, running a command, updating a value, saving/restoring and cross-track dragging through both adapters. The shared add-selection conversion and its core tests are in place; driven through the adapter-pair test harness (`packages/vue/src/layout/adapter-pair.test.ts`, which mounts both `createIDE` + `PaletteIde` and asserts equivalent values + byte-identical `JSON.stringify(getSnapshot())` after each of the five workflows). The browser suite covers interaction, not layout-bytes parity. [done 2026-11-20: single-process Vue-hosted harness (test-only relative import of the vanilla IDE, no package dependency); add via catalog creation session from shared `itemFromAddSelection`, run via DOM button click asserting the same `core.run` runnable, value via DOM toggle, save/restore via snapshot bytes + `setLayout` + fresh-core reload, cross-track drag via real session `over()`; `docs/testing.md` documents the harness]
- [x] Make theme opt-in consistent through nested Vue drawers and previews, vanilla keyboard selection and details, and explicit `itemControls` in both adapters. With theme disabled, exercise a persisted theme item inside a drawer and an add search submitted with Enter. Check for an absent tool, add choice and root write. [done 2026-11-20: shared `addSources()` in both IDEs (visible list + Enter + details lookup share one exclusion set; `item:` control-only `theme` row filtered without opt-in); Vue `themeEnabled` threaded through `ToolbarBar`→`ToolbarItemNode`→`HeadItem`→`DrawerTool`→`DrawerChildTrack` and console preview; vanilla `renderHeadItem` gate + preview context carry the active mirror; tests: vanilla add-list/Enter/itemControls exclusions, Vue nested-drawer + explicit-itemControls exclusions]
- [x] Preserve caller ownership of a shared theme setting when a vanilla IDE is disposed. Mount two consumers with one setting, dispose the first and verify the second still receives host writes and external root edits. Exercise a mounted custom head with the theme tool omitted. [done 2026-11-20: vanilla `themeOwned` vs `themeSetting` split — `dispose()` only disposes the owned mirror; shared setting survives first-IDE dispose; custom-head render against the mirror covered in value-sync.test.ts]
- [x] Reconcile the theme guide with both demos' actual root writes and system-preference handling. Specify when the resolved theme updates and verify the documented behaviour. [done 2026-11-20: theming.md states per-call `matchMedia` sampling, no `change` listener, re-apply-to-resample contract, and that both demos keep their own `applyTheme()` page-chrome helper; adapter docblocks updated; per-call sampling verified by unit test]

## 3. Prove the published entry points

- [ ] Exercise the public `enum-from` API through both adapters. Bind a non-enum valued point to named presets, select a preset and check the underlying value, then update the source and check the displayed selection. Document how consumers supply the predefined values.
- [ ] Verify keyword behaviour with aliases that differ from the visible labels. Cover tool and option keywords in command-box filtering, and show how to specify an enum subset by filtering options by keyword. Check that vanilla and Vue expose the same results using core's matching rules.
- [ ] Include all three libraries in the root build. Export and bundle the Vue IDE component and its types. Exercise it through the package import currently bypassed by the demo's direct source import.
- [ ] Pack each library with pnpm and install the resulting tarballs in clean consumer projects under `tmp/`. Inspect the packed manifests, runtime dependency versions, Vue compatibility, licence and file lists. Verify exported ESM, CommonJS, declarations, core stylesheet paths and the advertised vanilla browser bundle resolve from the installed artifacts.
- [ ] Mount a minimal palette with each installed adapter using only documented imports. Exercise a value update, command execution and an edit/save/restore cycle. Use these examples to verify the install and quick-start instructions for both adapters.
- [ ] Run the workspace checks, builds, unit suites and full Playwright suite, including both adapter projects and the default-head project. Record the commands in [testing](../testing.md).

## 4. Publish and verify

- [ ] Confirm the release versions, target registry, scope access and distribution tag. Publish core first, then the two adapters against the released core version.
- [ ] Install the released versions from the registry in fresh consumer projects and repeat the documented quick starts. Close the roadmap once all three packages resolve and both examples work. Move enduring release instructions into `docs/` as tasks are verified.
