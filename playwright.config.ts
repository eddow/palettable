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
	// Vanilla demo on :4174, Vue demo on :4175, plus a `default-head`
	// project for the default-head visual spec (head presentation, not
	// core semantics).
	projects: [
		{
			name: 'vanilla',
			use: { baseURL: 'http://localhost:4174' },
			testIgnore: /default-head\.spec\.ts/,
		},
		{
			name: 'vue',
			use: { baseURL: 'http://localhost:4175' },
			testIgnore: /default-head\.spec\.ts/,
		},
		{
			name: 'default-head',
			use: { baseURL: 'http://localhost:4174' },
			testMatch: /default-head\.spec\.ts/,
		},
	],
	webServer: [
		{
			// Vanilla has no `vite build` demo bundle (its `build` is the
			// rollup library), so e2e serves the vite dev server (:4174).
			command: 'pnpm dev:vanilla',
			url: 'http://localhost:4174',
			reuseExistingServer: !process.env.CI,
		},
		{
			// Vue demo serves its own vite dev server (:4175).
			command: 'pnpm dev:vue',
			url: 'http://localhost:4175',
			reuseExistingServer: !process.env.CI,
		},
	],
})
