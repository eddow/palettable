import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			// Demo + tests import the published barrels; in dev they resolve to source.
			'@palettable/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
			'@palettable/demo-core': fileURLToPath(new URL('../demo-core/src/index.ts', import.meta.url)),
			'@palettable/vue': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
		},
	},
	// Ensures workspace packages resolve correctly if using pnpm/npm workspaces
	server: {
		fs: {
			strict: false,
		},
		// Dedicated port: the Vue demo serves on :4175. Playwright's
		// `vue` project targets this origin.
		port: 4175,
		strictPort: true,
	},
	preview: {
		port: 4175,
		strictPort: true,
	},
})
