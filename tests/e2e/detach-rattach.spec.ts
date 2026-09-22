import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
})

async function openConsole(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		const btn = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Terminal')
		)
		;(btn as HTMLElement)?.click()
	})
	await expect(page.getByTestId('console-overlay')).toBeVisible()
	await page.evaluate(() => {
		const btn = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Edit toolbars')
		)
		;(btn as HTMLElement)?.click()
	})
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
}

async function topBars(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const border = document.querySelector('.toolbar-border[data-region="top"]')
		if (!border) return []
		return [...border.querySelectorAll('.toolbar')].map((bar) =>
			[...bar.querySelectorAll('.toolbar-item')].map((w) => w.getAttribute('data-tool'))
		)
	})
}

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

test('detach then hover next toolbar extreme highlights rattachement', async ({ page }) => {
	await openConsole(page)
	// Left border (vertical): guard 0 → leading track gap stays clear of the
	// console overlay the whole way (mirrors track-drop.spec.ts).
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	// Leading track gap (owns the free height, hittable).
	const trackGap = border.locator('.toolbar-track-space.toolbar-drop-zone').first()
	await expect(trackGap).toBeVisible()
	const guardBox = await guard.boundingBox()
	const gapBox = await trackGap.boundingBox()
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
		const bars = await topBars(page)
		console.log(`AFTER-DETACH ${JSON.stringify(bars)}`)
		// Detach landed: the dragged tool now rides its own singleton toolbar.
		const before = await border.locator('.toolbar-track-slot').count()
		expect(before).toBeGreaterThan(1)
		// Now hover the next toolbar's extreme (its first tool, top edge).
		const nextItem = border.locator('.toolbar').nth(1).locator('.toolbar-item').first()
		await expect(nextItem).toBeVisible()
		const themeBox = await nextItem.boundingBox()
		expect(themeBox).not.toBeNull()
		for (let i = 1; i <= steps; i += 1) {
			const x =
				gapBox!.x +
				gapBox!.width / 2 +
				((themeBox!.x + 2 - (gapBox!.x + gapBox!.width / 2)) * i) / steps
			const y =
				gapBox!.y +
				gapBox!.height / 2 +
				((themeBox!.y + themeBox!.height / 2 - (gapBox!.y + gapBox!.height / 2)) * i) / steps
			await page.mouse.move(x, y)
			await page.waitForTimeout(60)
		}
		await page.waitForTimeout(300)
		const hl = await highlighted(page)
		console.log(`AFTER-HOVER ${JSON.stringify(hl)}`)
		expect(hl.length).toBeGreaterThan(0)
	} finally {
		await page.mouse.up()
	}
})
