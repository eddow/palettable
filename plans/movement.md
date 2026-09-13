# Movement

> Status: **specs of things to do.** Permanent principles and the implemented
> engine live in `docs/movements.md`.

## The target behaviour (agreed, kept)

1. **Previewing is moving** — a drag session can't be escaped/cancelled; once
   activated, releasing commits whatever is on screen. The moved element is
   removed from its origin **only when added elsewhere**.
2. **Toolbar** moves between stacks and tracks.
3. **Tool → track/stack** creates a singleton toolbar; **tool → toolbar** merges.
4. **Emptying a toolbar removes it** (and its track, if that empties too).
5. **Candidate targets mini-expand** (a few pixels) when the pointer gets near.
6. **Deletion is not drag.** The only ways to remove an editor are:
   - **editing the editor** (a "delete" button on its edit surface), or
   - **moving it to parking, then removing it from parking.**

## TODO

- (re-test, it seems solved) movement hickup: when moving a tool in a toolbar and sdvsncing over the DZ-after item X should place the item at position X+1. Now, it is placed at position X+2.