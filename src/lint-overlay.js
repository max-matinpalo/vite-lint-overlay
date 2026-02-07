import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


export default function lintOverlay(props = {}) {
	const { rootDir: rawRoot = 'src' } = props;
	const { tsconfigPath = '' } = props;
	const { ts = false } = props;
	const rootDir = String(rawRoot).trim().replace(/\/+$/, '') || 'src';
	const virtualId = 'virtual:lint-overlay-client.js';
	const resolvedVirtualId = '\0' + virtualId;
	const __dirname = path.dirname(fileURLToPath(import.meta.url));

	let tsErrors = [];
	let lintErrors = [];
	let serverWs = null;

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

		resolveId(id) {
			if (id === virtualId || id === '/' + virtualId) return resolvedVirtualId;
		},

		load(id) {
			if (id === resolvedVirtualId) {
				return fs.readFileSync(path.join(__dirname, 'client-overlay.js'), 'utf-8');
			}
		},

		configureServer(server) {
			serverWs = server.ws;
			const lintWorker = new Worker(
				new URL('./lint-worker.js', import.meta.url),
				{ type: 'module', workerData: { rootDir } }
			);
			const handleCrash = (source, msg) => {
				const err = { file: 'Global', message: msg, source, severity: 'error' };
				if (source === 'TS') tsErrors = [err];
				if (source === 'ESLint') lintErrors = [err];
				updateOverlay();
			};

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

			lintWorker.on('error', (e) => handleCrash('ESLint', `Lint Worker error: ${e.message}`));
			lintWorker.on('exit', (c) => c !== 0 && handleCrash('ESLint', `Lint Worker died (code ${c})`));
			lintWorker.on('message', (msg) => {
				if (msg.type !== 'SNAPSHOT') return;
				lintErrors = msg.errors;
				updateOverlay();
			});

			server.httpServer?.on('close', () => lintWorker.terminate());
			const isTarget = (f) => /\.(js|jsx|ts|tsx)$/.test(f);
			const isInRoot = (f) => {
				const rel = path
					.relative(server.config.root || process.cwd(), f)
					.replace(/\\/g, '/');
				return rel === rootDir || rel.startsWith(rootDir + '/');
			};

			const lintFile = (f) => {
				if (!isTarget(f)) return;
				if (!isInRoot(f)) return;
				lintWorker.postMessage({ type: 'LINT', files: [f] });
			};

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

		transformIndexHtml() {
			return [{
				tag: 'script',
				attrs: { type: 'module', src: `/${virtualId}` },
				injectTo: 'body-prepend'
			}];
		}
	};
}