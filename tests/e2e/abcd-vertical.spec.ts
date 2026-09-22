import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
})

async function highlighted(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		return [...document.querySelectorAll('.toolbar-drop-zone.highlighted')].map((n) => {
			const bar = (n as HTMLElement).closest('.toolbar')
			const tools = bar
				? [...bar.querySelectorAll('.toolbar-item')]
						.map((w) => w.getAttribute('data-tool'))
						.join(',')
				: '-'
			const kind = (n as HTMLElement).hasAttribute('data-item-space-index')
				? `item${(n as HTMLElement).getAttribute('data-item-space-index')}`
				: (n as HTMLElement).hasAttribute('data-track-space-index')
					? `track${(n as HTMLElement).getAttribute('data-track-space-index')}`
					: `stack${(n as HTMLElement).getAttribute('data-stack-index')}`
			return `${kind} in [${tools}]`
		})
	})
}

async function bars(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const border = document.querySelector('.toolbar-border[data-region="left"]')
		if (!border) return []
		return [...border.querySelectorAll('.toolbar')].map((bar) =>
			[...bar.querySelectorAll('.toolbar-item')].map((w) => w.getAttribute('data-tool'))
		)
	})
}

test('ABCD vertical bottom-aligned pop-A then slide before BCD', async ({ page }) => {
	// Stage ABCD bottom-docked on the left border (space:1 pushes to bottom).
	// Mirror parking-drop.spec.ts: seed storage, reload, then Load layout.
	const layout = {
		version: 2,
		borders: {
			top: [],
			right: [],
			bottom: [
				[
					{
						space: 1,
						toolbar: [
							{
								tool: 'console',
								editor: 'button',
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
						toolbar: [
							{ tool: 'autoOxygen', editor: 'toggle' },
							{ tool: 'shieldGenerator', editor: 'toggle' },
							{ tool: 'fastMode', editor: 'toggle' },
							{ tool: 'missionTime', editor: 'status' },
						],
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
	await page.getByTestId('load-layout').click()
	await expect(page.locator('.toolbar-border[data-region="left"] .toolbar').first()).toBeVisible()
	expect(await bars(page)).toEqual([['autoOxygen', 'shieldGenerator', 'fastMode', 'missionTime']])
	// Open console edit mode via the Terminal button (bottom has a console tool).
	await page.evaluate(() => {
		const btn = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Terminal')
		)
		;(btn as HTMLElement)?.click()
	})
	await expect(page.getByTestId('console-overlay')).toBeVisible()
	// The console opens command-first (no commandBox in this layout): flip to edit.
	await page.evaluate(() => {
		const toggle = document.querySelector('[data-testid="console-mode-toggle"]')
		;(toggle as HTMLElement)?.click()
	})
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()

	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const trackGap = border.locator('.toolbar-track-space.toolbar-drop-zone').first()
	await expect(trackGap).toBeVisible()
	const guardBox = await guard.boundingBox()
	const gapBox = await trackGap.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(gapBox).not.toBeNull()
	try {
		// Pop A (upper element) out via the leading track gap.
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
		const afterDetach = await bars(page)
		console.log(`AFTER-DETACH ${JSON.stringify(afterDetach)}`)
		// Slide [A] before [BCD]: hover B (first item of the remnant bar).
		// The remnant is whichever bar does NOT hold autoOxygen. Target B's
		// center (fresh geometry): the flank stack gaps expand to 8px when
		// lit and shift the track right, so a left-edge target (x+2) lands
		// on the expanded flank instead of the tool and the item paint
		// blinks off — center stays under the cursor through the shift.
		const remnantIndex = afterDetach.findIndex(
			(tools) => !tools.includes('autoOxygen') && tools.length > 0
		)
		expect(remnantIndex).toBeGreaterThanOrEqual(0)
		const nextItem = border.locator('.toolbar').nth(remnantIndex).locator('.toolbar-item').first()
		await expect(nextItem).toBeVisible()
		const themeBox = await nextItem.boundingBox()
		expect(themeBox).not.toBeNull()
		const target = {
			x: themeBox!.x + themeBox!.width / 2,
			y: themeBox!.y + themeBox!.height / 2,
		}
		for (let i = 1; i <= steps; i += 1) {
			const x =
				gapBox!.x + gapBox!.width / 2 + ((target.x - (gapBox!.x + gapBox!.width / 2)) * i) / steps
			const y =
				gapBox!.y + gapBox!.height / 2 + ((target.y - (gapBox!.y + gapBox!.height / 2)) * i) / steps
			await page.mouse.move(x, y)
			await page.waitForTimeout(60)
		}
		await page.waitForTimeout(300)
		const hl = await highlighted(page)
		console.log(`AFTER-HOVER ${JSON.stringify(hl)}`)
		console.log(`BARS-AT-HOVER ${JSON.stringify(await bars(page))}`)
		// Sliding [A] before [BCD] proposes rattachement: the gap flanking
		// B must light. Hovering B's center commits the merge first (A lands
		// between the pointer and B), so the live paint is the merged bar's
		// gap after the pointer position — assert the merged bar carries an
		// item highlight rather than pinning a pre-merge index.
		expect(hl.some((entry) => entry.startsWith('item') && entry.includes('autoOxygen'))).toBe(true)
	} finally {
		await page.mouse.up()
	}
})
