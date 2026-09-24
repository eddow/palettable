/**
 * Shared persistence keys for the Stellar Outpost demo.
 *
 * Every adapter demo reads/writes the same localStorage keys so a layout
 * saved in one adapter loads in another.
 */

/** Layout snapshot key (serialized borders + parking). */
export const LAYOUT_STORAGE_KEY = 'palettable-demo-layout-v1'

/** Colony save key (action `saveGame` payload). */
export const COLONY_SAVE_KEY = 'stellar-outpost-save'
