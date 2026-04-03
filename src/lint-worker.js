import { parentPort, workerData } from "node:worker_threads";
import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";

if (!parentPort) throw new Error("No parentPort");

let rootDir = workerData?.rootDir || "src";
rootDir = String(rootDir).trim().replace(/\/+$/, "") || "src";

let eslintPath = workerData?.eslintPath || "";
eslintPath = String(eslintPath).trim();

const ALL = [`${rootDir}/**/*.{js,jsx,ts,tsx}`];
const cache = new Map();
const CWD = process.cwd();

function rel(p) {
	return path.relative(CWD, p).replace(/\\/g, "/");
}

let eslint = null;
let running = false;
let pending = null;

function snap(errors) {
	parentPort.postMessage({ type: "SNAPSHOT", errors });
}

function errText(e) {
	if (!e) return "Unknown error";
	if (typeof e === "string") return e;
	const msg = e.message ? String(e.message) : String(e);
	const stack = e.stack ? String(e.stack).split("\n").slice(0, 2).join("\n") : "";
	return stack ? `${msg}\n${stack}` : msg;
}

function postGlobalError(message) {
	snap([{ file: "Global", line: 0, source: "ESLint", severity: "error", message }]);
}

function resolveConfigPath() {
	if (eslintPath) {
		const abs = path.isAbsolute(eslintPath) ? eslintPath : path.join(CWD, eslintPath);
		if (fs.existsSync(abs)) return abs;
		return "";
	}

	const candidates = [
		"eslint.config.js", "eslint.config.mjs", "eslint.config.cjs",
		".eslintrc.js", ".eslintrc.cjs", ".eslintrc.yaml", ".eslintrc.yml", ".eslintrc.json"
	];
	for (const name of candidates) {
		if (fs.existsSync(path.join(CWD, name))) return name;
	}

	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(CWD, "package.json"), "utf-8"));
		if (pkg.eslintConfig) return "package.json";
	} catch (e) { }

	return "";
}

const configPath = resolveConfigPath();

if (!configPath) {
	postGlobalError("Config not found: eslint.config.js, .eslintrc.*, or package.json");
	parentPort.close();
	process.exit(0);
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
				const opts = {};
				if (eslintPath) opts.overrideConfigFile = path.isAbsolute(configPath) ? configPath : path.join(CWD, configPath);
				eslint = new ESLint(opts);
			} catch (e) {
				postGlobalError(`Init failed: ${errText(e)}`);
				continue;
			}
		}

		try {
			if (job.reset) cache.clear();
			const res = await eslint.lintFiles(job.files);

			res.forEach(function (r) {
				const msgs = r.messages.filter((m) => m.severity > 0);
				const key = rel(r.filePath);
				if (!msgs.length) return cache.delete(key);

				cache.set(key, msgs.map((m) => ({
					file: key,
					line: m.line || 0,
					message: m.message,
					source: "ESLint",
					severity: m.severity === 2 ? "error" : "warning"
				})));
			});

			snap([...cache.values()].flat());
		} catch (e) {
			postGlobalError(`Lint crashed: ${errText(e)}`);
		}
	}
	running = false;
}

parentPort.on("message", function (msg) {
	if (msg?.type === "UNLINK") {
		unlinkFile(msg.f);
		return;
	}

	const global = msg?.type === "LINT_ALL";
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