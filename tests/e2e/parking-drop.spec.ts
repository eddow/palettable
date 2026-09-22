import { expect, test } from '@playwright/test'

const LAYOUT_KEY = 'palettable-demo-layout-v1'

/**
 * Left border with two tools + one parked row holding a third tool. Parking is
 * seeded through the persisted layout because the dwell-drop that would create
 * a row is Phase 3 (not implemented in vanilla yet). The top border keeps a
 * `commandBox` so the console opens in edit mode (the demo's default layout is
 * replaced wholesale by the stored snapshot).
 */
function layoutWithParkingRow() {
	return {
		version: 1,
		borders: {
			top: [
				{
					space: 1,
					toolbar: [
						{
							control: 'commandBox',
							config: { icon: '⌘', label: 'Command', hint: 'Search and run a command' },
						},
					],
				},
			],
			right: [],
			bottom: [
				{
					space: 1,
					toolbar: [
						{
							point: 'console',
							control: 'button',
							config: { icon: '💻', label: 'Terminal', hint: 'Head button (run)' },
						},
					],
				},
			],
			left: [
				{
					space: 1,
					toolbar: [
						{ point: 'autoOxygen', control: 'toggle' },
						{ point: 'shieldGenerator', control: 'toggle' },
					],
				},
			],
		},
		parking: [[{ point: 'fastMode', control: 'toggle' }]],
	}
}

async function loadLayout(page: import('@playwright/test').Page) {
	await page.goto('/')
	await page.evaluate(
		({ key, layout }) => {
			localStorage.clear()
			localStorage.setItem(key, JSON.stringify(layout))
		},
		{ key: LAYOUT_KEY, layout: layoutWithParkingRow() }
	)
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
	// The stored snapshot is only spliced in on demand (the demo seeds its
	// preset at init), so trigger the "Load layout" button.
	await page.getByTestId('load-layout').click()
}

// The demo displays a `commandBox` combobox on the top toolbar, so the console
// opens in edit mode (running commands happens inline in the combobox).
async function openConsole(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		const btn = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Terminal')
		)
		;(btn as HTMLElement)?.click()
	})
	await expect(page.getByTestId('console-overlay')).toBeVisible()
}

/** Step the pointer from a guard onto a raw viewport point. */
async function dragOntoPoint(
	page: import('@playwright/test').Page,
	guardBox: { x: number; y: number; width: number; height: number },
	point: { x: number; y: number }
): Promise<void> {
	const from = { x: guardBox.x + guardBox.width / 2, y: guardBox.y + guardBox.height / 2 }
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	const steps = 12
	for (let i = 1; i <= steps; i += 1) {
		await page.mouse.move(
			from.x + ((point.x - from.x) * i) / steps,
			from.y + ((point.y - from.y) * i) / steps
		)
		await page.waitForTimeout(60)
	}
}

// Conformance: an item-gap hover on a PARKING row is the same `item-gap` kind
// as on a border toolbar — the container decides the commit (ownership
// transfer into the row, not a border merge). Regression guard: the Phase 1
// `Hoverable` mapping bailed on any toolbar that was not in a border, so
// parking drops silently did nothing (no commit, no paint).
test('dragging a tool onto a parking row transfers ownership into the row', async ({ page }) => {
	await loadLayout(page)
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()

	const border = page.locator('.toolbar-border[data-region="left"]').first()
	// Parking renders inside the console overlay, so the row exists only once
	// the console is open.
	const row = page.locator('.palette-parking-row').first()
	await expect(row).toBeVisible()
	const borderBefore = await border.locator('.toolbar-item').count()
	const parkedBefore = await row.locator('.toolbar-item').count()
	expect(borderBefore).toBe(2)
	expect(parkedBefore).toBe(1)

	// The row's leading item gap: hovering the item first paints the nearest
	// free gaps (active-item fallback), which expands them from zero size —
	// only then is the gap hittable. Two steps, mirroring the other specs.
	const firstItem = row.locator('.toolbar-item').first()
	const itemBox = await firstItem.boundingBox()
	expect(itemBox).not.toBeNull()
	const guardBox = await border.locator('.toolbar-item-guard').first().boundingBox()
	expect(guardBox).not.toBeNull()
	const rowGap = row.locator('.toolbar-item-space.toolbar-drop-zone[data-item-space-index="0"]')
	try {
		// Step 1: onto the item → paints the flanking gaps.
		await dragOntoPoint(page, guardBox!, {
			x: itemBox!.x + itemBox!.width / 2,
			y: itemBox!.y + itemBox!.height / 2,
		})
		await expect(rowGap).toBeVisible()
		// Step 2: onto the now-expanded gap → commits the ownership transfer.
		const gapBox = await rowGap.boundingBox()
		expect(gapBox).not.toBeNull()
		await page.mouse.move(gapBox!.x + gapBox!.width / 2, gapBox!.y + gapBox!.height / 2, {
			steps: 6,
		})
		// The tool left the border toolbar and landed in the parked row.
		await expect
			.poll(() => row.locator('.toolbar-item').count(), { timeout: 3000 })
			.toBe(parkedBefore + 1)
		await expect
			.poll(() => border.locator('.toolbar-item').count(), { timeout: 3000 })
			.toBe(borderBefore - 1)
	} finally {
		await page.mouse.up()
	}
})
