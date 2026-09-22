import adapter from '@sveltejs/adapter-auto'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		alias: {
			$demo: 'src/demo',
			// Workspace source (not `dist`): lib + demo import the published
			// barrel, resolved here to `packages/core/src`.
			'@palettable/core': '../core/src/index.ts',
		},
	},
}

export default config
