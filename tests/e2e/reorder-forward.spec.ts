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

/** Read the live tool order of the first left-border toolbar. */
async function toolOrder(page: import('@playwright/test').Page): Promise<(string | null)[]> {
	return page
		.evaluate(() =>
			[...document.querySelectorAll('.toolbar-border[data-region="left"] .toolbar')].map((bar) =>
				[...bar.querySelectorAll(':scope > .toolbar-item')].map(
					(item) => item.getAttribute('data-tool') ?? item.getAttribute('data-editor')
				)
			)
		)
		.then((bars) => bars[0] ?? [])
}

/** Step the pointer from a guard onto a target element (per-position handlers). */
async function dragOnto(
	page: import('@playwright/test').Page,
	guardIndex: number,
	target: import('@playwright/test').Locator
): Promise<void> {
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').nth(guardIndex)
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

// Conformance: same-toolbar forward moves land between, not after. The left
// border holds [slider, select, segmented, drawer]: dragging the second tool
// (select) onto the gap between the third and fourth must reorder to
// [slider, segmented, select, drawer] — not [slider, segmented, drawer,
// select]. Backward moves already land correctly. Future adapters (vue,
// thinned svelte) must satisfy this case.
test('dragging a tool forward lands between, not after', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	await expect(border.locator('.toolbar-item-guard').nth(1)).toBeVisible()
	const before = await toolOrder(page)
	expect(before).toHaveLength(4)
	// Gap 3 sits between tool 2 (segmented) and tool 3 (drawer): the
	// advancing target for the dragged tool 1 (select).
	const gap = border.locator('.toolbar-item-space.toolbar-drop-zone[data-item-space-index="3"]')
	try {
		await dragOnto(page, 1, gap)
		await expect
			.poll(() => toolOrder(page), { timeout: 3000 })
			.toEqual([before[0], before[2], before[1], before[3]])
	} finally {
		await page.mouse.up()
	}
})
