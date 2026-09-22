import { expect, test } from '@playwright/test'

// Fleet context demo (vanilla-only: the svelte demo has no `ship` context
// bag — svelte stays frozen until Phase 12 per plans/mitosis.md). The
// work-zone hosts selectable ship panels (one-or-none selected); the bottom
// toolbar hosts the contextual tools (status + shields toggle + reactor
// slider + gated Fire button) bound to the `ship` bag.
test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
	await expect(page.getByTestId('fleet')).toBeVisible()
})

function bottomBar(page: import('@playwright/test').Page) {
	return page.locator('.toolbar-border[data-region="bottom"]')
}

function shieldsToggle(page: import('@playwright/test').Page) {
	return bottomBar(page).locator('button[title^="Ship shields"]')
}

function fireButton(page: import('@playwright/test').Page) {
	return bottomBar(page).locator('button[title^="Fire"]')
}

function shipStatus(page: import('@playwright/test').Page) {
	return bottomBar(page).locator('.palette-default-status-value').last()
}

test('fleet cards render three ships; none selected initially', async ({ page }) => {
	await expect(page.getByTestId('ship-card-aurora')).toBeVisible()
	await expect(page.getByTestId('ship-card-borealis')).toBeVisible()
	await expect(page.getByTestId('ship-card-cinder')).toBeVisible()
	for (const id of ['aurora', 'borealis', 'cinder']) {
		await expect(page.getByTestId(`ship-card-${id}`)).toHaveAttribute('aria-pressed', 'false')
	}
	// No selection: Fire is gated off.
	await expect(fireButton(page)).toBeDisabled()
})

test('selecting a ship hydrates the contextual tools; toggle back deselects', async ({ page }) => {
	await page.getByTestId('ship-card-aurora').click()
	await expect(page.getByTestId('ship-card-aurora')).toHaveAttribute('aria-pressed', 'true')
	// Status shows the selected ship name; shields reflect Aurora (up); Fire enables.
	await expect(shipStatus(page)).toHaveText('🚀 Aurora')
	await expect(shieldsToggle(page)).toHaveAttribute('aria-pressed', 'true')
	await expect(fireButton(page)).toBeEnabled()
	// Clicking the selected card again deselects: Fire gates off.
	await page.getByTestId('ship-card-aurora').click()
	await expect(page.getByTestId('ship-card-aurora')).toHaveAttribute('aria-pressed', 'false')
	await expect(fireButton(page)).toBeDisabled()
})

test('switching ships swaps values; toolbar edits flow back to the cards', async ({ page }) => {
	await page.getByTestId('ship-card-borealis').click()
	await expect(shipStatus(page)).toHaveText('🛸 Borealis')
	// Borealis shields start down.
	await expect(shieldsToggle(page)).toHaveAttribute('aria-pressed', 'false')
	// Toolbar toggle writes into the ship bag; the fleet card mirrors it.
	await shieldsToggle(page).click()
	await expect(shieldsToggle(page)).toHaveAttribute('aria-pressed', 'true')
	await expect(page.getByTestId('ship-card-borealis')).toContainText('up')
	// Switching to Cinder shows Cinder's own values (shields up).
	await page.getByTestId('ship-card-cinder').click()
	await expect(shipStatus(page)).toHaveText('🛰️ Cinder')
	await expect(shieldsToggle(page)).toHaveAttribute('aria-pressed', 'true')
})

test('firing records the selected ship in last-action', async ({ page }) => {
	await page.getByTestId('ship-card-cinder').click()
	await fireButton(page).click()
	await expect(page.getByTestId('last-action')).toHaveText(/Cinder fired a torpedo!/)
})
