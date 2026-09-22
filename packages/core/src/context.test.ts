import { describe, expect, it, vi } from 'vitest'
import { ValuesBag } from './context.js'
import {
	boundBagAt,
	boundValueAt,
	dualSourceValue,
	missingContext,
	readBoundBagKey,
} from './context-display.js'
import { PaletteCore } from './core.js'
import { PaletteError, PaletteWriteError } from './errors.js'
import { isNothingPoint, ROOT_CONTEXT } from './points.js'
import { buttonPresenter } from './presenters.js'

describe('ValuesBag', () => {
	it('reads/writes with Object.is no-op and freezes non-scalars', () => {
		const bag = new ValuesBag<{ name: string; meta: { tag: string } }>()
		expect(bag.get('name')).toBeUndefined()
		bag.set('name', 'file.ts')
		expect(bag.get('name')).toBe('file.ts')
		const meta = { tag: 'x' }
		bag.set('meta', meta)
		expect(bag.get('meta')).toEqual({ tag: 'x' })
		expect(Object.isFrozen(bag.get('meta'))).toBe(true)
		expect(() => {
			;(bag.get('meta') as { tag: string }).tag = 'y'
		}).toThrow(TypeError)
	})

	it('setTree applies all pairs before notifying, returns changed keys', () => {
		const bag = new ValuesBag()
		const seen: Array<readonly [readonly string[], unknown]> = []
		bag.subscribe((changed) => {
			seen.push([changed, bag.get('b')] as const)
		})
		const changed = bag.setTree({ a: 1, b: 2 })
		expect(changed).toEqual(['a', 'b'])
		expect(seen[0]?.[1]).toBe(2)
		expect(bag.setTree({ a: 1 })).toEqual([])
	})

	it('notifies per-key listeners only for their changed key', () => {
		const bag = new ValuesBag()
		const aListener = vi.fn()
		const bListener = vi.fn()
		bag.subscribe('a', aListener)
		bag.subscribe('b', bListener)
		bag.setTree({ a: 1 })
		expect(aListener).toHaveBeenCalledWith(1)
		expect(bListener).not.toHaveBeenCalled()
	})

	it('throws PaletteWriteError when locked', () => {
		const bag = new ValuesBag()
		bag.lock()
		expect(() => bag.set('a', 1)).toThrow(PaletteWriteError)
		expect(() => bag.setTree({ a: 1 })).toThrow(PaletteWriteError)
		bag.unlock()
		bag.set('a', 1)
		expect(bag.get('a')).toBe(1)
	})

	it('asObject returns a fresh frozen-reference snapshot', () => {
		const bag = new ValuesBag({ a: 1 })
		const first = bag.asObject()
		expect(first).toEqual({ a: 1 })
		expect(first).not.toBe(bag.asObject())
	})
})

describe('NothingPoint', () => {
	it('isNothingPoint narrows; valued/action guards return false', () => {
		const nothing = {
			id: 'status',
			label: 'Status',
			type: 'nothing',
			uses: ['activeFile'],
		} as const
		expect(isNothingPoint(nothing as never)).toBe(true)
	})

	it('core rejects nothing-points in initialValues/setMany', () => {
		const core = new PaletteCore([
			{ id: 'status', label: 'Status', type: 'nothing', uses: ['activeFile'] },
		])
		expect(() => new PaletteCore(core.points, { initialValues: { status: 'x' } })).toThrow(
			'not valued'
		)
		expect(() => core.setMany({ status: 'x' })).toThrow('not valued')
	})
})

