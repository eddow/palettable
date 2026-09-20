import { expect, test } from '@playwright/test'

// Vanilla demo parity smoke: the vanilla demo is the same Stellar Outpost
// demo as the svelte one (mitosis Phase 10) — heading, IDE chrome, and the
// toolbar command-box combobox render on first paint.
test('vanilla demo renders the Stellar Outpost IDE', async ({ page }) => {
	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
	await expect(page.locator('.palette-ide').first()).toBeVisible()
	await expect(page.getByTestId('command-box-combobox').first()).toBeVisible()
	await expect(page.getByTestId('work-zone')).toBeVisible()
})

// ── Axis-aware items (vanilla-only: the svelte demo has no vertical
// command box / vertical segmented yet) ────────────────────────────────────

test.beforeEach(async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
})

/** The vertical command box lives on the right border. */
function verticalCommandBox(page: import('@playwright/test').Page) {
	return page.locator('.toolbar-border[data-region="right"] .palette-default-command-box')
}

test('vertical command box is icon-only and does not widen its toolbar', async ({ page }) => {
	const box = verticalCommandBox(page)
	await expect(box).toBeVisible()
	await expect(box).toHaveClass(/palette-default-layout-vertical/)

	const bar = page.locator('.toolbar-border[data-region="right"] .toolbar').first()
	const before = await bar.evaluate((node) => node.getBoundingClientRect().width)

	// The resting box is exactly the standardized perpendicular size.
	const boxWidth = await box.evaluate((node) => node.getBoundingClientRect().width)
	expect(boxWidth).toBeCloseTo(40, 0) // 2.5rem @ 16px

	// Hovering reveals the input overlay without changing the toolbar width.
	await box.hover()
	await expect(box.locator('.palette-default-command-input')).toBeVisible()
	const after = await bar.evaluate((node) => node.getBoundingClientRect().width)
	expect(after).toBeCloseTo(before, 0)
})

test('vertical command box overlay opens over the IDE and runs a command', async ({ page }) => {
	const box = verticalCommandBox(page)
	await box.hover()
	const input = box.locator('.palette-default-command-input')
	await input.fill('Life')
	await expect(box.locator('.palette-default-command-results')).toBeVisible()
	await box.locator('.palette-default-command-result').first().click()
	// The command ran: the demo's last-action readout reflects it.
	await expect(page.getByTestId('last-action')).not.toHaveText(/Last action: $/)
})

test('vertical segmented reveals option text on hover without resizing', async ({ page }) => {
	// The left border hosts the `powerPriority` segmented (enum).
	const group = page.locator(
		'.toolbar-border[data-region="left"] .palette-default-segmented.palette-default-layout-vertical'
	)
	await expect(group).toBeVisible()
	const labels = group.locator('.palette-default-choice')

	// At rest every label is an invisible overlay (icons only).
	for (const label of await labels.all()) {
		await expect(label).toHaveCSS('opacity', '0')
	}
	const before = await group.evaluate((node) => node.getBoundingClientRect().width)

	// Hovering anywhere over the group reveals ALL labels together (not one by one).
	await group.hover()
	for (const label of await labels.all()) {
		await expect(label).toHaveCSS('opacity', '1')
	}
	const after = await group.evaluate((node) => node.getBoundingClientRect().width)
	expect(after).toBeCloseTo(before, 0)
})

