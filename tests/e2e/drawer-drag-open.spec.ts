import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
})

// The demo displays a `commandBox` combobox on the top toolbar, so the console
// opens in edit mode (running commands happens inline in the combobox).
async function openConsole(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		const btn = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Terminal')
		)
		;(btn as HTMLElement)?.click()
	})
	await expect(page.getByTestId('console-overlay')).toBeVisible()
}

// Dragging a tool over a drawer trigger must open the drawer: the trigger's
// own pointermove never fires mid-drag (the dragged guard covers it), so the
// bar-level coordinate hit-test owns hover-open via the drag-hover event.
test('dragging a tool over a drawer trigger opens the drawer', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	// The left border hosts the `More` drawer (open: hover in the demo, but
	// hover-open must work for any mode mid-drag — the bar dispatch covers
	// all modes).
	const drawerTrigger = page.getByRole('button', { name: 'More' }).first()
	await expect(drawerTrigger).toBeVisible()
	const popup = page.locator('.palettable-drawer__popup').first()
	// Grab a tool from the left border (guard 0) and drag onto the drawer
	// trigger in small steps so the bar pointermove fires along the way.
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const guardBox = await guard.boundingBox()
	const triggerBox = await drawerTrigger.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(triggerBox).not.toBeNull()
	try {
		await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
		await page.mouse.down()
		const steps = 16
		for (let i = 1; i <= steps; i += 1) {
			const x =
				guardBox!.x +
				guardBox!.width / 2 +
				((triggerBox!.x + triggerBox!.width / 2 - (guardBox!.x + guardBox!.width / 2)) * i) /
					steps
			const y =
				guardBox!.y +
				guardBox!.height / 2 +
				((triggerBox!.y + triggerBox!.height / 2 - (guardBox!.y + guardBox!.height / 2)) * i) /
					steps
			await page.mouse.move(x, y)
			await page.waitForTimeout(60)
		}
		// The drawer opened mid-drag (popup visible, trigger expanded).
		await expect
			.poll(() => popup.evaluate((node) => !(node as HTMLElement).hidden), { timeout: 3000 })
			.toBe(true)
		await expect(drawerTrigger).toHaveAttribute('aria-expanded', 'true')
	} finally {
		await page.mouse.up()
	}
})
