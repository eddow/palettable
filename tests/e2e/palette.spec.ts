import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
})

// The demo displays a `commandBox` combobox on the top toolbar, so the console
// opens in edit mode (running commands happens inline in the combobox).
async function openConsole(page: import('@playwright/test').Page) {
	await page.getByRole('button', { name: /Terminal/ }).click()
	await expect(page.getByTestId('console-overlay')).toBeVisible()
}

test('command-box combobox runs commands inline', async ({ page }) => {
	// The toolbar command box is a real combobox (text input + results popup),
	// not a launcher button: it runs commands inline on the toolbar.
	await expect(page.getByTestId('command-box-combobox')).toBeVisible()
	await expect(page.getByTestId('console-overlay')).toHaveCount(0)
})

test('console opens in edit mode (commandBox is displayed)', async ({ page }) => {
	// Since a `commandBox` tool is displayed, the console is edit-only: no mode
	// button, add box active.
	await openConsole(page)
	await expect(page.getByTestId('console-mode-toggle')).toHaveCount(0)
	await expect(page.getByTestId('console-input')).toHaveAttribute('placeholder', 'Add to toolbar…')
	// Editing chrome on the underlying toolbars.
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
})

test('drawer opens with axis inversion and closes on Escape', async ({ page }) => {
	await page.getByRole('button', { name: 'More' }).click()
	const popup = page.locator('.svelette-palette-drawer__popup')
	await expect(popup).toBeVisible()
	// Left drawer inverts to a horizontal popup.
	await expect(popup.first()).toHaveClass(/is-horizontal/)
	await page.keyboard.press('Escape')
	await expect(popup).toHaveCount(0)
})

test('inspector shows presentation-only configurator for the selected item', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	// `paletteItemDrag` inspects on `pointerdown`, so dispatch a real
	// pointerdown + pointerup on the edit-mode guard, after which the
	// `data-inspected` highlight reflects the inspecting item.
	await page
		.locator('.toolbar-item-guard')
		.first()
		.evaluate((guard) => {
			const rect = guard.getBoundingClientRect()
			const x = rect.left + rect.width / 2
			const y = rect.top + rect.height / 2
			const init = (buttons: number, button: number) => ({
				bubbles: true,
				cancelable: true,
				button,
				buttons,
				clientX: x,
				clientY: y,
				pointerId: 7,
				isPrimary: true,
			})
			guard.dispatchEvent(new PointerEvent('pointerdown', init(1, 0)))
			window.dispatchEvent(new PointerEvent('pointerup', init(0, 0)))
		})
	// The selected item is highlighted on the toolbar (not re-rendered).
	await expect(page.locator('.toolbar-item[data-inspected="true"]').first()).toBeVisible()
	// The console hosts a presentation-only configurator (no move/remove).
	const panel = page.getByTestId('console-details-panel')
	await expect(panel).toBeVisible()
	await expect(panel.locator('.palette-default-config-table')).toBeVisible()
})

test('layout persist + restore round-trips through localStorage', async ({ page }) => {
	await page.getByTestId('save-layout').click()
	await expect(page.getByTestId('last-action')).toContainText('Layout saved')
	await page.reload()
	await expect(page.getByTestId('layout-restored')).toBeVisible()
	await page.getByTestId('mode-rw-command-first').click()
	await expect(page.getByTestId('last-action')).toContainText('Loaded')
	await page.getByTestId('load-layout').click()
	await expect(page.getByTestId('last-action')).toContainText('Layout loaded')
})
