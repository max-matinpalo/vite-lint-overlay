import { parentPort, workerData } from 'node:worker_threads';
import { ESLint } from 'eslint';
import path from 'node:path';

if (!parentPort) throw new Error('No parentPort');

let rootDir = workerData?.rootDir || 'src';
rootDir = String(rootDir).trim().replace(/\/+$/, '');
if (!rootDir) rootDir = 'src';

const ALL = [`${rootDir}/**/*.{js,jsx,ts,tsx}`];
const cache = new Map();
const CWD = process.cwd();
const rel = (p) => path.relative(CWD, p).replace(/\\/g, '/');

let eslint = null;
let running = false;
let pending = null;

const snap = (errors) => parentPort.postMessage({ type: 'SNAPSHOT', errors });

function errText(e) {
	if (!e) return 'Unknown error';
	if (typeof e === 'string') return e;
	const msg = e.message ? String(e.message) : String(e);
	const stack = e.stack
		? String(e.stack).split('\n').slice(0, 2).join('\n')
		: '';
	return stack ? `${msg}\n${stack}` : msg;
}

function globalError(message) {
	return [{
		file: 'Global',
		line: 0,
		source: 'ESLint',
		severity: 'error',
		message
	}];
}

function unlinkFile(f) {
	if (!f) return;
	cache.delete(rel(f));
	snap([...cache.values()].flat());
}

async function run() {
	while (pending) {
		const job = pending;
		pending = null;

		if (!eslint) {
			try {
				eslint = new ESLint();
			} catch (e) {
				snap(globalError(`Init failed: ${errText(e)}`));
				continue;
			}
		}

		try {
			if (job.reset) cache.clear();

			const res = await eslint.lintFiles(job.files);

			res.forEach((r) => {
				const msgs = r.messages.filter((m) => m.severity > 0);
				const key = rel(r.filePath);
				if (!msgs.length) return cache.delete(key);

				cache.set(key, msgs.map((m) => ({
					file: key,
					line: m.line || 0,
					message: m.message,
					source: 'ESLint',
					severity: m.severity === 2 ? 'error' : 'warning'
				})));
			});

			snap([...cache.values()].flat());
		} catch (e) {
			snap(globalError(`Lint crashed: ${errText(e)}`));
		}
	}

	running = false;
}

parentPort.on('message', (msg) => {
	if (msg?.type === 'UNLINK') {
		unlinkFile(msg.f);
		return;
	}

	const global = msg?.type === 'LINT_ALL';
	if (pending?.reset && !global) return;

	pending = {
		files: global ? ALL : (Array.isArray(msg.files) ? msg.files : []),
		reset: global
	};

	if (!running) {
		running = true;
		run();
	}
});
