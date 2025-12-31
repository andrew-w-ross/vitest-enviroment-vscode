import 'core-js/proposals/explicit-resource-management';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { PoolOptions, PoolWorker, Vitest, WorkerRequest } from 'vitest/node';
import { type AddressInfo, type WebSocket } from 'ws';
import { EnviromentVscodeError, NotImplementedError } from './errors';
import type { VitestVscodeConfig } from './config';
import { createWebSocketServer, waitForWebSocketClient } from './utils/websocket';
import { deserialize, serialize } from './utils/workerRequestSerializer';
import { invoke, once } from 'indisposed/no-polyfill';
import { runVsCodeTests } from './runVsCodeTests';

const require = createRequire(import.meta.url);
const WORKER_PATH = require.resolve('vitest-environment-vscode/vscode-worker.cjs');

const POOL_NAME = 'vitest-environment-vscode';
const DEBUG = process.env.VITEST_ENV_VSCODE_DEBUG === '1';

function getAddress(address: null | string | AddressInfo) {
	if (address == null) throw new EnviromentVscodeError('server_initialization');
	if (typeof address === 'string') return address;

	const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;

	return `ws://${host}:${address.port}`;
}

export class VscodePoolWorker implements PoolWorker {
	name = POOL_NAME;

	#options: PoolOptions;
	#customOptions: VitestVscodeConfig;
	#stack = new AsyncDisposableStack();
	#logger: Vitest['logger'];
	#ws?: WebSocket;

	constructor(options: PoolOptions, customOptions: VitestVscodeConfig) {
		this.#options = options;
		this.#logger = this.#options.project.vitest.logger;
		this.#customOptions = customOptions;
	}

	#resolveCachePath(extensionDevelopmentPath: string) {
		if (this.#customOptions.cachePath) {
			return this.#customOptions.cachePath;
		}

		const nodeModulesPath = resolvePath(extensionDevelopmentPath, 'node_modules');
		if (existsSync(nodeModulesPath)) {
			return resolvePath(nodeModulesPath, '.cache', '.vscode-test');
		}

		return undefined;
	}

	#debugArg() {
		const { enabled, port = 9229, waitForDebugger } = this.#options.project.config.inspector;
		if (!enabled || port == null) return;
		if (waitForDebugger) return `--inspect-brk-extensions=${port}`;
		return `--inspect-extensions=${port}`;
	}

	send(message: WorkerRequest): void {
		if (this.#ws == null) {
			throw new EnviromentVscodeError('server_started_before_ready');
		}

		if (DEBUG) {
			this.#logger.console.debug(`[${POOL_NAME}] -> worker`, message.type);
			if (message.type === 'run' || message.type === 'collect') {
				const files = message.context?.files?.map((file) => file.filepath) ?? [];
				this.#logger.console.debug(`[${POOL_NAME}] ${message.type} files:`, files);
			}
		}

		this.#ws.send(serialize(message));
	}

	on(event: string, callback: (arg: unknown) => void): void {
		if (this.#ws == null) {
			throw new EnviromentVscodeError('server_started_before_ready');
		}

		this.#ws.on(event, callback);
	}

	off(event: string, callback: (arg: unknown) => void): void {
		if (this.#ws == null) {
			throw new EnviromentVscodeError('server_started_before_ready');
		}

		this.#ws.off(event, callback);
	}

	#testRunPromise?: Promise<number | void>;

	async start() {
		const wss = this.#stack.use(await createWebSocketServer());
		const extensionDevelopmentPath = this.#options.project.config.root;
		const address = getAddress(wss.address());

		const launchArgs: string[] = [`--user-data-dir=/tmp/vscode-test/${process.pid}`];

		// If a workspaceRoot is configured, open that folder as the VS Code
		// workspace so vscode.workspace APIs see the intended files. Relative
		// paths are resolved against the Vitest project root.
		if (this.#customOptions.workspaceRoot) {
			const root = this.#customOptions.workspaceRoot;
			const absoluteRoot = isAbsolute(root)
				? root
				: resolvePath(extensionDevelopmentPath, root);
			launchArgs.push(absoluteRoot);
		}

		const debugArg = this.#debugArg();
		if (debugArg) launchArgs.push(debugArg);

		// Append user-provided launch args if any
		if (this.#customOptions.launchArgs) {
			launchArgs.push(...this.#customOptions.launchArgs);
		}

		const extensionTestsEnv: Record<string, string> = {
			VITEST_VSCODE_ADDRESS: address,
		};

		if (DEBUG) {
			extensionTestsEnv.VITEST_ENV_VSCODE_DEBUG = '1';
		}

		// Extend timeout if debugger is attached (either via env var or inspector config)
		const isDebugging = DEBUG || this.#options.project.config.inspector.enabled;

		this.#testRunPromise = runVsCodeTests({
			vscodeExecutablePath: this.#customOptions.vscodeExecutablePath,
			version: this.#customOptions.version,
			platform: this.#customOptions.platform,
			cachePath: this.#resolveCachePath(extensionDevelopmentPath),
			reuseMachineInstall: this.#customOptions.reuseMachineInstall,
			extensionDevelopmentPath,
			extensionTestsPath: WORKER_PATH,
			extensionTestsEnv,
			launchArgs,
			logger: this.#logger,
			isDebug: isDebugging,
		});

		const ws = this.#stack.use(await waitForWebSocketClient(wss));
		this.#ws = ws;

		const result = await invoke(async () => {
			using message = once(ws, 'message');
			using error = once(ws, 'error', true);
			return await Promise.race([message, error]);
		}).then(([data]) => deserialize(data));

		if (result.type !== 'ready') {
			throw new NotImplementedError();
		}
		ws.send(serialize({ type: 'ready_ack' }));
	}

	async stop() {
		await this.#stack.disposeAsync();
		if (this.#testRunPromise) {
			await this.#testRunPromise;
		}
	}

	deserialize(data: unknown) {
		return deserialize(data);
	}

	canReuse(): boolean {
		return this.#customOptions.reuseWorker;
	}
}
