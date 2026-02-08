# vite-plugin-lint-overlay
[![npm version](https://img.shields.io/npm/v/vite-plugin-lint-overlay.svg?style=flat)](https://www.npmjs.com/package/vite-plugin-lint-overlay) [![license](https://img.shields.io/npm/l/vite-plugin-lint-overlay.svg?style=flat)](./LICENSE)


A Vite dev-server overlay that shows **ESLint** + **TypeScript** problems in an overlay.

- ✅ ESLint diagnostics
- ✅ TypeScript diagnostics (optional)
- ✅ Uses **own worker threads**: one for **ESLint**, one for **TypeScript**
- ✅ Runs on **dev start**, **file events**, and **browser reload**

<p align="center">
	<img
		src="https://raw.githubusercontent.com/max-matinpalo/vite-lint-overlay/main/assets/example.png"
		width="480"
		alt="vite-plugin-lint-overlay example"
	/>
</p>


## Why this plugin?
Built after running into recurring issues with vite-plugin-checker, for example cases where the overlay wouldn’t reliably clear or update after the code was fixed. This plugin uses a snapshot-based update model: workers always send the full current error list, so the UI stays synced with project state.


## Install

```bash
npm install -D vite-plugin-lint-overlay
```

**Peer dependencies:** `vite`, `eslint`, `typescript`.

## Usage (`vite.config.js` / `vite.config.ts`)

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import lintOverlay from 'vite-plugin-lint-overlay';

export default defineConfig({
	plugins: [
		react(),
		lintOverlay({
			rootDir: 'src',
			ts: true, // default false, enables typescript
			tsconfigPath: 'tsconfig.app.json',
		})
	]
});
```

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| **rootDir** | `string` | `'src'` | Root directory to watch and lint for ESLint issues. |
| **ts** | `boolean` | `false` | Set to `true` to enable the TypeScript compiler check. |
| **tsconfigPath** | `string` | `''` | Path to `tsconfig`. Defaults to `tsconfig.json`. |


## How it works under the hood

### Basic setup (lint-overlay.js)

The plugin runs only in `vite dev`. It injects a small client UI
into the page via a **virtual module** (`virtual:lint-overlay-client.js`) and `transformIndexHtml`.

On the server side it starts an **ESLint worker** (`lint-worker.js`) and, if `ts: true`,
a **TypeScript worker** (`ts-worker.js`). Workers send `{ type: "SNAPSHOT", errors: [...] }`
messages back to the plugin. The plugin merges TS + ESLint errors and pushes them to the
browser using Vite’s WebSocket custom event `smart-overlay:update`.

Lint triggers:
- **Initial:** `LINT_ALL` on server start.
- **On client connect (page load/reload/new tab):** resend current state + `LINT_ALL`.
- **On file changes inside `rootDir` matching `.(js|jsx|ts|tsx)`:** `LINT` for that file.
- **On file delete:** `UNLINK` to clear cached results for that file.


### ESLint worker (lint-worker.js)

ESLint lints files inside `rootDir` (default: `src`).

**When do we lint?**
- **Dev start:** lint all matching files.
- **Browser reload / new tab:** lint all again, so the overlay reflects reality after refresh.
- **File edits:** lint only the changed file (add/change). On delete/unlink, we drop cached results for that file.

**Which files are included in “lint all”?**
All files under `rootDir` that match:
- `**/*.{js,jsx,ts,tsx}`

**Why not “dependency-aware” linting?**
TypeScript `--watch` understands the project graph and re-checks all impacted files when one file changes.
ESLint does not automatically track “this change in file A affects file B”, so linting only the edited file can miss new issues in other files until they are scanned.
That’s why this plugin stays fast on edits (single-file lint) but still runs full scans on start and on browser reload.


### TypeScript worker (ts-worker.js)

TypeScript runs in a separate Node worker using the TypeScript **watch** API (`createWatchProgram`).
It loads your `tsconfig` (auto-detects `tsconfig.app.json` / `tsconfig.json` or uses `tsconfigPath`)
and publishes a fresh diagnostics snapshot whenever the program updates.
Because it’s watch-based, TypeScript automatically re-checks all affected files via the project graph.


## Note on Size

The plugin code is tiny! 🪶 Since `eslint` and `typescript` are **peer dependencies**, it reuses the packages already in your project to save disk space and prevent unnecessary bloat.


## License

MIT
