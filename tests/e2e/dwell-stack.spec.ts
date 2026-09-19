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

/** Raw rect point of a gap node (works while zero-size: rects still position). */
async function gapPoint(
	page: import('@playwright/test').Page,
	selector: string
): Promise<{ x: number; y: number }> {
	return page.evaluate((sel) => {
		const node = document.querySelector(sel)
		if (!(node instanceof HTMLElement)) throw new Error(`missing gap ${sel}`)
		const rect = node.getBoundingClientRect()
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
	}, selector)
}

/** Stepped pointer path (mirrors the other specs: 12 steps, 60ms apart). */
async function stepTo(
	page: import('@playwright/test').Page,
	point: { x: number; y: number }
): Promise<void> {
	await page.mouse.move(point.x, point.y, { steps: 6 })
	await page.waitForTimeout(60)
}

const LEFT = '.toolbar-border[data-region="left"]'
const gapSel = (index: number) =>
	`.toolbar-border[data-region="left"] > .toolbar-stack-space.toolbar-drop-zone[data-stack-index="${index}"]`

// Phase 3: the dwell lives in the core session — hovering a directly-hovered
// stack gap fires the commit that creates a track at that stack
// (`configuration.stackDzHoverMs` = 500ms). Stack gaps are zero-size until
// highlighted, so the test first hovers the track background (paints the two
// flanking gaps, expanding them), then steps onto the expanded gap 0: the
// direct hover arms the dwell, which fires into a new track.
test('hovering a stack gap dwells into a new track', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator(LEFT).first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const tracksBefore = await border.locator(':scope > .toolbar-track').count()
	const track = border.locator(':scope > .toolbar-track').first()
	const trackBox = await track.boundingBox()
	const guardBox = await guard.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(trackBox).not.toBeNull()
	try {
		await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
		await page.mouse.down()
		// Step 1: track background near its top edge → flanking gaps paint.
		await stepTo(page, { x: trackBox!.x + trackBox!.width / 2, y: trackBox!.y + 10 })
		await expect
			.poll(
				() => border.locator(':scope > .toolbar-stack-space.toolbar-drop-zone.highlighted').count(),
				{ timeout: 3000 }
			)
			.toBe(2)
		// Step 2: onto the now-expanded gap 0 → direct hover arms the dwell …
		const point = await gapPoint(page, gapSel(0))
		await stepTo(page, point)
		await expect
			.poll(
				() =>
					border
						.locator(
							':scope > .toolbar-stack-space.toolbar-drop-zone[data-stack-index="0"].highlighted'
						)
						.count(),
				{ timeout: 3000 }
			)
			.toBe(1)
		// … the armed gap double-highlights (`.highlighted.hovered`, doubled
		// size) while the dwell timer counts …
		await expect
			.poll(
				() =>
					border
						.locator(
							':scope > .toolbar-stack-space.toolbar-drop-zone[data-stack-index="0"].highlighted.hovered'
						)
						.count(),
				{ timeout: 3000 }
			)
			.toBe(1)
		// … then the dwell fires and a track is created at that stack.
		await expect
			.poll(() => border.locator(':scope > .toolbar-track').count(), { timeout: 5000 })
			.toBe(tracksBefore + 1)
	} finally {
		await page.mouse.up()
	}
})

// Phase 3: leaving the armed gap cancels the pending fire — moving back to
// the track background (flank paint, not a dwellable hover) cancels the arm,
// so no track is created. (Retargeting gap→gap is the same session path —
// any non-dwellable hover cancels — but gap→gap is not e2e-hittable: the
// non-hovered stack gap is zero-size until painted.)
test('leaving the armed stack gap cancels the pending dwell', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator(LEFT).first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const tracksBefore = await border.locator(':scope > .toolbar-track').count()
	const track = border.locator(':scope > .toolbar-track').first()
	const trackBox = await track.boundingBox()
	const guardBox = await guard.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(trackBox).not.toBeNull()
	const trackPoint = { x: trackBox!.x + trackBox!.width / 2, y: trackBox!.y + 10 }
	try {
		await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
		await page.mouse.down()
		// Flank paint first (expands gap 0), then arm on gap 0.
		await stepTo(page, trackPoint)
		await expect
			.poll(
				() => border.locator(':scope > .toolbar-stack-space.toolbar-drop-zone.highlighted').count(),
				{ timeout: 3000 }
			)
			.toBe(2)
		await stepTo(page, await gapPoint(page, gapSel(0)))
		await expect
			.poll(
				() =>
					border
						.locator(
							':scope > .toolbar-stack-space.toolbar-drop-zone[data-stack-index="0"].highlighted'
						)
						.count(),
				{ timeout: 3000 }
			)
			.toBe(1)
		// Back to the track background well before the dwell (500ms) elapses:
		// the flank pair repaints and the arm is cancelled.
		await page.waitForTimeout(200)
		await stepTo(page, trackPoint)
		await expect
			.poll(
				() => border.locator(':scope > .toolbar-stack-space.toolbar-drop-zone.highlighted').count(),
				{ timeout: 3000 }
			)
			.toBe(2)
		// Past the dwell: no track was created.
		await page.waitForTimeout(800)
		expect(await border.locator(':scope > .toolbar-track').count()).toBe(tracksBefore)
	} finally {
		await page.mouse.up()
	}
})

// Phase 3 (parking): hovering a directly-hovered parking gap dwells into a
// new row. The empty parking stack renders its single gap 0 with a hit-test
// label (`:only-child`), so it is directly hoverable: one step onto it arms
// the dwell, which fires into a new row holding the dragged tool.
test('hovering a parking gap dwells into a new row', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator(LEFT).first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const stack = page.locator('.palette-parking').first()
	await expect(stack).toBeVisible()
	const rowsBefore = await page.locator('.palette-parking-row').count()
	const gap = stack.locator(':scope > .toolbar-stack-space.toolbar-drop-zone').first()
	await expect(gap).toBeVisible()
	const guardBox = await guard.boundingBox()
	const gapBox = await gap.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(gapBox).not.toBeNull()
	try {
		await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
		await page.mouse.down()
		await stepTo(page, {
			x: gapBox!.x + gapBox!.width / 2,
			y: gapBox!.y + gapBox!.height / 2,
		})
		// The gap paints while armed …
		await expect
			.poll(
				() => stack.locator(':scope > .toolbar-stack-space.toolbar-drop-zone.highlighted').count(),
				{
					timeout: 3000,
				}
			)
			.toBe(1)
		// … then the dwell fires and a row is created holding the tool.
		await expect
			.poll(() => page.locator('.palette-parking-row').count(), { timeout: 5000 })
			.toBe(rowsBefore + 1)
	} finally {
		await page.mouse.up()
	}
})
