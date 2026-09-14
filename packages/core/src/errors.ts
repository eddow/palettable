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
