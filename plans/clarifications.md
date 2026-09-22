## Handoff context.can

Fixed stale-closure toggle/stepper clicks in `packages/vanilla/src/head.ts`: `renderToggle` captured `view.toggle` and `renderStepper` captured `view.value` at render time, so Hyper-tick never unticked and repeated stepper clicks replayed the same write. Both now re-read live value at click time; added `value-sync.test.ts` click on/off regression (vanilla 84/84, check clean). Investigated ship-context tools (`shipShields`/`shipPower` with `uses: ['ship']`, no `can`): valued presenters (`toggle`/`slider`) expose no `can`, only `button`/`status` do, so `renderToggle`/`renderSlider`/`updateToolNode` never disable on absent context and clicks throw skeleton errors via `writeValue`/`run`. `bindTool` also only wires `subscribeCan` for action buttons, not valued tools. Remains: decide contract (skeleton `undefined` value implies disabled for valued context tools vs explicit `can` on valued points), expose it from presenters, honor it in render + `updateToolNode` + `bindTool`, guard clicks; verify against `tests/e2e/ship-context.spec.ts` (no-selection skeleton, selection hydrate, deselect back to skeleton).

## TODOs

- isolate demo data for it to be usable by all demos
- check edition in drawer

## unresolvables?

When a toolbar is slided, the mouse-over can unfortunately point to several element

`T g U[X] h V` - where `T`, `U`, `V` are toolbars - `U` is composed of tool `X` - and `g`, `h` are gaps between toolbars

When moving `U`, the mouse-over can be over g, U, X, h - or even the track element simply

Problem: the last in-toolbar-DZ of T and the first of V have to be highlighted, and it just changes on so many edge-cases (when moving, if we just popped out `X` out of `T` or `V`, ...)

My proposition: When a toolbar is moving, its mouse-move as well as the ones from its tools as well as the ones from the gaps around (`g`, `h`) are deactivated, so that only the track catch the mouse-move.
The other items of the track (tools from `T`, other gaps, ...) should catch and stop a mouse-move event
Hence, when moving on the track, just keep the 2 nearest/extreme toolbar-DZ in the surrounding toolbars as well as the in-stack DZs highlighted