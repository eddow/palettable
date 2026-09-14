import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { configuration } from './configuration.js'
import { PaletteCore } from './core.js'
import type { EditorRegistry } from './editors.js'
import { PaletteError } from './errors.js'
import type { SerializedLayout, SerializedToolbarItem } from './layout.js'
import { defaultLayoutFromPoints } from './layout.js'
import type { AnyPoint } from './points.js'
import {
	clearValueCodecs,
	deserializeValues,
	RENDER_MAX_DEPTH,
	registerValueCodec,
	resolveRenderTree,
	serializeValue,
	serializeValues,
	snapshotPalette,
} from './render.js'

function points(): AnyPoint[] {
	return [
		{ id: 'theme', label: 'Theme', type: 'string', defaultValue: 'light' },
		{ id: 'fontSize', label: 'Font size', type: 'number', defaultValue: 14 },
		{ id: 'flag', label: 'Flag', type: 'boolean', defaultValue: false },
		{
			id: 'mode',
			label: 'Mode',
			type: 'enum',
			defaultValue: 'a',
			constraints: { options: [{ value: 'a' }, { value: 'b' }] },
		},
		{ id: 'save', label: 'Save', type: 'action', run: () => {} },
	]
}

const registry: EditorRegistry = {
	boolean: {
		toggle: { id: 'toggle', label: 'Toggle', families: ['boolean'], compact: true },
	},
	number: {
		slider: { id: 'slider', label: 'Slider', families: ['number'], supportedAxes: 'horizontal' },
	},
	string: {
		text: { id: 'text', label: 'Text', families: ['string'] },
	},
	enum: {
		select: { id: 'select', label: 'Select', families: ['enum'], compact: true },
	},
	action: {
		button: { id: 'button', label: 'Button', families: ['action'] },
	},
	item: {
		status: { id: 'status', label: 'Status', families: ['item'] },
	},
}

const virtuals = [
	{ id: 'pause', label: 'Pause', source: 'fontSize', kind: 'stash', stashedValue: 0 },
	{
		id: 'preset',
		label: 'Preset',
		source: 'fontSize',
		kind: 'enum-from',
		options: [
			{ key: 'slow', value: 0 },
			{ key: 'fast', value: 10 },
		],
	},
] as const

describe('node-only import (no DOM, no timers)', () => {
	it('builds + resolves without touching host timers', () => {
		expect('document' in globalThis).toBe(false)
		const queueMicrotaskCalls: unknown[][] = []
		const setTimeoutCalls: unknown[][] = []
		const originalQueueMicrotask = globalThis.queueMicrotask
		const originalSetTimeout = globalThis.setTimeout
		globalThis.queueMicrotask = ((...args: unknown[]) => {
			queueMicrotaskCalls.push(args)
			return (originalQueueMicrotask as (...a: never[]) => unknown)(...(args as never[]))
		}) as typeof queueMicrotask
		globalThis.setTimeout = ((...args: unknown[]) => {
			setTimeoutCalls.push(args)
			return (originalSetTimeout as (...a: never[]) => unknown)(...(args as never[]))
		}) as typeof setTimeout
		try {
			const core = new PaletteCore(points(), {
				initialValues: { theme: 'dark' },
				virtuals: [...virtuals],
			})
			resolveRenderTree({
				points: core.points,
				virtuals: core.virtualPoints,
				layout: core.layout.getSnapshot(),
				values: core.values.asObject(),
				keys: core.keys,
				editors: registry,
			})
		} finally {
			globalThis.queueMicrotask = originalQueueMicrotask
			globalThis.setTimeout = originalSetTimeout
		}
		expect(queueMicrotaskCalls).toEqual([])
		expect(setTimeoutCalls).toEqual([])
	})
})

