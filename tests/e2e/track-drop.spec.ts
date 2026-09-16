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

// Dragging a tool onto a track gap must reorganize: pointerdown on an
// edit-mode guard, hover a neighbouring track's gap, and the dragged tool
// lands in a fresh singleton toolbar at that gap (commit-on-hover, no
// highlight — the new toolbar itself is the visual feedback, mirroring the
// svelte `ToolbarTrack` contract).
//
// The console panel is centered over the page and covers the top toolbar's
// right-hand tools, so the test uses the *left* border: guard 0 → the last
// track gap stays clear of the overlay the whole way.
test('dragging a tool onto a track gap extracts a new toolbar', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const before = await border.locator('.toolbar-track').count()
	expect(before).toBeGreaterThan(0)
	// First track gap (leading, `space: 1`): it owns the free height, so it
	// is hittable; the trailing gap is zero-size. Hovering it commits the
	// dragged tool into a fresh singleton toolbar there (restructure — the
	// origin toolbar keeps its remaining tools).
	const gap = border.locator('.toolbar-track-space.toolbar-drop-zone').first()
	await expect(gap).toBeVisible()
	const guardBox = await guard.boundingBox()
	const gapBox = await gap.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(gapBox).not.toBeNull()
	try {
		await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
		await page.mouse.down()
		// Step through the path in small increments: the pointermove handlers
		// commit per position, and a single jump can skip the gap hover.
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
		// The commit extracts the tool into a fresh toolbar: one more track
		// slot holds exactly the dragged tool.
		await expect
			.poll(() => border.locator('.toolbar-track-slot').count(), { timeout: 3000 })
			.toBeGreaterThan(before)
	} finally {
		await page.mouse.up()
	}
})
