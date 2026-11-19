# First public release

Ship `@palettable/core`, `@palettable/vanilla`, and `@palettable/vue`. A consumer should be able to install either adapter, mount a working palette, and get the same editing behaviour and saved layout from both. Svelte can be reconsidered after publication.

## 1. Restore a reliable baseline

The workspace type check, 532 unit tests and 97 browser tests passed in the November 19 review. The following cases remain open.

- [x] Correct Vue's track registration after a structural edit on a right or bottom border. With two tracks on a reversed border, verify each live track maps to its own rendered element and a subsequent drag paints the intended gap. Assert that releasing the pointer clears the drag marker and highlighted gaps. [done 2026-11-20: single DOM-order mapping in `syncBarRegistryToLiveDom`; `reversed-track-highlight.spec.ts` fails crossed, passes fixed]
- [x] Preserve opaque object values in the Vue lens. Verify that reading an object from a store-backed lens preserves its identity and assigning it back emits zero notifications. [done 2026-11-20: `toRaw` on lens reads, pulls and writes; round-trip test with negative control]
- [x] Make disposed lens reads consistent for previously defined, undefined and newly added keys. Verify the documented disposal behaviour for each case. [done 2026-11-20: live-bag fallback gated on subscribed lenses; post-disposal-added-key test with negative control]

## 2. Verify ownership across the two implementations

- [ ] Trace adding a tool, executing a command, changing a value, saving/restoring a layout, and dragging across tracks from each adapter into core. Core owns point binding, control selection, layout mutations, movement decisions and presenter output. Verify equivalent inputs produce equivalent state and serialized layouts. Start with the duplicated `itemFromAddSelection` in the two adapters and give that conversion one implementation and tests in core. [done 2026-11-19: `itemFromAddSelection` + `AddSelection` live in `core/command-box.ts` with unit tests (tool/action/set/item, drawer track, unknown-point + family-mismatch `undefined`); both adapters re-export from core, all suites green]
- [ ] Compare keyboard normalization, slide measurement, outside-gap projection, highlight cleanup and default-head strings across adapters. Share identical behaviour where it prevents observable drift. Keep browser helpers outside the headless entry point. Keep element ownership, event lifetimes, Vue reactivity and render timing in the respective adapters. Preserve documented adapter exports when relocating helpers.
- [ ] Verify core imports under plain Node and both adapters depend independently on core. Keep demo fixtures and host-specific state in the demos. Record the verified ownership rules in [architecture](../architecture.md).
- [ ] Resolve the outstanding theme API before freezing adapter options. Make the theme tool opt-in, expose a readable and writable light/dark setting in vanilla and a reactive equivalent in Vue, and verify changes are observable with a custom head and with the tool omitted. Document the resulting API in [theming](../theming.md).

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
