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

// Dragging a tool while hovering a track background must light the two
// flanking stack gaps: pointerdown on an edit-mode guard, hover the track
// background (not a toolbar), and the border's stack spaces paint
// `highlighted` (core `borderStackHighlight` active-track fallback).
//
// The console panel is centered over the page and covers the top toolbar's
// right-hand tools, so the test uses the *left* border: guard 0 → track
// background stays clear of the overlay the whole way.
test('dragging a tool over a track highlights the flanking stack gaps', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const track = border.locator(':scope > .toolbar-track').first()
	await expect(track).toBeVisible()
	const guardBox = await guard.boundingBox()
	const trackBox = await track.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(trackBox).not.toBeNull()
	try {
		await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
		await page.mouse.down()
		// Hover the track background near its top edge: inside the track but
		// outside any toolbar (the leading track gap owns the free height).
		const steps = 12
		for (let i = 1; i <= steps; i += 1) {
			const x = trackBox!.x + trackBox!.width / 2
			const y = trackBox!.y + 10
			const sx =
				guardBox!.x + guardBox!.width / 2 + ((x - (guardBox!.x + guardBox!.width / 2)) * i) / steps
			const sy =
				guardBox!.y +
				guardBox!.height / 2 +
				((y - (guardBox!.y + guardBox!.height / 2)) * i) / steps
			await page.mouse.move(sx, sy)
			await page.waitForTimeout(60)
		}
		await expect
			.poll(
				() => border.locator(':scope > .toolbar-stack-space.toolbar-drop-zone.highlighted').count(),
				{ timeout: 3000 }
			)
			.toBeGreaterThan(0)
	} finally {
		await page.mouse.up()
	}
})
