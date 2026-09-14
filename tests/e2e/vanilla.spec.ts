import { expect, test } from '@playwright/test'

// Vanilla demo smoke: asserts the current barrel-only demo renders. This is
// the only spec the `vanilla` project runs until the vanilla demo reaches
// parity with the svelte demo (mitosis plan) — at that point the shared
// suite runs unfiltered against both demos.
test('vanilla demo renders its points', async ({ page }) => {
	await page.goto('/')
	await expect(page.locator('[data-palettable-vanilla] li')).toHaveCount(1)
	await expect(page.locator('[data-palettable-vanilla] li').first()).toContainText('Save game')
})
