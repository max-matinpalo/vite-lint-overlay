import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


export default function lintOverlay(props = {}) {
	// 1. Destructure configuration with default values
	const { rootDir: rawRoot = 'src' } = props;
	const { tsconfigPath = '' } = props;
	const { ts = false } = props;

	// 2. Sanitize the root directory path for consistent lookups
	const rootDir = String(rawRoot).trim().replace(/\/+$/, '') || 'src';

	// 3. Define virtual module identifiers for the client-side overlay script
	const virtualId = 'virtual:lint-overlay-client.js';
	const resolvedVirtualId = '\0' + virtualId;
	const __dirname = path.dirname(fileURLToPath(import.meta.url));

	// 4. Initialize state for errors and server communication
	let tsErrors = [];
	let lintErrors = [];
	let serverWs = null;

	// 5. Helper to broadcast the latest error state to the browser via WebSocket
	const updateOverlay = () => {
		if (!serverWs) return;
		serverWs.send({
			type: 'custom',
			event: 'smart-overlay:update',
			data: { errors: [...tsErrors, ...lintErrors] }
		});
	};

	return {
		name: 'vite-plugin-lint-overlay',
		apply: 'serve',

		// 6. Map the virtual module ID to a resolvable path
		resolveId(id) {
			if (id === virtualId || id === '/' + virtualId) return resolvedVirtualId;
		},

		// 7. Provide the source code for the client-side overlay
		load(id) {
			if (id === resolvedVirtualId) {
				return fs.readFileSync(path.join(__dirname, 'client-overlay.js'), 'utf-8');
			}
		},

		// 8. Main server integration logic
		configureServer(server) {
			serverWs = server.ws;

			// 9. Initialize the main linting worker thread
			const lintWorker = new Worker(
				new URL('./lint-worker.js', import.meta.url),
				{ type: 'module', workerData: { rootDir } }
			);

			// 10. Centralized error handler for worker crashes
			const handleCrash = (source, msg) => {
				const err = { file: 'Global', message: msg, source, severity: 'error' };
				if (source === 'TS') tsErrors = [err];
				if (source === 'ESLint') lintErrors = [err];
				updateOverlay();
			};

			// 11. Optionally initialize the TypeScript checker worker
			if (ts) {
				const tsWorker = new Worker(
					new URL('./ts-worker.js', import.meta.url),
					{ type: 'module', workerData: { tsconfigPath } }
				);
				tsWorker.on('error', (e) => handleCrash('TS', `TS Worker error: ${e.message}`));
				tsWorker.on('exit', (c) => c !== 0 && handleCrash('TS', `TS Worker died (code ${c})`));
				tsWorker.on('message', (msg) => {
					if (msg.type !== 'SNAPSHOT') return;
					tsErrors = msg.errors;
					updateOverlay();
				});
				server.httpServer?.on('close', () => tsWorker.terminate());
			}

			// 12. Listen for messages and lifecycle events from the lint worker
			lintWorker.on('error', (e) => handleCrash('ESLint', `Lint Worker error: ${e.message}`));
			lintWorker.on('exit', (c) => c !== 0 && handleCrash('ESLint', `Lint Worker died (code ${c})`));
			lintWorker.on('message', (msg) => {
				if (msg.type !== 'SNAPSHOT') return;
				lintErrors = msg.errors;
				updateOverlay();
			});

			// 13. Ensure workers are cleaned up when the server closes
			server.httpServer?.on('close', () => lintWorker.terminate());

			// 14. File filtering logic for linting targets
			const isTarget = (f) => /\.(js|jsx|ts|tsx)$/.test(f);
			const isInRoot = (f) => {
				const rel = path
					.relative(server.config.root || process.cwd(), f)
					.replace(/\\/g, '/');
				return rel === rootDir || rel.startsWith(rootDir + '/');
			};

			// 15. Command the worker to lint specific changed files
			const lintFile = (f) => {
				if (!isTarget(f)) return;
				if (!isInRoot(f)) return;
				lintWorker.postMessage({ type: 'LINT', files: [f] });
			};

			// 16. Trigger initial lint and setup watcher events
			lintWorker.postMessage({ type: 'LINT_ALL' });
			server.ws.on('connection', () => {
				updateOverlay();
				lintWorker.postMessage({ type: 'LINT_ALL' });
			});
			server.watcher.on('add', lintFile);
			server.watcher.on('change', lintFile);
			server.watcher.on('unlink', (f) => {
				if (!isTarget(f)) return;
				if (!isInRoot(f)) return;
				lintWorker.postMessage({ type: 'UNLINK', f });
			});
		},

		// 17. Inject the overlay client script into the entry HTML
		transformIndexHtml() {
			return [{
				tag: 'script',
				attrs: { type: 'module', src: `/${virtualId}` },
				injectTo: 'body-prepend'
			}];
		}
	};
}