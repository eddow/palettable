import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: {
			// Tests import the published barrels; in dev they resolve to source.
			'@palettable/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
			'@palettable/vanilla': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
	},
})
