import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: {
			// Tests import the published barrel; in dev it resolves to source.
			'@palettable/core': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
})
