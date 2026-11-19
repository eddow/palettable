import { expect, test } from '@playwright/test'

test('zone probe', async ({ page }) => {
	await page.goto('/')
	await page.evaluate(() => localStorage.clear())
	await page.reload()
	await expect(page.getByRole('heading', { name: 'Stellar Outpost' })).toBeVisible()
	await page.evaluate(() => {
		const btn = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Terminal')
		)
		;(btn as HTMLElement)?.click()
	})
	await expect(page.getByTestId('console-overlay')).toBeVisible()
	const border = page.locator('.toolbar-border[data-region="left"]').first()
	const guard = border.locator('.toolbar-item-guard').first()
	const gap = border.locator('.toolbar-track-space.toolbar-drop-zone').first()
	const guardBox = await guard.boundingBox()
	const gapBox = await gap.boundingBox()
	await page.mouse.move(guardBox!.x + guardBox!.width / 2, guardBox!.y + guardBox!.height / 2)
	await page.mouse.down()
	for (let i = 1; i <= 12; i += 1) {
		const x = guardBox!.x + guardBox!.width / 2 + ((gapBox!.x + gapBox!.width / 2 - (guardBox!.x + guardBox!.width / 2)) * i) / 12
		const y = guardBox!.y + guardBox!.height / 2 + ((gapBox!.y + gapBox!.height / 2 - (guardBox!.y + guardBox!.height / 2)) * i) / 12
		await page.mouse.move(x, y)
		await page.waitForTimeout(60)
	}
	await expect.poll(() => border.locator('.toolbar-track-slot').count(), { timeout: 3000 }).toBeGreaterThan(1)
	const afterExtract = await page.evaluate(() => {
		const b = document.querySelector('.toolbar-border[data-region="left"]')
		const bars = b ? [...b.querySelectorAll(':scope .toolbar')].map((bar) => [...bar.querySelectorAll('.toolbar-item')].map((w) => w.getAttribute('data-point'))) : []
		const hl = [...document.querySelectorAll('.toolbar-drop-zone.highlighted')].map((n) => {
			const el = n as HTMLElement
			const bar = el.closest('.toolbar')
			const tools = bar ? [...bar.querySelectorAll('.toolbar-item')].map((w) => w.getAttribute('data-point')).join(',') : '-'
			const kind = el.hasAttribute('data-item-space-index') ? `item${el.getAttribute('data-item-space-index')}` : el.hasAttribute('data-track-space-index') ? `track${el.getAttribute('data-track-space-index')}` : `stack${el.getAttribute('data-stack-index')}`
			return `${kind}@[${tools}]`
		})
		return { bars, hl }
	})
	console.log('AFTER-EXTRACT ' + JSON.stringify(afterExtract))
	await page.evaluate(() => { (window as unknown as { __zonelog?: string[] }).__zonelog = [] })
	const freshBar = border.locator('.toolbar').first()
	const freshTool = freshBar.locator('.toolbar-item').first()
	const toolBox = await freshTool.boundingBox()
	await page.mouse.move(toolBox!.x + toolBox!.width / 2, toolBox!.y + toolBox!.height / 2, { steps: 6 })
	await page.waitForTimeout(300)
	const dump = await page.evaluate(() => {
		const log = (window as unknown as { __zonelog?: string[] }).__zonelog ?? []
		const hl = [...document.querySelectorAll('.toolbar-drop-zone.highlighted')].map((n) => {
			const el = n as HTMLElement
			const bar = el.closest('.toolbar')
			const tools = bar ? [...bar.querySelectorAll('.toolbar-item')].map((w) => w.getAttribute('data-point')).join(',') : '-'
			const kind = el.hasAttribute('data-item-space-index') ? `item${el.getAttribute('data-item-space-index')}` : el.hasAttribute('data-track-space-index') ? `track${el.getAttribute('data-track-space-index')}` : `stack${el.getAttribute('data-stack-index')}`
			return `${kind}@[${tools}]`
		})
		return { hl, log: log.slice(-12) }
	})
	console.log('PROBE ' + JSON.stringify(dump))
	console.log('ZONELOG ' + JSON.stringify(dump.log))
})
