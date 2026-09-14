import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		conditions: ['browser'],
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			$demo: fileURLToPath(new URL('./src/demo', import.meta.url)),
			// Mirrors `kit.alias`: the barrel resolves to core source, not `dist`.
			'@palettable/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'jsdom',
		include: ['tests/**/*.test.ts'],
		setupFiles: ['./tests/setup.ts'],
	},
})
