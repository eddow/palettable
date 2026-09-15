import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
})

// The demo displays a `commandBox` combobox on the top toolbar, so the console
// opens in edit mode (running commands happens inline in the combobox).
// NOTE: the console is opened via JS click, not a Playwright click: once the
// console is open the edit-mode guards cover the Terminal button, so a second
// real click (e.g. after a reload with a restored open console) would hit the
// guard instead of the button and time out.
async function openConsole(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		const btn = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Terminal')
		)
		;(btn as HTMLElement)?.click()
	})
	await expect(page.getByTestId('console-overlay')).toBeVisible()
}

// Hovering without any drag must never paint a drop-zone: move the pointer
// across tools, toolbars and track backgrounds (no button pressed) and assert
// no `.toolbar-drop-zone.highlighted` ever appears. Uses the left border to
// stay clear of the centered console overlay.
test('hovering without a drag highlights no drop-zone', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const tools = border.locator('.toolbar-item')
	await expect(tools.first()).toBeVisible()
	const count = await tools.count()
	expect(count).toBeGreaterThan(0)
	// Sweep across every tool in small steps (no mouse.down anywhere).
	for (let i = 0; i < count; i += 1) {
		const box = await tools.nth(i).boundingBox()
		expect(box).not.toBeNull()
		await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 4 })
		await page.waitForTimeout(80)
		expect(await border.locator('.toolbar-drop-zone.highlighted').count()).toBe(0)
	}
	// Sweep across the track backgrounds too (flanking-stack candidates).
	const tracks = border.locator('.toolbar-track')
	const trackCount = await tracks.count()
	for (let i = 0; i < trackCount; i += 1) {
		const box = await tracks.nth(i).boundingBox()
		expect(box).not.toBeNull()
		await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 4 })
		await page.waitForTimeout(80)
		expect(await border.locator('.toolbar-drop-zone.highlighted').count()).toBe(0)
	}
	// Final steady-state assertion: nothing painted anywhere on the page.
	expect(await page.locator('.toolbar-drop-zone.highlighted').count()).toBe(0)
})
