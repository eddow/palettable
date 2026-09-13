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
	await page.getByRole('button', { name: /Terminal/ }).click()
	await expect(page.getByTestId('console-overlay')).toBeVisible()
}

// Movement was stripped for a restart from scratch: no drag sessions run.
// This locks the static edit-mode layout (5 tools, no empty containers).
test('edit mode shows the full toolbar with no empty containers', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const topBorder = page.locator('.toolbar-border[data-region="top"]').first()
	await expect(topBorder.locator('.toolbar-item-guard')).toHaveCount(5)
	await expect(topBorder.locator('.toolbar-item')).toHaveCount(5)
	const empties = await page.evaluate(() => {
		const emptyToolbars = Array.from(document.querySelectorAll('.toolbar')).filter(
			(toolbar) => toolbar.querySelectorAll('.toolbar-item').length === 0
		).length
		const emptyTracks = Array.from(document.querySelectorAll('.toolbar-track')).filter(
			(track) => track.querySelectorAll('.toolbar-track-slot').length === 0
		).length
		return emptyToolbars + emptyTracks
	})
	expect(empties).toBe(0)
})
