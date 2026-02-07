import { parentPort, workerData } from 'node:worker_threads';
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

if (!parentPort) throw new Error('No parentPort');

const ROOT = process.cwd();

let tsconfigPath = workerData?.tsconfigPath || '';
tsconfigPath = String(tsconfigPath).trim();

function postGlobalError(message) {
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
	if (tsconfigPath) {
		const abs = path.isAbsolute(tsconfigPath)
			? tsconfigPath
			: path.join(ROOT, tsconfigPath);

		if (fs.existsSync(abs)) return abs;

		const found = ts.findConfigFile(ROOT, ts.sys.fileExists, tsconfigPath);
		if (found) return found;

		return '';
	}

	const fallback = fs.existsSync(path.join(ROOT, 'tsconfig.app.json'))
		? 'tsconfig.app.json'
		: 'tsconfig.json';

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
	const prog = builder.getProgram();

	const errors = ts.getPreEmitDiagnostics(prog)
		.filter((d) =>
			d.category === ts.DiagnosticCategory.Error ||
			d.category === ts.DiagnosticCategory.Warning
		)
		.map((d) => {
			const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
			const severity = d.category === ts.DiagnosticCategory.Error
				? 'error'
				: 'warning';

			if (!d.file) {
				return { file: 'Global', line: 0, message, source: 'TS', severity };
			}

			const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);

			return {
				file: path.relative(ROOT, d.file.fileName).replace(/\\/g, '/'),
				line: line + 1,
				message,
				source: 'TS',
				severity
			};
		});

	parentPort.postMessage({ type: 'SNAPSHOT', errors });
};

ts.createWatchProgram(host);
