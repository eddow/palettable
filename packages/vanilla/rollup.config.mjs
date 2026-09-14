import { rmSync } from 'node:fs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const ts = (overrides = {}) => typescript({ tsconfig: './tsconfig.build.json', ...overrides })

let cleaned = false
/** Rimraf `dist` once before bundling (first `buildStart` wins). */
const cleanDist = () => ({
	name: 'clean-dist',
	buildStart() {
		if (!cleaned) {
			cleaned = true
			rmSync('dist', { recursive: true, force: true })
		}
	},
})

/** Rollup build for `@palettable/vanilla` — DOM adapter over `@palettable/core`. */
export default [
	{
		input: 'src/index.ts',
		external: ['@palettable/core'],
		output: [
			{ file: 'dist/index.mjs', format: 'esm', sourcemap: true },
			{ file: 'dist/index.cjs', format: 'cjs', sourcemap: true, exports: 'named' },
		],
		plugins: [cleanDist(), nodeResolve(), ts()],
	},
	{
		input: 'src/umd.ts',
		external: ['@palettable/core'],
		output: [
			{
				file: 'dist/index.js',
				format: 'umd',
				name: 'palettableVanilla',
				sourcemap: true,
				globals: { '@palettable/core': 'palettable' },
			},
		],
		plugins: [nodeResolve(), ts({ tsconfig: './tsconfig.umd.json' })],
	},
]