describe('PaletteCore context registry', () => {
	it('setContext replaces (never appends); removeContext resolves undefined', () => {
		const core = new PaletteCore([
			{ id: 'bold', label: 'Bold', type: 'boolean', uses: ['activeFile'] },
		])
		expect(core.getBag('activeFile')).toBeUndefined()
		expect(core.resolveBags(['activeFile'])).toEqual([undefined])
		const first = new ValuesBag({ fileName: 'a.ts' })
		const second = new ValuesBag({ fileName: 'b.ts' })
		const firstListener = vi.fn()
		first.subscribe(firstListener)
		core.setContext('activeFile', first)
		expect(core.getBag('activeFile')).toBe(first)
		// Replace drops only core's forward: host direct subscribers survive,
		// and the old bag keeps notifying them (no clearListeners wipe).
		core.setContext('activeFile', second)
		expect(core.getBag('activeFile')).toBe(second)
		first.set('fileName', 'a2.ts')
		expect(firstListener).toHaveBeenCalledWith(['fileName'])
		// Identity change emits `[]`: adapters re-resolve everything for the
		// name, never replay old subscriptions onto the new bag.
		const identity = vi.fn()
		core.subscribeContext(identity)
		core.setContext('activeFile', new ValuesBag({ fileName: 'c.ts' }))
		expect(identity).toHaveBeenCalledWith('activeFile', [])
		core.removeContext('activeFile')
		expect(core.getBag('activeFile')).toBeUndefined()
		expect(core.resolveBags(['activeFile'])).toEqual([undefined])
	})

	it('root bag resolves via getBag(ROOT_CONTEXT) and resolveBags (+ root alias)', () => {
		const core = new PaletteCore([{ id: 'bold', label: 'Bold', type: 'boolean' }])
		expect(core.getBag(ROOT_CONTEXT)).toBe(core.values as never)
		expect(core.getBag('root')).toBe(core.values as never)
		expect(core.resolveBags([ROOT_CONTEXT, 'missing'])[0]).toBe(core.values as never)
		expect(core.resolveBags([ROOT_CONTEXT, 'missing'])[1]).toBeUndefined()
		expect(core.resolveBags(['root'])[0]).toBe(core.values as never)
	})

	it('setContext/removeContext throw on the root name', () => {
		const core = new PaletteCore([{ id: 'bold', label: 'Bold', type: 'boolean' }])
		expect(() => core.setContext(ROOT_CONTEXT, new ValuesBag())).toThrow('core-owned root')
		expect(() => core.setContext('root', new ValuesBag())).toThrow('core-owned root')
		expect(() => core.removeContext(ROOT_CONTEXT)).toThrow('core-owned root')
		expect(() => core.removeContext('root')).toThrow('core-owned root')
	})

	it('forwards bag changes to subscribeContext with (name, changedKeys)', () => {
		const core = new PaletteCore([
			{ id: 'bold', label: 'Bold', type: 'boolean', uses: ['activeFile'] },
		])
		const bag = new ValuesBag({ fileName: 'a.ts' })
		core.setContext('activeFile', bag)
		const listener = vi.fn()
		core.subscribeContext(listener)
		bag.set('fileName', 'b.ts')
		expect(listener).toHaveBeenCalledWith('activeFile', ['fileName'])
	})

	it('evaluateCan calls functional can with resolved bags; omitted = enabled', () => {
		const core = new PaletteCore([
			{
				id: 'bold',
				label: 'Bold',
				type: 'boolean',
				uses: ['activeFile'],
				can: (bag) => bag?.get('readOnly') !== true,
			},
			{ id: 'plain', label: 'Plain', type: 'boolean' },
		])
		expect(core.evaluateCan('bold')).toBe(true)
		expect(core.evaluateCan('plain')).toBe(true)
		core.setContext('activeFile', new ValuesBag({ readOnly: true }))
		expect(core.evaluateCan('bold')).toBe(false)
		expect(() => core.evaluateCan('missing')).toThrow(PaletteError)
	})

	it('subscribeCan fires only on flips (no render storms)', () => {
		const core = new PaletteCore([
			{
				id: 'bold',
				label: 'Bold',
				type: 'boolean',
				uses: ['activeFile'],
				can: (bag) => bag?.get('readOnly') !== true,
			},
		])
		const flips: Array<readonly [string, boolean]> = []
		core.subscribeCan((id, can) => {
			flips.push([id, can] as const)
		})
		const bag = new ValuesBag<Record<string, unknown>>({ readOnly: false })
		core.setContext('activeFile', bag)
		expect(flips).toEqual([])
		bag.set('readOnly', true)
		expect(flips).toEqual([['bold', false]])
		bag.set('unrelated', 1)
		expect(flips).toEqual([['bold', false]])
		bag.set('readOnly', false)
		expect(flips).toEqual([
			['bold', false],
			['bold', true],
		])
	})

	it('dispose clears context subscriptions', () => {
		const core = new PaletteCore([
			{ id: 'bold', label: 'Bold', type: 'boolean', uses: ['activeFile'] },
		])
		const bag = new ValuesBag({ fileName: 'a.ts' })
		core.setContext('activeFile', bag)
		const listener = vi.fn()
		core.subscribeContext(listener)
		core.dispose()
		bag.set('fileName', 'b.ts')
		expect(listener).not.toHaveBeenCalled()
		expect(core.getBag('activeFile')).toBeUndefined()
	})
})

