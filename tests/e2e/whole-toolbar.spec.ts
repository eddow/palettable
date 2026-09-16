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

// Conformance: a whole-toolbar drag never highlights the neighbour track
// gaps — only the last TB-DZ of the previous TB and the first TB-DZ of the
// next TB (same track). The left border holds a single toolbar, so the test
// first extracts a second toolbar onto the track (guard 0 → leading track
// gap), then drags the whole fresh singleton: its own flanking track gaps
// stay dark while the neighbour TB edge paints.
test('dragging a whole toolbar paints neighbour TB edges, not track gaps', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const gap = border.locator('.toolbar-track-space.toolbar-drop-zone').first()
	await expect(gap).toBeVisible()
	const guardBox = await guard.boundingBox()
	const gapBox = await gap.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(gapBox).not.toBeNull()
	try {
		// Extract tool 0 into a fresh singleton at the leading track gap.
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
		await expect
			.poll(() => border.locator('.toolbar-track-slot').count(), { timeout: 3000 })
			.toBeGreaterThan(1)
		// The extract promotes to a whole-toolbar slide: hover the fresh
		// singleton's tool and assert the neighbour TB edge paints while
		// the own-track flanks stay dark.
		const freshBar = border.locator('.toolbar').first()
		const freshTool = freshBar.locator('.toolbar-item').first()
		const toolBox = await freshTool.boundingBox()
		expect(toolBox).not.toBeNull()
		await page.mouse.move(toolBox!.x + toolBox!.width / 2, toolBox!.y + toolBox!.height / 2, {
			steps: 6,
		})
		await page.waitForTimeout(200)
		// Own flanking track gaps stay dark …
		expect(await border.locator('.toolbar-track-space.toolbar-drop-zone.highlighted').count()).toBe(
			0
		)
		// … and the neighbour TB edge (last DZ of the next TB) paints.
		await expect
			.poll(() => border.locator('.toolbar-item-space.toolbar-drop-zone.highlighted').count(), {
				timeout: 3000,
			})
			.toBeGreaterThan(0)
	} finally {
		await page.mouse.up()
	}
})
