/**
 * `@palettable/core` — palette error taxonomy.
 *
 * `PaletteError` is thrown for consumer mistakes (unknown point, bad spec,
 * invalid layout location, failed validation). Adapters may catch it to
 * render diagnostics; it never carries DOM or framework state.
 */
export class PaletteError extends Error {
	override name = 'PaletteError'
}

/**
 * Thrown by rejected bag writes (locked `ValuesBag.set` / `setTree` — see
 * `plans/context.md` §2.4–§2.5). Adapters catch it to surface error feedback
 * or revert a local optimistic UI update.
 */
export class PaletteWriteError extends PaletteError {
	override name = 'PaletteWriteError'
}
