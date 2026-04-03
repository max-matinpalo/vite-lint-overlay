import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default function lintOverlay(props = {}) {
	const {
		rootDir: rawRoot = "src",
		tsconfigPath = "",
		tsConfigPath = "",
		eslintPath = "",
		ts = true,
		eslint = true
	} = props;

	const rootDir = String(rawRoot).trim().replace(/\/+$/, "") || "src";
	const finalTsConfig = tsConfigPath || tsconfigPath;
	const virtualId = "virtual:lint-overlay-client.js";
	const resolvedVirtualId = "\0" + virtualId;
	const __dirname = path.dirname(fileURLToPath(import.meta.url));

	let tsErrors = [];
	let lintErrors = [];
	let serverWs = null;

	function updateOverlay() {
		if (!serverWs) return;
		serverWs.send({
			type: "custom",
			event: "smart-overlay:update",
			data: { errors: [...tsErrors, ...lintErrors] }
		});
	}

	return {
		name: "vite-plugin-lint-overlay",
		apply: "serve",

		resolveId(id) {
			if (id === virtualId || id === "/" + virtualId) return resolvedVirtualId;
		},

		load(id) {
			if (id === resolvedVirtualId) {
				return fs.readFileSync(path.join(__dirname, "client-overlay.js"), "utf-8");
			}
		},

		configureServer(server) {
			serverWs = server.ws;
			const projectRoot = server.config.root || process.cwd();
			let lintWorker = null;
			let tsWorker = null;

			function handleCrash(source, msg) {
				const err = { file: "Global", message: msg, source, severity: "error" };
				if (source === "TS") tsErrors = [err];
				if (source === "ESLint") lintErrors = [err];
				updateOverlay();
			}

			function startLintWorker() {
				if (lintWorker) lintWorker.terminate();
				lintWorker = new Worker(
					new URL("./lint-worker.js", import.meta.url),
					{ type: "module", workerData: { rootDir, eslintPath } }
				);
				lintWorker.on("error", (e) => handleCrash("ESLint", `Error: ${e.message}`));
				lintWorker.on("exit", (c) => c !== 0 && handleCrash("ESLint", `Died: ${c}`));
				lintWorker.on("message", function onLintMsg(msg) {
					if (msg.type !== "SNAPSHOT") return;
					lintErrors = msg.errors;
					updateOverlay();
				});
				lintWorker.postMessage({ type: "LINT_ALL" });
			}

			function startTsWorker() {
				if (tsWorker) tsWorker.terminate();
				tsWorker = new Worker(
					new URL("./ts-worker.js", import.meta.url),
					{ type: "module", workerData: { tsconfigPath: finalTsConfig } }
				);
				tsWorker.on("error", (e) => handleCrash("TS", `Error: ${e.message}`));
				tsWorker.on("exit", (c) => c !== 0 && handleCrash("TS", `Died: ${c}`));
				tsWorker.on("message", function onTsMsg(msg) {
					if (msg.type !== "SNAPSHOT") return;
					tsErrors = msg.errors;
					updateOverlay();
				});
			}

			if (eslint) startLintWorker();
			if (ts) startTsWorker();

			server.httpServer?.on("close", function onClose() {
				if (lintWorker) lintWorker.terminate();
				if (tsWorker) tsWorker.terminate();
			});

			server.ws.on("smart-overlay:reset", function onReset() {
				tsErrors = [];
				lintErrors = [];
				updateOverlay();
				if (eslint) startLintWorker();
				if (ts) startTsWorker();
			});

			function isTarget(f) {
				return /\.(js|jsx|ts|tsx)$/.test(f);
			}

			function isInRoot(f) {
				const rel = path.relative(projectRoot, f).replace(/\\/g, "/");
				return rel === rootDir || rel.startsWith(rootDir + "/");
			}

			function lintFile(f) {
				if (!eslint || !lintWorker) return;
				if (!isTarget(f)) return;
				if (!isInRoot(f)) return;
				lintWorker.postMessage({ type: "LINT", files: [f] });
			}

			server.ws.on("connection", function onConn() {
				updateOverlay();
				if (eslint && lintWorker) lintWorker.postMessage({ type: "LINT_ALL" });
			});

			server.watcher.on("add", lintFile);
			server.watcher.on("change", lintFile);
			server.watcher.on("unlink", function onUnlink(f) {
				if (!eslint || !lintWorker) return;
				if (!isTarget(f)) return;
				if (!isInRoot(f)) return;
				lintWorker.postMessage({ type: "UNLINK", f });
			});
		},

		transformIndexHtml() {
			return [{
				tag: "script",
				attrs: { type: "module", src: `/${virtualId}` },
				injectTo: "body-prepend"
			}];
		}
	};
}