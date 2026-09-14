import { VanillaAdapter } from '@palettable/vanilla'

// Barrel-only proof: this import must resolve via the vite + tsconfig
// `@palettable/vanilla → src/index.ts` alias (never a relative `../src` path).
const adapter = new VanillaAdapter([
	{
		id: 'saveGame',
		label: 'Save game',
		type: 'action',
		can: true,
		run() {},
	},
])

const app = document.querySelector('#app')
if (app instanceof HTMLElement) {
	app.append(adapter.root)
	adapter.mount()
}
