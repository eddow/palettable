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
		trace: 'on-first-retry',
	},
	// One project per demo, both running the same specs (mitosis parity
	// target). The vanilla demo is at parity now, so both projects run the
	// shared suite; the vanilla smoke spec is vanilla-only.
	projects: [
		{
			name: 'svelte',
			use: { baseURL: 'http://localhost:4173' },
			testIgnore: [/vanilla\.spec\.ts/, /ship-context\.spec\.ts/],
		},
		{
			name: 'vanilla',
			use: { baseURL: 'http://localhost:4174' },
			testIgnore: /vanilla\.spec\.ts/,
		},
		{
			name: 'vanilla-smoke',
			use: { baseURL: 'http://localhost:4174' },
			testMatch: /vanilla\.spec\.ts/,
		},
	],
	webServer: [
		{
			command: 'pnpm build:svelte && pnpm preview:svelte',
			url: 'http://localhost:4173',
			reuseExistingServer: !process.env.CI,
		},
		{
			// Vanilla has no `vite build` demo bundle (its `build` is the
			// rollup library), so e2e serves the vite dev server (:4174).
			command: 'pnpm dev:vanilla',
			url: 'http://localhost:4174',
			reuseExistingServer: !process.env.CI,
		},
	],
})
