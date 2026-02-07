# vite-plugin-lint-overlay

A Vite dev-server overlay that shows **TypeScript** + **ESLint** problems in a single UI. 😊 - ✅ TypeScript diagnostics (optional, watch mode) - ✅ ESLint diagnostics (incremental, cached) - ✅ Runs on **dev start**, **file events**, and **browser reload** ---

<p align="center">
	<img
		src="https://raw.githubusercontent.com/max-matinpalo/vite-lint-overlay/main/assets/example.png"
		width="480"
		alt="vite-plugin-lint-overlay example"
	/>
</p>

## Install ```bash
npm install -D vite-plugin-lint-overlay
``` **Peer dependencies:** `vite`, `eslint`, `typescript`. ---

## Usage `vite.config.js` / `vite.config.ts` ```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import lintOverlay from 'vite-plugin-lint-overlay';

export default defineConfig({
	plugins: [
		react(),
		lintOverlay({
			rootDir: 'src',
			ts: true // Enable TypeScript checks
		})
	]
});
``` ---

## Options | Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **rootDir** | `string` | `'src'` | Root directory to watch and lint for ESLint issues. | | **ts** | `boolean` | `false` | Set to `true` to enable the TypeScript compiler check. | | **tsconfigPath** | `string` | `''` | Path to `tsconfig`. Defaults to `tsconfig.json`. | ---

## Note on Size The plugin code is tiny! 🪶 Since `eslint` and `typescript` are **peer dependencies**, it reuses the packages already in your project to save disk space and prevent unnecessary bloat. 😊 ---

## License MIT ````

Would you like me to help you set up a GitHub Action to automate linting on every push? 😊