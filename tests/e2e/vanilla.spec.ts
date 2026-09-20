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
	// is rounded at the bottom and flat at the top (and vice versa).
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

test('horizontal command box hides its input until hover', async ({ page }) => {
	const box = page.locator('.toolbar-border[data-region="top"] .palette-default-command-box')
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
