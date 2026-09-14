import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
})

async function openConsole(page: import('@playwright/test').Page) {
	// The bottom track hosts a `terminal` button that opens the console.
	await page.getByRole('button', { name: /Terminal/ }).click()
	await expect(page.getByTestId('console-overlay')).toBeVisible()
	// The modal console dims + disables the working zone.
	await expect(page.getByTestId('work-zone')).toHaveClass(/is-dimmed/)
}

test('console opens via backtick in edit mode (commandBox is displayed)', async ({ page }) => {
	// `paletteRoot` listens on the Ide root (tabindex=0), so focus it first —
	// a bare `press('`')` on body never reaches the palette keydown handler.
	// Since a `commandBox` tool is displayed, the console is edit-only: the
	// backtick opens it in edit mode (add box), not run mode.
	await page.locator('.palette-ide').first().click()
	await page.keyboard.press('`')
	await expect(page.getByTestId('console-overlay')).toBeVisible()
	await expect(page.getByTestId('console-input')).toHaveAttribute('placeholder', 'Add to toolbar…')
})

test('console opens via Terminal button and closes on Escape', async ({ page }) => {
	await openConsole(page)
	await page.keyboard.press('Escape')
	await expect(page.getByTestId('console-overlay')).toHaveCount(0)
})

test('command-first mode: no combobox → console command-first + edit button', async ({ page }) => {
	// Load the command-first configuration (no commandBox combobox), then open
	// the console via the Terminal button. It should open in run mode with a
	// square edit-icon button (R/W palette), not in edit mode.
	await page.getByTestId('mode-rw-command-first').click()
	await expect(page.getByTestId('command-box-combobox')).toHaveCount(0)
	await openConsole(page)
	await expect(page.getByTestId('console-mode-toggle')).toBeVisible()
	await expect(page.getByTestId('console-input')).toHaveAttribute('placeholder', 'Command…')
	// Toggling the edit button enters edit mode (add box active).
	await page.getByTestId('console-mode-toggle').click()
	await expect(page.getByTestId('console-input')).toHaveAttribute('placeholder', 'Add to toolbar…')
})

test('read-only mode: no edit button, console stays command-first', async ({ page }) => {
	await page.getByTestId('mode-ro-combobox').click()
	await openConsole(page)
	await expect(page.getByTestId('console-mode-toggle')).toHaveCount(0)
	// Read-only palette never edits, so the console shows its run box (Command…),
	// even though a combobox is displayed inline.
	await expect(page.getByTestId('console-input')).toHaveAttribute('placeholder', 'Command…')
})

test('edit mode makes toolbar items inert (combobox not clickable)', async ({ page }) => {
	await page.getByTestId('mode-rw-combobox').click()
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	// The combobox item content is inert while editing.
	await expect(page.locator('.toolbar-item-content[inert]').first()).toBeVisible()
})

test('edit-only console has no mode button (commandBox is displayed)', async ({ page }) => {
	// The demo displays a `commandBox` (combobox) tool, so the console is
	// edit-only: no mode button, and the add box is active immediately. The
	// add panel appears once an add entry is selected.
	await openConsole(page)
	await expect(page.getByTestId('console-mode-toggle')).toHaveCount(0)
	await expect(page.getByTestId('console-input')).toHaveAttribute('placeholder', 'Add to toolbar…')
	await expect(page.getByTestId('console-add-panel')).toHaveCount(0)
	await expect(page.getByTestId('console-details-panel')).toBeVisible()
	await page
		.getByTestId('console-results')
		.locator('.palette-default-command-result', { hasText: 'Life Support' })
		.first()
		.click()
	await expect(page.getByTestId('console-add-panel')).toBeVisible()
})

test('add-to-toolbar flow selects entry + variant', async ({ page }) => {
	await openConsole(page)
	const addInput = page.getByTestId('console-input')
	await addInput.fill('Life Support')
	await page
		.getByTestId('console-results')
		.locator('.palette-default-command-result', { hasText: 'Life Support' })
		.first()
		.click()
	const panel = page.getByTestId('console-details-panel')
	await expect(panel).toContainText('Life Support')
	await panel
		.locator('.palette-default-add-variant-trigger', { hasText: 'Life Support (editor)' })
		.click()
	await expect(panel.locator('select').first()).toBeVisible()
})

test('add-box results list addable tools (not draggable)', async ({ page }) => {
	await openConsole(page)
	const results = page.getByTestId('console-results')
	const rows = results.locator('.palette-default-command-result')
	await expect(rows.first()).toBeVisible()
	expect(await rows.count()).toBeGreaterThan(0)
	// Catalogue drag was stripped (movement restart): rows are
	// click-to-select, not draggable — mirrors the svelte unit assertion
	// (`console.test.ts`: `getAttribute('draggable')` is null).
	await expect(results.locator('.palette-default-command-result[draggable="true"]')).toHaveCount(0)
})

test('add-box click selects an entry for adding', async ({ page }) => {
	await openConsole(page)
	const results = page.getByTestId('console-results')
	await results
		.locator('.palette-default-command-result', { hasText: 'Life Support' })
		.first()
		.click()
	await expect(page.getByTestId('console-add-panel')).toBeVisible()
	await expect(page.getByTestId('console-details-panel')).toContainText('Life Support')
})