test('vertical groups round their visual ends, not their DOM ends', async ({ page }) => {
	// Vertical groups use `column-reverse`: the first DOM child renders at the
	// BOTTOM. The corner radii must follow the visual ends, so the first child
	// is rounded at the bottom and flat at the top (and vice versa). The
	// workspace-side corners are always square (joined-box joint with the
	// hover overlay), so this asserts the toolbar-outer (left) corners.
	const buttons = page.locator(
		'.toolbar-border[data-region="left"] .palette-default-segmented.palette-default-layout-vertical button'
	)
	const first = await buttons.first().evaluate((node) => {
		const cs = getComputedStyle(node)
		return { top: cs.borderTopLeftRadius, bottom: cs.borderBottomLeftRadius }
	})
	const last = await buttons.last().evaluate((node) => {
		const cs = getComputedStyle(node)
		return { top: cs.borderTopLeftRadius, bottom: cs.borderBottomLeftRadius }
	})
	// First DOM child = visual bottom: rounded bottom, flat top.
	expect(Number.parseFloat(first.bottom)).toBeGreaterThan(0)
	expect(Number.parseFloat(first.top)).toBe(0)
	// Last DOM child = visual top: rounded top, flat bottom.
	expect(Number.parseFloat(last.top)).toBeGreaterThan(0)
	expect(Number.parseFloat(last.bottom)).toBe(0)
})

test('drawer slider keeps its toolbar width and reveals a perpendicular range', async ({
	page,
}) => {
	// The right border hosts the `drawerSlider` demo item.
	const slider = page.locator(
		'.toolbar-border[data-region="right"] .palette-default-slider-drawer[title^="Sim speed drawer"]'
	)
	await expect(slider).toBeVisible()
	// The value readout is part of the always-visible trigger segment.
	const trigger = slider.locator('.palette-default-slider-trigger')
	await expect(trigger).toContainText('1')

	const bar = page.locator('.toolbar-border[data-region="right"] .toolbar').first()
	const before = await bar.evaluate((node) => node.getBoundingClientRect().width)

	// The range is hidden at rest and revealed on hover. It runs *perpendicular*
	// to the toolbar, so a vertical toolbar gets a horizontal track.
	// Opacity lives on the `slider-track` pill half (the input stays a bare
	// control filling it); the axis lives on the input itself.
	const track = slider.locator('.palette-default-slider-track')
	const input = slider.locator('input[type="range"]')
	await expect(track).toHaveCSS('opacity', '0')
	await slider.hover()
	await expect(track).toHaveCSS('opacity', '1')
	await expect(input).toHaveCSS('writing-mode', 'horizontal-tb')

	const after = await bar.evaluate((node) => node.getBoundingClientRect().width)
	expect(after).toBeCloseTo(before, 0)
})

test('inline slider runs along the toolbar axis', async ({ page }) => {
	// Left border = vertical toolbar: the inline range is vertical too.
	const slider = page.locator('.toolbar-border[data-region="left"] .palette-default-slider-inline')
	await expect(slider).toBeVisible()
	const input = slider.locator('input[type="range"]')
	await expect(input).toHaveCSS('writing-mode', 'vertical-lr')
	// Always visible (no drawer behaviour).
	await expect(input).toHaveCSS('opacity', '1')
	// Its perpendicular width stays standardized so the toolbar is not widened.
	const sliderW = await slider.evaluate((node) => node.getBoundingClientRect().width)
	expect(sliderW).toBeCloseTo(40, 0)
})

test('horizontal command box hides its input until hover', async ({ page }) => {	const box = page.locator('.toolbar-border[data-region="top"] .palette-default-command-box')
	const input = box.locator('.palette-default-command-input')
	const text = box.locator('.palette-default-command-text')

	// At rest the shell reads as icon-only while empty (no redundant hint);
	// the input is invisible.
	await expect(input).toHaveCSS('opacity', '0')
	await expect(text).toBeHidden()

	// A populated box stays readable while collapsed.
	await box.hover()
	await input.fill('Life')
	await input.blur()
	await page.getByRole('heading', { name: 'Stellar Outpost' }).hover()
	await expect(text).toBeVisible()
	await expect(text).not.toHaveClass(/is-hint/)

	await box.hover()
	await expect(input).toHaveCSS('opacity', '1')
	// The readout yields to the revealed input.
	await expect(text).toBeHidden()
})

// ── Select (custom listbox) ───────────────────────────────────────────────

