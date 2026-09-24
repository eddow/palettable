/**
 * Shared key bindings for the Stellar Outpost demo.
 */
import type { KeyBindings } from '@palettable/core'

export const demoKeys: KeyBindings = {
	'`': { kind: 'action', point: 'console' },
	N: { kind: 'toggle', point: 'autoOxygen' },
	S: { kind: 'toggle', point: 'shieldGenerator' },
	E: { kind: 'action', point: 'emergencyProtocol' },
	'Ctrl+S': { kind: 'action', point: 'saveGame' },
	'+': { kind: 'inc', point: 'gameSpeed', delta: 0.5 },
	'-': { kind: 'dec', point: 'gameSpeed', delta: 0.5 },
	'1': { kind: 'set', point: 'alertLevel', value: 'green' },
	'2': { kind: 'set', point: 'alertLevel', value: 'yellow' },
	'3': { kind: 'set', point: 'alertLevel', value: 'red' },
}
