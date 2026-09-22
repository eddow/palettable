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

// Conformance: a whole-toolbar drag never highlights the neighbour track
// gaps — only the last TB-DZ of the previous TB and the first TB-DZ of the
// next TB (same track). The left border holds a single toolbar, so the test
// first extracts a second toolbar onto the track (guard 0 → leading track
// gap), then drags the whole fresh singleton: its own flanking track gaps
// stay dark while the neighbour TB edge paints.
test('dragging a whole toolbar paints neighbour TB edges, not track gaps', async ({ page }) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const gap = border.locator('.toolbar-track-space.toolbar-drop-zone').first()
	await expect(gap).toBeVisible()
	const guardBox = await guard.boundingBox()
	const gapBox = await gap.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(gapBox).not.toBeNull()
	try {
		// Extract tool 0 into a fresh singleton at the leading track gap.
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
		await expect
			.poll(() => border.locator('.toolbar-track-slot').count(), { timeout: 3000 })
			.toBeGreaterThan(1)
		// The extract promotes to a whole-toolbar slide: hover the fresh
		// singleton's tool and assert the neighbour TB edge paints while
		// the own-track flanks stay dark.
		const freshBar = border.locator('.toolbar').first()
		const freshTool = freshBar.locator('.toolbar-item').first()
		const toolBox = await freshTool.boundingBox()
		expect(toolBox).not.toBeNull()
		await page.mouse.move(toolBox!.x + toolBox!.width / 2, toolBox!.y + toolBox!.height / 2, {
			steps: 6,
		})
		await page.waitForTimeout(200)
		// Own flanking track gaps stay dark …
		expect(await border.locator('.toolbar-track-space.toolbar-drop-zone.highlighted').count()).toBe(
			0
		)
		// … and the neighbour TB edge (last DZ of the next TB) paints.
		await expect
			.poll(() => border.locator('.toolbar-item-space.toolbar-drop-zone.highlighted').count(), {
				timeout: 3000,
			})
			.toBeGreaterThan(0)
	} finally {
		await page.mouse.up()
	}
})

// Slide zone (`g U h`): while a whole toolbar slides, every hover inside its
// own slot or the two flanking track gaps paints the same two neighbour TB
// edges and never commits. Hovers *outside* the zone keep their normal
// behaviour — a neighbour toolbar's own tool hover paints its own item gaps.
//
// Regression anchor for the "Toolbars sliding discrepancy": the old shape
// keyed the neighbour edges off the *hovered* slot, so hovering the neighbour
// toolbar painted its own gaps and (on its first DZ) committed a front-merge.
test('sliding a whole toolbar: zone hovers paint the same edges, neighbour hovers stay plain', async ({
	page,
}) => {
	await openConsole(page)
	await expect(page.locator('.palette-ide.editing').first()).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	await expect(guard).toBeVisible()
	const gap = border.locator('.toolbar-track-space.toolbar-drop-zone').first()
	await expect(gap).toBeVisible()
	const guardBox = await guard.boundingBox()
	const gapBox = await gap.boundingBox()
	expect(guardBox).not.toBeNull()
	expect(gapBox).not.toBeNull()

	/** Highlighted DZs as `kind:index` strings, plus the bar they belong to. */
	const highlighted = () =>
		page.evaluate(() => {
			return [...document.querySelectorAll('.toolbar-drop-zone.highlighted')].map((node) => {
				const el = node as HTMLElement
				const bar = el.closest('.toolbar')
				const tools = bar
					? [...bar.querySelectorAll('.toolbar-item')]
							.map((w) => w.getAttribute('data-tool'))
							.join(',')
					: '-'
				const kind = el.hasAttribute('data-item-space-index')
					? `item${el.getAttribute('data-item-space-index')}`
					: el.hasAttribute('data-track-space-index')
						? `track${el.getAttribute('data-track-space-index')}`
						: `stack${el.getAttribute('data-stack-index')}`
				return `${kind}@[${tools}]`
			})
		})

	/** Toolbar contents per slot, to detect an accidental commit. */
	const bars = () =>
		page.evaluate(() => {
			const b = document.querySelector('.toolbar-border[data-region="left"]')
			if (!b) return []
			return [...b.querySelectorAll('.toolbar')].map((bar) =>
				[...bar.querySelectorAll('.toolbar-item')].map((w) => w.getAttribute('data-tool')).join(',')
			)
		})

	try {
		// Extract tool 0 into a fresh singleton at the leading track gap.
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
		await expect
			.poll(() => border.locator('.toolbar-track-slot').count(), { timeout: 3000 })
			.toBeGreaterThan(1)
		const barsBefore = await bars()
		expect(barsBefore.length).toBeGreaterThan(1)

		// ── Inside the zone: the dragged singleton's own tool ──────────────
		const freshBar = border.locator('.toolbar').first()
		const freshTool = freshBar.locator('.toolbar-item').first()
		const toolBox = await freshTool.boundingBox()
		expect(toolBox).not.toBeNull()
		await page.mouse.move(toolBox!.x + toolBox!.width / 2, toolBox!.y + toolBox!.height / 2, {
			steps: 6,
		})
		await page.waitForTimeout(200)
		const zonePaint = await highlighted()
		// Own flanking track gaps stay dark; the neighbour TB edge paints.
		expect(zonePaint.filter((entry) => entry.startsWith('track'))).toEqual([])
		expect(zonePaint.filter((entry) => entry.startsWith('item')).length).toBeGreaterThan(0)
		// No commit: the toolbar contents are unchanged.
		expect(await bars()).toEqual(barsBefore)

		// ── Outside the zone: the neighbour toolbar's own tool ─────────────
		// The neighbour bar is the one that is NOT the dragged singleton.
		const neighbourTool = border.locator('.toolbar').nth(1).locator('.toolbar-item').first()
		const neighbourBox = await neighbourTool.boundingBox()
		expect(neighbourBox).not.toBeNull()
		await page.mouse.move(
			neighbourBox!.x + neighbourBox!.width / 2,
			neighbourBox!.y + neighbourBox!.height / 2,
			{ steps: 6 }
		)
		await page.waitForTimeout(200)
		const outsidePaint = await highlighted()
		// Its own item gaps paint (plain tool hover) …
		expect(outsidePaint.filter((entry) => entry.startsWith('item')).length).toBeGreaterThan(0)
		// … and no commit happened.
		expect(await bars()).toEqual(barsBefore)
	} finally {
		await page.mouse.up()
	}
})
