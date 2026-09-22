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

/** Read the live tool order of the first left-border toolbar (drawer
 * popups are hierarchical children of the border — excluded). */
async function toolOrder(page: import('@playwright/test').Page): Promise<(string | null)[]> {
	return page
		.evaluate(() =>
			[
				...document.querySelectorAll(
					'.toolbar-border[data-region="left"] > .toolbar-track > .toolbar-track-slot > .toolbar'
				),
			].map((bar) =>
				[...bar.querySelectorAll(':scope > .toolbar-item')].map(
					(item) => item.getAttribute('data-point') ?? item.getAttribute('data-control')
				)
			)
		)
		.then((bars) => bars[0] ?? [])
}

// Conformance: re-organisation happens ONLY on drag-over of a highlighted
// DZ. Dragging the first tool and hovering the dark gap beside it (gap 0 /
// gap 1 touch the dragged tool, so they stay dark) must leave the tool
// order untouched — no move, no extract, no singleton. Future adapters
// (vue, thinned svelte) must satisfy this case: paint and commit share one
// decision, so a dark gap can never restructure.
test('hovering a dark gap never re-organises tools', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const before = await toolOrder(page)
	expect(before).toHaveLength(4)
	// Gap 1 sits right after the dragged tool 0: dark by the
	// never-beside-a-dragged-tool rule. Hover it directly (gaps are
	// zero-size until highlighted, so step onto its centre via bounding
	// box — a dark gap has no size, but the pointer still lands on it).
	// Scoped to the border track: drawer popups are hierarchical children
	// carrying their own item spaces.
	const gap = border.locator(
		'> .toolbar-track > .toolbar-track-slot > .toolbar > .toolbar-item-space.toolbar-drop-zone[data-item-space-index="1"]'
	)
	const guardBox = await guard.boundingBox()
	const gapBox = await gap.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(gapBox).not.toBeNull()
	try {
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
		// The gap stays dark …
		expect(
			await border
				.locator(
					'> .toolbar-track > .toolbar-track-slot > .toolbar > .toolbar-item-space.toolbar-drop-zone[data-item-space-index="1"].highlighted'
				)
				.count()
		).toBe(0)
		// … and the order is untouched (no re-organisation on a dark DZ).
		await page.waitForTimeout(400)
		expect(await toolOrder(page)).toEqual(before)
		expect(await border.locator('> .toolbar-track > .toolbar-track-slot').count()).toBe(1)
	} finally {
		await page.mouse.up()
	}
})
