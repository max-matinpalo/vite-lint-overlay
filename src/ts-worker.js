import { parentPort, workerData } from 'node:worker_threads';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';


if (!parentPort) throw new Error('No parentPort');


const ROOT = process.cwd();


let tsconfigPath = workerData?.tsconfigPath || '';
tsconfigPath = String(tsconfigPath).trim();


function postGlobalError(message) {
	// 1. Package the error into a standardized SNAPSHOT format
	parentPort.postMessage({
		type: 'SNAPSHOT',
		errors: [{
			file: 'Global',
			line: 0,
			source: 'TS',
			severity: 'error',
			message
		}]
	});
}


function resolveConfigPath() {
	// 1. Handle user-provided custom tsconfig paths
	if (tsconfigPath) {
		const abs = path.isAbsolute(tsconfigPath)
			? tsconfigPath
			: path.join(ROOT, tsconfigPath);

		if (fs.existsSync(abs)) return abs;

		// 2. Search for the specific config if it's not a direct path
		const found = ts.findConfigFile(ROOT, ts.sys.fileExists, tsconfigPath);
		if (found) return found;

		return '';
	}

	// 3. Fallback to standard TypeScript configuration filenames
	const fallback = fs.existsSync(path.join(ROOT, 'tsconfig.app.json'))
		? 'tsconfig.app.json'
		: 'tsconfig.json';

	// 4. Use TypeScript API to locate the final config file
	return ts.findConfigFile(ROOT, ts.sys.fileExists, fallback) || '';
}


const configPath = resolveConfigPath();


if (!configPath) {
	postGlobalError(
		tsconfigPath
			? `tsconfig not found: ${tsconfigPath}`
			: 'tsconfig not found: tsconfig.app.json or tsconfig.json'
	);
	parentPort.close();
	process.exit(0);
}


const host = ts.createWatchCompilerHost(
	configPath,
	{ noEmit: true },
	ts.sys,
	ts.createSemanticDiagnosticsBuilderProgram,
	() => { },
	() => { }
);


host.afterProgramCreate = (builder) => {
	// 1. Extract the program instance from the watcher
	const prog = builder.getProgram();

	// 2. Retrieve and filter diagnostics for errors and warnings
	const errors = ts.getPreEmitDiagnostics(prog)
		.filter((d) =>
			d.category === ts.DiagnosticCategory.Error ||
			d.category === ts.DiagnosticCategory.Warning
		)
		.map((d) => {
			// 3. Format diagnostic messages and determine severity levels
			const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
			const severity = d.category === ts.DiagnosticCategory.Error
				? 'error'
				: 'warning';

			// 4. Handle errors that aren't attached to a specific file
			if (!d.file) {
				return { file: 'Global', line: 0, message, source: 'TS', severity };
			}

			// 5. Calculate human-readable line numbers
			const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);

			// 6. Return a cleaned-up error object for the UI
			return {
				file: path.relative(ROOT, d.file.fileName).replace(/\\/g, '/'),
				line: line + 1,
				message,
				source: 'TS',
				severity
			};
		});

	// 7. Push the batch of errors back to the main thread
	parentPort.postMessage({ type: 'SNAPSHOT', errors });
};


ts.createWatchProgram(host);