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
	// 1. Validate the error input
	if (!e) return 'Unknown error';
	if (typeof e === 'string') return e;

	// 2. Extract message and limit stack trace for better readability
	const msg = e.message ? String(e.message) : String(e);
	const stack = e.stack
		? String(e.stack).split('\n').slice(0, 2).join('\n')
		: '';

	// 3. Return the formatted error string
	return stack ? `${msg}\n${stack}` : msg;
}


function globalError(message) {
	// 1. Return a standardized error object for internal failures
	return [{
		file: 'Global',
		line: 0,
		source: 'ESLint',
		severity: 'error',
		message
	}];
}


function unlinkFile(f) {
	// 1. Remove the deleted file from the local cache
	if (!f) return;
	cache.delete(rel(f));

	// 2. Broadcast the updated error state
	snap([...cache.values()].flat());
}


async function run() {
	// 1. Continuous loop to process incoming linting requests
	while (pending) {
		const job = pending;
		pending = null;

		// 2. Initialize ESLint instance lazily to optimize startup
		if (!eslint) {
			try {
				eslint = new ESLint();
			} catch (e) {
				snap(globalError(`Init failed: ${errText(e)}`));
				continue;
			}
		}

		try {
			// 3. Clear cache if performing a full project scan
			if (job.reset) cache.clear();

			// 4. Execute ESLint on the requested file set
			const res = await eslint.lintFiles(job.files);

			// 5. Process results and update the error cache
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

			// 6. Send the final diagnostic snapshot to the UI
			snap([...cache.values()].flat());
		} catch (e) {
			snap(globalError(`Lint crashed: ${errText(e)}`));
		}
	}

	running = false;
}


parentPort.on('message', (msg) => {
	// 1. Handle file deletions immediately
	if (msg?.type === 'UNLINK') {
		unlinkFile(msg.f);
		return;
	}

	// 2. Determine if we are linting one file or the entire project
	const global = msg?.type === 'LINT_ALL';
	if (pending?.reset && !global) return;

	// 3. Queue the next linting job
	pending = {
		files: global ? ALL : (Array.isArray(msg.files) ? msg.files : []),
		reset: global
	};

	// 4. Start the async runner if it isn't already active
	if (!running) {
		running = true;
		run();
	}
});