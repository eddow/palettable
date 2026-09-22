import { expect, test } from '@playwright/test'

const LAYOUT_KEY = 'palettable-demo-layout-v1'

/** Single-toolbar left layout: one track, one slot with the given leading `space`. */
function leftOnlyLayout(space: number) {
	return {
		version: 1,
		borders: {
			top: [],
			right: [],
			bottom: [],
			left: [{ space, toolbar: [{ point: 'autoOxygen', control: 'toggle' }] }],
		},
		parking: [],
	}
}

async function loadLeftSpace(page: import('@playwright/test').Page, space: number) {
	await page.goto('/')
	await page.evaluate(
		({ key, layout }) => {
			localStorage.clear()
			localStorage.setItem(key, JSON.stringify(layout))
		},
		{ key: LAYOUT_KEY, layout: leftOnlyLayout(space) }
	)
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
	await expect(page.locator('.toolbar-border[data-region="left"] .toolbar').first()).toBeVisible()
}

async function measureLeft(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const border = document.querySelector('.toolbar-border[data-region="left"]')
		const track = border?.querySelector('.toolbar-track')
		const toolbar = track?.querySelector('.toolbar-track-slot .toolbar')
		const middle = document.querySelector('.palette-ide-middle')
		const rect = (el: Element | null | undefined) => {
			if (!(el instanceof HTMLElement)) return null
			const r = el.getBoundingClientRect()
			return { top: r.top, bottom: r.bottom, height: r.height }
		}
		return {
			border: rect(border),
			track: rect(track),
			toolbar: rect(toolbar),
			middle: rect(middle),
		}
	})
}

test('vertical single toolbar with space=1 docks to the bottom', async ({ page }) => {
	await loadLeftSpace(page, 1)
	const { border, toolbar, middle } = await measureLeft(page)
	expect(border).not.toBeNull()
	expect(toolbar).not.toBeNull()
	expect(middle).not.toBeNull()
	// Leading gap takes all free space: toolbar bottom meets the track end
	// (the left border / middle bottom), toolbar top sits far below the top.
	expect(toolbar!.bottom).toBeCloseTo(border!.bottom, 0)
	expect(toolbar!.bottom).toBeCloseTo(middle!.bottom, 0)
	expect(border!.top).toBeCloseTo(middle!.top, 0)
	expect(toolbar!.top - border!.top).toBeGreaterThan(50)
})

test('vertical single toolbar with space=0 docks to the top', async ({ page }) => {
	await loadLeftSpace(page, 0)
	const { border, toolbar, middle } = await measureLeft(page)
	expect(border).not.toBeNull()
	expect(toolbar).not.toBeNull()
	expect(middle).not.toBeNull()
	// No leading gap (trailing gap takes it all): toolbar top meets the track
	// start (the left border / middle top), toolbar bottom sits far above the bottom.
	expect(toolbar!.top).toBeCloseTo(border!.top, 0)
	expect(toolbar!.top).toBeCloseTo(middle!.top, 0)
	expect(border!.bottom).toBeCloseTo(middle!.bottom, 0)
	expect(border!.bottom - toolbar!.bottom).toBeGreaterThan(50)
})
