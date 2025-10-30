import { runTests } from '@vscode/test-electron';
import type { PoolOptions, PoolRunnerInitializer, PoolWorker, WorkerRequest } from 'vitest/node';
import { type AddressInfo, type WebSocket } from 'ws';
import { z } from 'zod';
import { EnviromentVscodeError } from './errors';
import { createWebSocketServer, waitForWebSocketClient } from './utils/websocket';
import { deserialize, serialize } from './utils/workerRequestSerializer';

export const vitestVscodeConfigSchema = z.object({
	version: z.union([z.literal('stable'), z.literal('insiders'), z.string()]).default('stable'),
});

export type VitestVscodeConfigSchema = z.infer<typeof vitestVscodeConfigSchema>;

const WORKER_PATH = import.meta.resolve('vitest-environment-vscode/vscode-worker');

const POOL_NAME = 'vitest-environment-vscode';

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
		this.#ws?.send(serialize(message));
	}

	on(event: string, callback: (arg: unknown) => void): void {
		this.#ws?.on(event, callback);
	}

	off(event: string, callback: (arg: unknown) => void): void {
		this.#ws?.off(event, callback);
	}

	async start() {
		const { wss } = this.#stack.use(await createWebSocketServer());
		const extensionDevelopmentPath = this.#options.project.config.root;
		const address = getAddress(wss.address());

		const launchArgs: string[] = [`--user-data-dir=/tmp/vscode-test/${process.pid}`];

		const debugArg = this.#debugArg();
		if (debugArg) launchArgs.push(debugArg);

		const extensionTestsEnv: Record<string, string> = {
			VITEST_VSCODE_ADDRESS: address,
		};

		void runTests({
			version: this.#customOptions.version,
			extensionDevelopmentPath,
			extensionTestsPath: WORKER_PATH,
			// reporter: new SilentReporter(),
			launchArgs,
			extensionTestsEnv,
		});

		const { ws } = this.#stack.use(await waitForWebSocketClient(wss));
		this.#ws = ws;
	}

	async stop() {
		await this.#stack.disposeAsync();
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
