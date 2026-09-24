import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			// Tests import the published barrels; in dev they resolve to source.
			'@palettable/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
			'@palettable/demo-core': fileURLToPath(new URL('../demo-core/src/index.ts', import.meta.url)),
			'@palettable/vue': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
	},
})
