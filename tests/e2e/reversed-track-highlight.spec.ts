import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
})

async function highlightedItemGaps(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		return [...document.querySelectorAll('.toolbar-item-space.toolbar-drop-zone.highlighted')].map((n) => {
			const el = n as HTMLElement
			const bar = el.closest('.toolbar')
			const trackEl = el.closest('.toolbar-track')
			return {
				gap: el.getAttribute('data-item-space-index'),
				track: trackEl?.getAttribute('data-track-index'),
				tools: bar ? [...bar.querySelectorAll('.toolbar-item')].length : -1,
			}
		})
	})
}

// Reversed borders (right/bottom) render tracks in reverse DOM order while
// stamping live indices. A highlight for live track N must paint the gap
// node inside the DOM track stamped N — never the mirrored sibling. Seeds
// two tracks on the right border, drags a left-border tool onto live
// track 1's leading gap, and asserts the lit gap belongs to track 1.
test('reversed border highlight lands on the hovered live track', async ({ page }) => {
	const layout = {
		version: 1,
		borders: {
			top: [],
			right: [
				[
					{
						space: 1,
						toolbar: [{ point: 'saveGame', control: 'button' }],
					},
				],
				[
					{
						space: 1,
						toolbar: [{ point: 'colonyTheme', control: 'select' }],
					},
				],
			],
			bottom: [
				[
					{
						space: 1,
						toolbar: [
							{
								point: 'console',
								control: 'button',
								config: { icon: '💻', label: 'Terminal', hint: 'Head button (run)' },
							},
						],
					},
				],
			],
			left: [
				[
					{
						space: 1,
						toolbar: [{ point: 'gameSpeed', control: 'slider' }],
					},
				],
			],
		},
		parking: [],
	}
	await page.goto('/')
	await page.evaluate(
		({ key, layout }) => {
			localStorage.clear()
			localStorage.setItem(key, JSON.stringify(layout))
		},
		{ key: 'palettable-demo-layout-v1', layout }
	)
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
	await page.evaluate(() => {
		const btn = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Terminal')
		)
		;(btn as HTMLElement)?.click()
	})
	await expect(page.getByTestId('console-overlay')).toBeVisible()
	await page.evaluate(() => {
		const toggle = document.querySelector('[data-testid="console-mode-toggle"]')
		;(toggle as HTMLElement)?.click()
	})
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()

	const left = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = left.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const right = page.locator('.toolbar-border[data-region="right"]').first()
	const gap = right
		.locator('.toolbar-track[data-track-index="1"] .toolbar-track-space.toolbar-drop-zone')
		.first()
	await expect(gap).toBeVisible()
	const guardBox = await guard.boundingBox()
	const gapBox = await gap.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(gapBox).not.toBeNull()
	try {
		await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
		await page.mouse.down()
		const steps = 12
		for (let i = 1; i <= steps; i += 1) {
			const x =
				guardBox!.x +
				guardBox!.width / 2 +
				((gapBox!.x + gapBox!.width / 2 - (guardBox!.x + guardBox!.width / 2)) * i) / steps
			const y =
				guardBox!.y +
				guardBox!.height / 2 +
				((gapBox!.y + gapBox!.height / 2 - (guardBox!.y + guardBox!.height / 2)) * i) / steps
			await page.mouse.move(x, y)
			await page.waitForTimeout(60)
		}
		await page.waitForTimeout(300)
		const lit = await highlightedItemGaps(page)
		// The fresh singleton sits in live track 1 at slot 0: the zone
		// paints the neighbour edge (remnant gap 0) as item-gap 0 on the
		// bar whose track stamps live index 1. A crossed track mapping
		// (double reversal) resolves the remnant bar against the wrong
		// track and the paint lands on track 0 instead.
		expect(lit.length).toBeGreaterThan(0)
		for (const entry of lit) {
			expect(entry.track).toBe('1')
		}
	} finally {
		await page.mouse.up()
	}
})
