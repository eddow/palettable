# First public release

Ship `@palettable/core`, `@palettable/vanilla`, and `@palettable/vue`. A consumer should be able to install either adapter, mount a working palette, and get the same editing behaviour and saved layout from both. Svelte can be reconsidered after publication.

## 1. Restore a reliable baseline

The pre-release review found 525 passing unit tests and three Vue failures in 99 browser tests. The workspace type check passed while the Vue component check failed. Start here so subsequent changes to shared code can be judged against both adapters.

- [ ] Make the Vue package check run `vue-tsc --noEmit -p tsconfig.json`. Repair the undeclared `lastPointerMoveStamp` in `PaletteIde.vue` and verify pointer release clears drag state and gap paint.
- [ ] Reproduce the Vue failures in `abcd-vertical.spec.ts` and `whole-toolbar.spec.ts`. At the first divergent move after extraction, compare the hover target delivered to core, the highlight event core emits, and the gap painted after Vue updates. Fix the layer where the results first differ. Remove the temporary `zz-probe.spec.ts` once the behavioural assertions cover the regression.
- [ ] Fix `useValueLens` so a Vue effect observing a bag key updates on an external store write and a lens write. Cover both with a reactive subscriber, including equal-value writes and disposal.

## 2. Verify ownership across the two implementations

- [ ] Trace adding a tool, executing a command, changing a value, saving/restoring a layout, and dragging across tracks from each adapter into core. Core owns point binding, control selection, layout mutations, movement decisions and presenter output. Verify equivalent inputs produce equivalent state and serialized layouts. Start with the duplicated `itemFromAddSelection` in the two adapters and give that conversion one implementation and tests in core.
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
