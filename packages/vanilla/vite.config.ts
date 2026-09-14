import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
	resolve: {
		alias: {
			// Demo + tests import the published barrels; in dev they resolve to source.
			'@palettable/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
			'@palettable/vanilla': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
		},
	},
	// Ensures workspace packages resolve correctly if using pnpm/npm workspaces
	server: {
		fs: {
			strict: false,
		},
		// Dedicated port: the svelte demo serves on :4173, so vanilla takes
		// :4174. Playwright's `vanilla` project targets this origin.
		port: 4174,
		strictPort: true,
	},
	preview: {
		port: 4174,
		strictPort: true,
	},
})
