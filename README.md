# vite-plugin-lint-overlay

A Vite dev-server overlay that shows **TypeScript** + **ESLint** problems in a single UI. 😊

- ✅ TypeScript diagnostics (optional, watch mode)
- ✅ ESLint diagnostics (incremental, cached)
- ✅ Runs on **dev start**, **file events**, and **browser reload**

---

## Install

```bash
npm install -D vite-plugin-lint-overlay
```

**Peer dependencies:** `vite`, `eslint`, `typescript`.

---

## Usage

`vite.config.js` / `vite.config.ts`

```js
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
```

---

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **rootDir** | `string` | `'src'` | Root directory to watch and lint for ESLint issues. |
| **ts** | `boolean` | `false` | Set to `true` to enable the TypeScript compiler check. |
| **tsconfigPath** | `string` | `''` | Path to `tsconfig`. Defaults to `tsconfig.app.json` or `tsconfig.json`. |

---

## License

MIT