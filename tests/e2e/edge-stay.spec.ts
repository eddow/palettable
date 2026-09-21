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

// Conformance: a DZ beside a dragged tool is never highlighted. When ABCD
// has D dragged, the TB-gap after D stays dark and the candidate moves out
// to the track gap after the toolbar (core `trackSpaceHighlight` fallback);
// symmetrically, dragging A paints the track gap before the toolbar. Future
// adapters (vue, thinned svelte) must satisfy both cases. Uses the left
// border (4 tools: slider, select, segmented, drawer) to stay clear of the
// centered console overlay.
async function dragOntoTool(page: import('@playwright/test').Page, index: number): Promise<void> {
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	// Border-scoped: drawer popups are hierarchical children with their own
	// guards/items — drag gestures target the real border toolbar only.
	const guard = border
		.locator(
			'> .toolbar-track > .toolbar-track-slot > .toolbar > .toolbar-item > .toolbar-item-guard'
		)
		.nth(index)
	const target = border
		.locator('> .toolbar-track > .toolbar-track-slot > .toolbar > .toolbar-item')
		.nth(index)
	const guardBox = await guard.boundingBox()
	const targetBox = await target.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(targetBox).not.toBeNull()
	await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
	await page.mouse.down()
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
}

test('dragging the last tool highlights the track gap after the toolbar', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const bar = border.locator('> .toolbar-track > .toolbar-track-slot > .toolbar').first()
	// Border-scoped guards (drawer popup carries its own hierarchical set).
	await expect(
		border
			.locator(
				'> .toolbar-track > .toolbar-track-slot > .toolbar > .toolbar-item > .toolbar-item-guard'
			)
			.nth(3)
	).toBeVisible()
	try {
		await dragOntoTool(page, 3)
		// The TB-gap after the dragged tool stays dark (a DZ beside a
		// dragged tool is never highlighted) …
		expect(
			await bar
				.locator('.toolbar-item-space.toolbar-drop-zone[data-item-space-index="4"].highlighted')
				.count()
		).toBe(0)
		// … and the track gap after the toolbar paints instead.
		await expect
			.poll(
				() =>
					border
						.locator(
							'.toolbar-track-space.toolbar-drop-zone[data-track-space-index="1"].highlighted'
						)
						.count(),
				{ timeout: 3000 }
			)
			.toBeGreaterThan(0)
	} finally {
		await page.mouse.up()
	}
})

test('dragging the first tool highlights the track gap before the toolbar', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const bar = border.locator('> .toolbar-track > .toolbar-track-slot > .toolbar').first()
	await expect(
		border
			.locator(
				'> .toolbar-track > .toolbar-track-slot > .toolbar > .toolbar-item > .toolbar-item-guard'
			)
			.first()
	).toBeVisible()
	try {
		await dragOntoTool(page, 0)
		// The TB-gap before the dragged tool stays dark …
		expect(
			await bar
				.locator('.toolbar-item-space.toolbar-drop-zone[data-item-space-index="0"].highlighted')
				.count()
		).toBe(0)
		// … and the track gap before the toolbar paints instead.
		await expect
			.poll(
				() =>
					border
						.locator(
							'.toolbar-track-space.toolbar-drop-zone[data-track-space-index="0"].highlighted'
						)
						.count(),
				{ timeout: 3000 }
			)
			.toBeGreaterThan(0)
	} finally {
		await page.mouse.up()
	}
})