describe('golden render model', () => {
	it('is byte-identical across runs and JSON round-trips', () => {
		const core = new PaletteCore(points(), {
			initialValues: { theme: 'dark', fontSize: 10 },
			virtuals: [...virtuals],
		})
		const input = {
			points: core.points,
			virtuals: core.virtualPoints,
			layout: core.layout.getSnapshot(),
			values: core.values.asObject(),
			keys: { 'Ctrl+S': 'save' },
			editors: registry,
		}
		const first = resolveRenderTree(input)
		const second = resolveRenderTree(input)
		expect(JSON.stringify(second)).toBe(JSON.stringify(first))
		const roundTripped = JSON.parse(JSON.stringify(first)) as unknown
		expect(JSON.stringify(roundTripped)).toBe(JSON.stringify(first))
		expect(JSON.stringify(first)).toMatchSnapshot()
	})

	it('resolves values, descriptors, editors, keystrokes', () => {
		const core = new PaletteCore(points(), {
			initialValues: { theme: 'dark' },
			virtuals: [...virtuals],
		})
		const tree = resolveRenderTree({
			points: core.points,
			virtuals: core.virtualPoints,
			layout: defaultLayoutFromPoints(['theme', 'flag', 'save']),
			values: core.values.asObject(),
			keys: { 'Ctrl+S': 'save' },
			editors: registry,
		})
		const items = tree.borders.top.slots[0]?.toolbar.items ?? []
		expect(items.map((item) => item.pointId)).toEqual(['theme', 'flag', 'save'])
		expect(items[0]?.value).toBe('dark')
		expect(items[0]?.editor).toBe('text')
		expect(items[1]?.value).toBe(false)
		expect(items[1]?.editor).toBe('toggle')
		expect(items[2]?.descriptor?.id).toBe('save')
		expect(items[2]?.value).toBeUndefined()
		expect(items[2]?.editor).toBe('button')
		expect(items[2]?.keystrokes).toEqual(['Ctrl+S'])
	})

	it('resolves virtuals: enum-from key, setter key, stash pressed-state', () => {
		const core = new PaletteCore(points(), {
			initialValues: { fontSize: 10 },
			virtuals: [...virtuals],
		})
		const tree = resolveRenderTree({
			points: core.points,
			virtuals: core.virtualPoints,
			layout: defaultLayoutFromPoints(['preset', 'preset=fast', 'pause']),
			values: core.values.asObject(),
			editors: registry,
		})
		const items = tree.borders.top.slots[0]?.toolbar.items ?? []
		expect(items[0]?.pointId).toBe('preset')
		expect(items[0]?.value).toBe('fast')
		expect(items[0]?.editor).toBe('select')
		expect(items[1]?.value).toBe('fast')
		expect(items[2]?.pointId).toBe('pause')
		expect(items[2]?.value).toBe(false)
	})

	it('resolves drawers recursively with children', () => {
		const core = new PaletteCore(points())
		const layout: SerializedLayout = {
			version: 1,
			borders: {
				top: [
					{
						space: 1,
						toolbar: [{ editor: 'drawer', toolbar: [{ tool: 'theme' }] }],
					},
				],
				right: [],
				bottom: [],
				left: [],
			},
			parking: [],
		}
		const tree = resolveRenderTree({
			points: core.points,
			layout,
			values: core.values.asObject(),
			editors: registry,
		})
		const drawer = tree.borders.top.slots[0]?.toolbar.items[0]
		expect(drawer?.editor).toBe('drawer')
		expect(drawer?.children.map((child) => child.pointId)).toEqual(['theme'])
	})

	it(`rejects drawer nesting beyond ${RENDER_MAX_DEPTH}`, () => {
		const core = new PaletteCore(points())
		let toolbar: SerializedToolbarItem[] = [{ tool: 'theme' }]
		for (let depth = 0; depth < RENDER_MAX_DEPTH + 1; depth++) {
			toolbar = [{ editor: 'drawer', toolbar }]
		}
		const layout: SerializedLayout = {
			version: 1,
			borders: {
				top: [{ space: 1, toolbar }],
				right: [],
				bottom: [],
				left: [],
			},
			parking: [],
		}
		expect(() =>
			resolveRenderTree({ points: core.points, layout, values: core.values.asObject() })
		).toThrow(PaletteError)
	})

	it('rejects unknown versions and unknown points loudly', () => {
		const core = new PaletteCore(points())
		const badVersion = {
			...defaultLayoutFromPoints(['theme']),
			version: 2,
		} as unknown as SerializedLayout
		expect(() =>
			resolveRenderTree({ points: core.points, layout: badVersion, values: {} })
		).toThrow(PaletteError)
		expect(() =>
			resolveRenderTree({
				points: core.points,
				layout: defaultLayoutFromPoints(['nope']),
				values: {},
			})
		).toThrow('unknown point "nope"')
	})
})

