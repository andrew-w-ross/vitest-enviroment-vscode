import 'core-js/proposals/explicit-resource-management';
import { runTests, SilentReporter } from '@vscode/test-electron';
import { createRequire } from 'node:module';
import type { PoolOptions, PoolRunnerInitializer, PoolWorker, WorkerRequest } from 'vitest/node';
import { type AddressInfo, type WebSocket } from 'ws';
import { z } from 'zod';
import { EnviromentVscodeError, NotImplementedError } from './errors';
import { createWebSocketServer, waitForWebSocketClient } from './utils/websocket';
import { deserialize, serialize } from './utils/workerRequestSerializer';
import { invoke, once } from 'indisposed/no-polyfill';

export const vitestVscodeConfigSchema = z.object({
	version: z.union([z.literal('stable'), z.literal('insiders'), z.string()]).default('stable'),
});

export type VitestVscodeConfigSchema = z.infer<typeof vitestVscodeConfigSchema>;

const require = createRequire(import.meta.url);
const WORKER_PATH = require.resolve('vitest-environment-vscode/vscode-worker.cjs');

const POOL_NAME = 'vitest-environment-vscode';
console.log(`[${POOL_NAME}] Started`);
const DEBUG = process.env.VITEST_ENV_VSCODE_DEBUG === '1';

function getAddress(address: null | string | AddressInfo) {
	if (address == null) throw new EnviromentVscodeError('server_initialization');
	if (typeof address === 'string') return address;

	const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;

	return `ws://${host}:${address.port}`;
}

class VscodeWorker implements PoolWorker {
	name = POOL_NAME;

	#options: PoolOptions;
	#customOptions: VitestVscodeConfigSchema;
	#stack = new AsyncDisposableStack();
	#ws?: WebSocket;

	constructor(options: PoolOptions, customOptions: VitestVscodeConfigSchema) {
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

		const extensionTestsEnv: Record<string, string> = {
			VITEST_VSCODE_ADDRESS: address,
		};
		if (process.env.VITEST_ENV_VSCODE_DEBUG === '1') {
			extensionTestsEnv.VITEST_ENV_VSCODE_DEBUG = '1';
		}

		this.#testRunPromise = runTests({
			version: this.#customOptions.version,
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
}

export function vsCodeWorker(configInput: VitestVscodeConfigSchema): PoolRunnerInitializer {
	const customConfig = vitestVscodeConfigSchema.parse(configInput);

	return {
		name: POOL_NAME,
		createPoolWorker: (options) => new VscodeWorker(options, customConfig),
	};
}
