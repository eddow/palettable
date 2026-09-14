import { expect, test } from '@playwright/test'

// Vanilla demo parity smoke: the vanilla demo is the same Stellar Outpost
// demo as the svelte one (mitosis Phase 10) — heading, IDE chrome, and the
// toolbar command-box combobox render on first paint.
test('vanilla demo renders the Stellar Outpost IDE', async ({ page }) => {
	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
	await expect(page.locator('.palette-ide').first()).toBeVisible()
	await expect(page.getByTestId('command-box-combobox')).toBeVisible()
	await expect(page.getByTestId('work-zone')).toBeVisible()
})
