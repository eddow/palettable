/**
 * Fixed ship roster for the fleet context demo: one-or-none selected via
 * the adapter chrome. Selection swaps a flat `ship` ValuesBag (`shipId` +
 * per-ship props); None removes the bag. Ship point ids never enter the
 * root bag / `CONSUMER_DEFAULTS` — no-selection renders the core-contract
 * fallback (disabled + placeholder / skeleton).
 */

export const SHIP_ROSTER = [
	{ id: 'aurora', name: 'Aurora', icon: '🚀' },
	{ id: 'borealis', name: 'Borealis', icon: '🛸' },
	{ id: 'cinder', name: 'Cinder', icon: '🛰️' },
] as const

export type ShipId = (typeof SHIP_ROSTER)[number]['id']

/** Per-ship property values, keyed by ship id (flat keys land in the `ship` bag). */
export const SHIP_VALUES: Record<ShipId, { shipShields: boolean; shipPower: number }> = {
	aurora: { shipShields: true, shipPower: 3 },
	borealis: { shipShields: false, shipPower: 1.5 },
	cinder: { shipShields: true, shipPower: 4.5 },
}

export function shipById(id: string | undefined): (typeof SHIP_ROSTER)[number] | undefined {
	return SHIP_ROSTER.find((ship) => ship.id === id)
}
