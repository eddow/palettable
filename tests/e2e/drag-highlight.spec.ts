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

// Dragging a tool must paint a drop-zone: pointerdown on an edit-mode guard,
// hover a neighbouring tool, and the nearest free item-space gaps light up.
//
// The console panel is centered over the page and covers the top toolbar's
// right-hand tools, so the test uses the *left* border: guard 0 → tool 1
// stays clear of the overlay the whole way. (Item-space gaps are zero-size
// until highlighted, so the test hovers a tool — hovering a tool highlights
// the flanking free gaps via the active-item fallback — never a gap directly.)
test('dragging a tool highlights a free item-space drop-zone', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	// Second tool, adjacent to the grabbed first tool: hovering it highlights
	// the nearest free gaps on each side (gaps 0/1 touch the dragged first
	// tool and stay dark, so 2 lights up).
	const target = border.locator('.toolbar-item').nth(1)
	await expect(target).toBeVisible()
	const guardBox = await guard.boundingBox()
	const targetBox = await target.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(targetBox).not.toBeNull()
	try {
		await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
		await page.mouse.down()
		// Step through the path in small increments: the pointermove handlers
		// commit/paint per position, and a single jump can skip the hover
		// state the highlight derives from.
		const steps = 12
		for (let i = 1; i <= steps; i += 1) {
			const x =
				guardBox!.x +
				guardBox!.width / 2 +
				((targetBox!.x + targetBox!.width / 2 - (guardBox!.x + guardBox!.width / 2)) * i) / steps
			const y =
				guardBox!.y +
				guardBox!.height / 2 +
				((targetBox!.y + targetBox!.height / 2 - (guardBox!.y + guardBox!.height / 2)) * i) / steps
			await page.mouse.move(x, y)
			await page.waitForTimeout(60)
		}
		await expect
			.poll(() => border.locator('.toolbar-drop-zone.highlighted').count(), {
				timeout: 3000,
			})
			.toBeGreaterThan(0)
	} finally {
		await page.mouse.up()
	}
})