describe('hydration round-trip', () => {
	it('server snapshot → serialize → client core → identical output', () => {
		const server = new PaletteCore(points(), {
			initialValues: { theme: 'dark', fontSize: 10 },
			virtuals: [...virtuals],
		})
		const snapshot = snapshotPalette({
			layout: server.layout.getSnapshot(),
			values: server.values.asObject(),
			virtuals: server.virtualPoints,
		})
		// Stash aside slots stay excluded from the snapshot by decision.
		expect(Object.keys(snapshot)).toEqual(['layout', 'values', 'virtuals', 'configuration'])
		const wire = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
		const client = new PaletteCore(points(), {
			initialValues: wire.values,
			initialLayout: wire.layout,
			virtuals: wire.virtuals,
		})
		const serverTree = resolveRenderTree({
			points: server.points,
			virtuals: server.virtualPoints,
			layout: snapshot.layout,
			values: snapshot.values,
			editors: registry,
		})
		const clientTree = resolveRenderTree({
			points: client.points,
			virtuals: client.virtualPoints,
			layout: wire.layout,
			values: client.values.asObject(),
			editors: registry,
		})
		expect(JSON.stringify(clientTree)).toBe(JSON.stringify(serverTree))
		expect(client.layout.getSnapshot()).toEqual(wire.layout)
		expect(client.values.asObject()).toEqual(wire.values)
	})
})

describe('action isolation', () => {
	it('renders actions without run and never calls it', () => {
		const run = vi.fn(() => {
			throw new Error('run must never execute during resolve')
		})
		const tree = resolveRenderTree({
			points: [{ id: 'save', label: 'Save', type: 'action', run }],
			layout: defaultLayoutFromPoints(['save']),
			values: {},
			editors: registry,
		})
		const item = tree.borders.top.slots[0]?.toolbar.items[0]
		expect(item?.descriptor?.id).toBe('save')
		expect(item?.descriptor !== undefined && 'run' in item.descriptor).toBe(false)
		expect(run).not.toHaveBeenCalled()
	})
})

describe('configuration pinning', () => {
	it('ignores later singleton mutations when config is pinned', () => {
		const core = new PaletteCore(points())
		const pinned = { ...configuration }
		const input = {
			points: core.points,
			layout: defaultLayoutFromPoints(['theme']),
			values: core.values.asObject(),
			editors: registry,
			configuration: pinned,
		}
		const before = JSON.stringify(resolveRenderTree(input))
		const saved = configuration.trackGapSplit
		configuration.trackGapSplit = saved + 0.25
		try {
			expect(JSON.stringify(resolveRenderTree(input))).toBe(before)
		} finally {
			configuration.trackGapSplit = saved
		}
	})
})

describe('import graph (SSR §4.7)', () => {
	it('render.ts never imports globals, gap-dwell, or umd', () => {
		const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8')
		expect(source).not.toMatch(/from '\.\/globals\.js'/)
		expect(source).not.toMatch(/from '\.\/gap-dwell\.js'/)
		expect(source).not.toMatch(/from '\.\/umd\.js'/)
	})

	it('render path is deterministic (no clock, random, or id sources)', () => {
		const source = readFileSync(new URL('./render.ts', import.meta.url), 'utf8')
		expect(source).not.toMatch(/Math\.random/)
		expect(source).not.toMatch(/Date\.now/)
		expect(source).not.toMatch(/performance\.now/)
		expect(source).not.toMatch(/crypto/)
	})
})

describe('value codecs (custom types SSR-unsafe by default)', () => {
	it('passes built-ins through and fails loudly without a codec', () => {
		expect(serializeValue('boolean', true)).toBe(true)
		expect(serializeValue('number', 1)).toBe(1)
		expect(() => serializeValue('color', '#fff')).toThrow('no codec registered for custom type')
	})

	it('round-trips custom types through a registered codec', () => {
		try {
			registerValueCodec('color', {
				serialize: (value) => value,
				deserialize: (json) => json,
			})
			expect(serializeValue('color', '#fff')).toBe('#fff')
			const values = serializeValues({ theme: 'dark' }, points())
			expect(values).toEqual({ theme: 'dark' })
			expect(deserializeValues(values, points())).toEqual({ theme: 'dark' })
		} finally {
			clearValueCodecs()
		}
	})
})