test('horizontal select shows icon + label and opens a full-text list on click', async ({
	page,
}) => {
	// The left drawer's nested popup hosts a `colonyTheme` select (enum) on a
	// horizontal toolbar — open the drawer first.
	await page.getByRole('button', { name: 'More' }).click()
	const popup = page.locator('.palettable-drawer__popup')
	await expect(popup).toBeVisible()
	const box = popup.locator('.palette-default-select.palette-default-layout-horizontal')
	await expect(box).toBeVisible()
	const trigger = box.locator('.palette-default-select-trigger')
	// Closed box mirrors the slider trigger: tool icon + value icon + label.
	await expect(trigger.locator('.palette-default-select-value')).toBeVisible()
	await expect(trigger.locator('.palette-default-tool-icon')).toContainText('🪐')
	await expect(trigger.locator('.palette-default-value-icon')).toContainText('🔴')
	await expect(trigger.locator('.palette-default-choice')).toContainText('Mars')
	const list = box.locator('.palette-default-select-list')
	await expect(list).toBeHidden()
	await expect(trigger).toHaveAttribute('aria-expanded', 'false')

	await trigger.click()
	await expect(list).toBeVisible()
	await expect(trigger).toHaveAttribute('aria-expanded', 'true')
	// Rows always render icon + full text.
	const rows = list.locator('.palette-default-select-option')
	await expect(rows).toHaveCount(4)
	await expect(rows.nth(1)).toContainText('Neptune')
	await expect(rows.nth(1).locator('.palette-default-choice-icon')).toBeVisible()

	await rows.nth(1).click()
	await expect(list).toBeHidden()
	await expect(trigger.locator('.palette-default-choice')).toContainText('Neptune')
	await page.keyboard.press('Escape')
})

test('vertical select stacks tool + value icons and extends to text on hover', async ({
	page,
}) => {
	// The left border hosts the `colonyTheme` select (enum, tool icon 🪐).
	const box = page.locator(
		'.toolbar-border[data-region="left"] .palette-default-select.palette-default-layout-vertical'
	)
	await expect(box).toBeVisible()
	const trigger = box.locator('.palette-default-select-trigger')
	const chip = trigger.locator('.palette-default-select-value')
	// Vertical: the closed label is a direct child of the trigger, sibling of
	// the icon chip (segmented pattern) — not nested inside the chip.
	const label = trigger.locator(':scope > .palette-default-choice')

	// At rest the trigger stacks tool icon above value icon (like numerics:
	// ☀️ over 1.2) in the standardized width.
	await expect(chip.locator('.palette-default-tool-icon')).toContainText('🪐')
	await expect(chip.locator('.palette-default-value-icon')).toContainText('🔴')
	const triggerBox = await trigger.evaluate((node) => node.getBoundingClientRect())
	expect(triggerBox.width).toBeCloseTo(40, 0)
	// The label is an invisible overlay at rest.
	await expect(label).toHaveCSS('opacity', '0')

	const bar = page.locator('.toolbar-border[data-region="left"] .toolbar').first()
	const before = await bar.evaluate((node) => node.getBoundingClientRect().width)
	// Raw mouse move: `locator.hover()` never stabilizes on these overlays.
	const center = await trigger.evaluate((node) => {
		const rect = node.getBoundingClientRect()
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
	})
	await page.mouse.move(center.x, center.y)
	// Hover extends the icon stack into an icon+text select box beside the
	// toolbar (segmented pattern) without resizing it.
	await expect(label).toHaveCSS('opacity', '1')
	await expect(label).toContainText('Mars')
	const after = await bar.evaluate((node) => node.getBoundingClientRect().width)
	expect(after).toBeCloseTo(before, 0)

	// The list opens only on click (never hover) with full-text rows.
	await trigger.click()
	const list = box.locator('.palette-default-select-list')
	await expect(list).toBeVisible()
	await expect(list.locator('.palette-default-select-option').nth(2)).toContainText('Void')
})
