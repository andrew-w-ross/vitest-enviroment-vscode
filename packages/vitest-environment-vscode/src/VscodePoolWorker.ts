import 'core-js/proposals/explicit-resource-management';
import { runTests, SilentReporter } from '@vscode/test-electron';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { PoolOptions, PoolWorker, WorkerRequest } from 'vitest/node';
import { type AddressInfo, type WebSocket } from 'ws';
import { EnvironmentVscodeError, toError } from './errors';
import type { VitestVscodeConfig } from './config';
import type { ControlRequest } from './utils/workerRequestSerializer';
import { createWebSocketServer, waitForWebSocketClient } from './utils/websocket';
import { deserialize, serialize } from './utils/workerRequestSerializer';

const require = createRequire(import.meta.url);
const WORKER_PATH = require.resolve('vitest-environment-vscode/vscode-worker.cjs');

const POOL_NAME = 'vitest-environment-vscode';
const DEBUG = process.env.VITEST_ENV_VSCODE_DEBUG === '1';

function getAddress(address: null | string | AddressInfo) {
	if (address == null) throw new EnvironmentVscodeError('server_initialization');
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
	#testRunPromise?: Promise<number | void>;

	// Shared secret the worker must echo back during the handshake so that no
	// other local process can connect to the ephemeral port and drive the run.
	#token = randomUUID();
	#userDataDir?: string;

	// The handshake (`ready`/`ready_ack`) and Vitest's own listener are attached
	// at different times. Buffer every frame received in between so nothing is
	// dropped before Vitest starts listening.
	#ready = false;
	#flushed = false;
	#bufferedMessages: unknown[] = [];
	#messageListeners = new Set<(data: unknown) => void>();
	#resolveReady?: () => void;
	#rejectReady?: (error: Error) => void;

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

	#handleMessage = (data: unknown) => {
		if (!this.#ready) {
			let message: ControlRequest | undefined;
			try {
				message = deserialize(data) as ControlRequest;
			} catch {
				message = undefined;
			}
			if (message?.type === 'ready') {
				if (message.token !== this.#token) {
					this.#rejectReady?.(new EnvironmentVscodeError('client_unauthorized'));
					return;
				}
				this.#ready = true;
				this.#ws?.send(serialize({ type: 'ready_ack' }));
				this.#resolveReady?.();
			}
			// Ignore any other frame until the handshake completes.
			return;
		}
		if (this.#flushed) {
			for (const listener of this.#messageListeners) listener(data);
		} else {
			this.#bufferedMessages.push(data);
		}
	};

	#waitForReady() {
		return new Promise<void>((resolve, reject) => {
			const ws = this.#ws;
			if (ws == null) {
				reject(new EnvironmentVscodeError('server_started_before_ready'));
				return;
			}
			const onError = (error: unknown) => settle(() => reject(toError(error)));
			const onClose = () =>
				settle(() => reject(new EnvironmentVscodeError('client_connection')));
			const settle = (run: () => void) => {
				ws.off('error', onError);
				ws.off('close', onClose);
				run();
			};
			this.#resolveReady = () => settle(resolve);
			this.#rejectReady = (error) => settle(() => reject(error));
			ws.on('error', onError);
			ws.on('close', onClose);
		});
	}

	send(message: WorkerRequest): void {
		if (this.#ws == null) {
			throw new EnvironmentVscodeError('server_started_before_ready');
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
			throw new EnvironmentVscodeError('server_started_before_ready');
		}
		if (event === 'message') {
			this.#messageListeners.add(callback);
			if (!this.#flushed) {
				this.#flushed = true;
				const pending = this.#bufferedMessages.splice(0);
				for (const data of pending) {
					for (const listener of this.#messageListeners) listener(data);
				}
			}
			return;
		}
		this.#ws.on(event, callback);
	}

	off(event: string, callback: (arg: unknown) => void): void {
		if (this.#ws == null) {
			throw new EnvironmentVscodeError('server_started_before_ready');
		}
		if (event === 'message') {
			this.#messageListeners.delete(callback);
			return;
		}
		this.#ws.off(event, callback);
	}

	async start() {
		const wss = this.#stack.use(await createWebSocketServer());
		const extensionDevelopmentPath = this.#options.project.config.root;
		const address = getAddress(wss.address());

		// Keep this short: VS Code creates a unix domain socket inside the
		// user-data-dir, and the full path must stay under the OS socket-path
		// limit (~104 chars on macOS).
		this.#userDataDir = join(tmpdir(), `vsct-${randomUUID().slice(0, 8)}`);
		const launchArgs: string[] = [`--user-data-dir=${this.#userDataDir}`];

		const debugArg = this.#debugArg();
		if (debugArg) launchArgs.push(debugArg);

		// Append user-provided launch args if any
		if (this.#customOptions.launchArgs) {
			launchArgs.push(...this.#customOptions.launchArgs);
		}

		const extensionTestsEnv: Record<string, string> = {
			VITEST_VSCODE_ADDRESS: address,
			VITEST_VSCODE_TOKEN: this.#token,
		};
		if (DEBUG) {
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
		ws.on('message', this.#handleMessage);

		await this.#waitForReady();
	}

	async stop() {
		await this.#stack.disposeAsync();
		if (this.#testRunPromise) {
			await this.#testRunPromise;
		}
		if (this.#userDataDir) {
			await rm(this.#userDataDir, { recursive: true, force: true }).catch(() => undefined);
			this.#userDataDir = undefined;
		}
	}

	deserialize(data: unknown) {
		return deserialize(data);
	}

	canReuse(): boolean {
		return this.#customOptions.reuseWorker;
	}
}
