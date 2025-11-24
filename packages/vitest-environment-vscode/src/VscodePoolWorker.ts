import 'core-js/proposals/explicit-resource-management';
import { runTests, SilentReporter } from '@vscode/test-electron';
import { createRequire } from 'node:module';
import type { PoolOptions, PoolWorker, WorkerRequest } from 'vitest/node';
import { type AddressInfo, type WebSocket } from 'ws';
import { EnviromentVscodeError, NotImplementedError } from './errors';
import type { VitestVscodeConfig } from './config';
import { createWebSocketServer, waitForWebSocketClient } from './utils/websocket';
import { deserialize, serialize } from './utils/workerRequestSerializer';
import { invoke, once } from 'indisposed/no-polyfill';

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
	#ws?: WebSocket;

	constructor(options: PoolOptions, customOptions: VitestVscodeConfig) {
		this.#options = options;
		this.#customOptions = customOptions;
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
			console.log(`[${POOL_NAME}] -> worker`, message.type);
			if (message.type === 'run' || message.type === 'collect') {
				const files = message.context?.files?.map((file) => file.filepath) ?? [];
				console.log(`[${POOL_NAME}] ${message.type} files:`, files);
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

		const debugArg = this.#debugArg();
		if (debugArg) launchArgs.push(debugArg);

		// Append user-provided launch args if any
		if (this.#customOptions.launchArgs) {
			launchArgs.push(...this.#customOptions.launchArgs);
		}

		const extensionTestsEnv: Record<string, string> = {
			VITEST_VSCODE_ADDRESS: address,
		};
		if (process.env.VITEST_ENV_VSCODE_DEBUG === '1') {
			extensionTestsEnv.VITEST_ENV_VSCODE_DEBUG = '1';
		}

		this.#testRunPromise = runTests({
			version: this.#customOptions.version,
			vscodeExecutablePath: this.#customOptions.vscodeExecutablePath,
			reuseMachineInstall: this.#customOptions.reuseMachineInstall,
			platform: this.#customOptions.platform,
			cachePath: this.#customOptions.cachePath,
			timeout: this.#customOptions.timeout,
			extensionDevelopmentPath,
			extensionTestsPath: WORKER_PATH,
			reporter: new SilentReporter(),
			launchArgs,
			extensionTestsEnv,
		});

		const ws = this.#stack.use(await waitForWebSocketClient(wss));
		this.#ws = ws;

		const result = await invoke(async () => {
			using message = once(ws, 'message');
			using error = once(ws, 'error', true);
			return await Promise.race([message, error]);
		}).then(([data]) => deserialize(data));

		if (result.type !== 'ready') {
			//We expect a ready response lll
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