describe('context-display resolvers', () => {
	it('dualSourceValue prefers the selection bag, else root', () => {
		expect(dualSourceValue(false, undefined, 'bold')).toBe(false)
		const bag = new ValuesBag({ bold: true })
		expect(dualSourceValue(false, bag, 'bold')).toBe(true)
		const empty = new ValuesBag()
		expect(dualSourceValue(false, empty, 'bold')).toBe(false)
	})

	it('param-array accessors never throw on missing slots', () => {
		expect(missingContext).toBeUndefined()
		expect(boundValueAt([1], 5)).toBeUndefined()
		expect(boundBagAt([undefined], 0)).toBeUndefined()
		expect(readBoundBagKey([undefined], 0, 'fileName')).toBeUndefined()
		const bag = new ValuesBag({ fileName: 'a.ts' })
		expect(readBoundBagKey([bag], 0, 'fileName')).toBe('a.ts')
	})

	it('buttonPresenter evaluates functional can against bound bags', () => {
		const view = buttonPresenter(
			{ tool: 'save' },
			{
				point: {
					id: 'save',
					label: 'Save',
					type: 'action',
					run: () => {},
					can: (bag) => bag?.get('dirty') === true,
				},
				value: undefined,
				bags: [new ValuesBag({ dirty: false })],
			},
			'save'
		)
		expect(view.can).toBe(false)
	})
})

describe('context-routed valued reads/writes (ship selection pattern)', () => {
	function shipCore() {
		return new PaletteCore([
			{ id: 'shipShields', label: 'Ship Shields', type: 'boolean', uses: ['ship'] },
			{
				id: 'shipPower',
				label: 'Ship Reactor',
				type: 'number',
				constraints: { min: 0.5, max: 5, step: 0.5 },
				uses: ['ship'],
			},
		])
	}

	it('readValue prefers the first non-root used bag holding the id, else root', () => {
		const core = shipCore()
		core.setMany({ shipShields: false })
		expect(core.readValue('shipShields')).toBe(false)
		const bag = new ValuesBag({ shipShields: true })
		core.setContext('ship', bag)
		expect(core.readValue('shipShields')).toBe(true)
		bag.set('shipShields', undefined as never)
		expect(core.readValue('shipShields')).toBe(false)
	})

	it('writeValue lands in the context bag when it holds the id, else root', () => {
		const core = shipCore()
		core.setMany({ shipShields: false })
		const bag = new ValuesBag({ shipShields: false, shipPower: 1.5 })
		core.setContext('ship', bag)
		expect(core.writeValue('shipShields', true)).toEqual({ target: 'context', bag: 'ship' })
		expect(bag.get('shipShields')).toBe(true)
		expect(core.values.get('shipShields')).toBe(false)
		// Point with no `uses` bag holding it still writes root.
		const plain = new PaletteCore([{ id: 'flag', label: 'Flag', type: 'boolean' }])
		plain.setMany({ flag: false })
		expect(plain.writeValue('flag', true)).toEqual({ target: 'root' })
		expect(plain.values.get('flag')).toBe(true)
	})

	it('writeValue throws on skeleton (absent everywhere); readValue returns undefined', () => {
		const core = shipCore()
		core.setContext('ship', new ValuesBag())
		expect(core.readValue('shipShields')).toBeUndefined()
		expect(() => core.writeValue('shipShields', true)).toThrow('skeleton')
		expect(() => core.readValue('missing')).toThrow(PaletteError)
		expect(() => core.writeValue('missing', true)).toThrow(PaletteError)
	})

	it('run setters and inc/dec route through the context bag', () => {
		const core = shipCore()
		const bag = new ValuesBag({ shipShields: false, shipPower: 1.5 })
		core.setContext('ship', bag)
		core.run('shipShields=true')
		expect(bag.get('shipShields')).toBe(true)
		core.run('shipPower:inc')
		expect(bag.get('shipPower')).toBe(2)
		expect(core.canRunAction('shipPower', 'inc')).toBe(true)
	})
})
