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

// Re-organising: a drawer must stay open while the pointer is over a DZ that
// lives INSIDE it. Dragging a border tool onto the drawer trigger opens the
// drawer (see `drawer-drag-open.spec.ts`); continuing the drag into the
// drawer's own item-space DZ must keep it open AND highlight that DZ.
//
// Regression: the commit that lands when the pointer enters the drawer DZ
// re-renders the drawer subtree, and the fresh popup came back hidden — the
// drawer "suddenly closed" exactly when the user aimed at a DZ inside it.
test('dragging into a drawer DZ keeps the drawer open and highlights it', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const drawerTrigger = page.getByRole('button', { name: 'More' }).first()
	await expect(drawerTrigger).toBeVisible()
	const popup = page.locator('.palettable-drawer__popup').first()

	const guardBox = await guard.boundingBox()
	const triggerBox = await drawerTrigger.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(triggerBox).not.toBeNull()

	const stepTo = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
		const steps = 16
		for (let i = 1; i <= steps; i += 1) {
			await page.mouse.move(
				from.x + ((to.x - from.x) * i) / steps,
				from.y + ((to.y - from.y) * i) / steps
			)
			await page.waitForTimeout(50)
		}
	}

	try {
		const start = { x: guardBox!.x + guardBox!.width / 2, y: guardBox!.y + guardBox!.height / 2 }
		await page.mouse.move(start.x, start.y)
		await page.mouse.down()
		// 1. Drag onto the drawer trigger: the drawer opens mid-drag.
		await stepTo(start, {
			x: triggerBox!.x + triggerBox!.width / 2,
			y: triggerBox!.y + triggerBox!.height / 2,
		})
		await expect
			.poll(() => popup.evaluate((node) => !(node as HTMLElement).hidden), { timeout: 3000 })
			.toBe(true)
		// 2. Continue into the drawer's own item-space DZ (the gap after the
		//    first child tool). The drawer must stay open and the DZ light up.
		const space = popup.locator('[data-item-space-index]').nth(1)
		const spaceBox = await space.boundingBox()
		expect(spaceBox).not.toBeNull()
		await stepTo(
			{ x: triggerBox!.x + triggerBox!.width / 2, y: triggerBox!.y + triggerBox!.height / 2 },
			{ x: spaceBox!.x + spaceBox!.width / 2, y: spaceBox!.y + spaceBox!.height / 2 }
		)
		await expect
			.poll(() => popup.evaluate((node) => !(node as HTMLElement).hidden), { timeout: 3000 })
			.toBe(true)
		await expect
			.poll(
				() => page.locator('.palettable-drawer__popup [data-item-space-index].highlighted').count(),
				{ timeout: 3000 }
			)
			.toBeGreaterThan(0)
	} finally {
		await page.mouse.up()
	}
})
