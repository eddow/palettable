import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	// The suite shares one preview server + one browser pool; at full
	// parallelism (11 workers on this box) first-paint assertions
	// (`heading`, `console-overlay`) flake even on the clean tree. Cap at 4.
	workers: 4,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'on-first-retry',
	},
	webServer: {
		command: 'pnpm --filter svelette build && pnpm --filter svelette preview',
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI,
	},
})
