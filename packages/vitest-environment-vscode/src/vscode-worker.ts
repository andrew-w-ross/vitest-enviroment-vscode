import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isNullOrEmpty } from '#utils/string';
import { EnvironmentVscodeError } from '#errors';
import { wait } from '#utils/fn';
import { waitForConnection } from '#utils/websocket';
import { init, runBaseTests as vitestRunBaseTests } from 'vitest/worker';
import type { ControlRequest } from './utils/workerRequestSerializer';
import { deserialize, serialize } from './utils/workerRequestSerializer';

const workerRequire = createRequire(import.meta.url);
const WORKER_NAME = 'vitest-environment-vscode';
const VITEST_BASE_CHUNK_PATTERN = /\.\/chunks\/base\.[^'"]+\.js/;

type SetupEnvironment = (context: unknown) => Promise<() => Promise<unknown>>;

let setupEnvironmentPromise: Promise<SetupEnvironment> | undefined;

async function loadSetupEnvironment(): Promise<SetupEnvironment> {
	if (setupEnvironmentPromise) return setupEnvironmentPromise;
	setupEnvironmentPromise = (async () => {
		const workerEntryPath = workerRequire.resolve('vitest/worker');
		const workerSource = readFileSync(workerEntryPath, 'utf8');
		const match = workerSource.match(VITEST_BASE_CHUNK_PATTERN);
		if (!match) {
			throw new Error('vitest-environment-vscode: Unable to locate Vitest base chunk.');
		}
		const chunkPath = pathToFileURL(resolvePath(dirname(workerEntryPath), match[0])).href;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const chunkModule = await import(chunkPath);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		const setupEnvironment = (chunkModule.setupEnvironment ?? chunkModule.s) as
			| SetupEnvironment
			| undefined;
		if (typeof setupEnvironment !== 'function') {
			throw new Error(
				'vitest-environment-vscode: Vitest base chunk missing setupEnvironment export.'
			);
		}
		return setupEnvironment;
	})();
	return setupEnvironmentPromise;
}

export async function run() {
	const serverAddress = process.env.VITEST_VSCODE_ADDRESS;
	if (isNullOrEmpty(serverAddress)) throw new EnvironmentVscodeError('client_env');
	const token = process.env.VITEST_VSCODE_TOKEN ?? '';
	if (process.env.VITEST_ENV_VSCODE_DEBUG === '1') {
		console.log(`[${WORKER_NAME}] debug logging enabled`);
	}

	const ws = await waitForConnection(serverAddress);

	// Attach a single persistent listener the moment we connect. Vitest sends
	// `start` immediately after the handshake, so any frame that arrives in the
	// window between the handshake and init() registering its own listener would
	// otherwise be dropped, leaving the worker unresponsive and VS Code open.
	// We intercept the handshake `ready_ack` here and buffer everything else
	// until init() attaches, then replay it.
	let acknowledged = false;
	let resolveAck!: () => void;
	const ackPromise = new Promise<void>((resolve) => {
		resolveAck = resolve;
	});

	const listeners = new Set<(data: unknown) => void>();
	const buffered: unknown[] = [];
	let flushed = false;

	ws.on('message', (data: unknown) => {
		if (!acknowledged) {
			let message: ControlRequest | undefined;
			try {
				message = deserialize(data) as ControlRequest;
			} catch {
				message = undefined;
			}
			if (message?.type === 'ready_ack') {
				acknowledged = true;
				resolveAck();
				return;
			}
		}
		if (flushed) {
			for (const listener of listeners) listener(data);
		} else {
			buffered.push(data);
		}
	});

	// Announce readiness until the pool acknowledges, then stop.
	const MAX_READY_ATTEMPTS = 50;
	for (let attempt = 0; attempt < MAX_READY_ATTEMPTS && !acknowledged; attempt++) {
		ws.send(serialize({ type: 'ready', token } satisfies ControlRequest));
		await Promise.race([ackPromise, wait(10)]);
	}
	if (!acknowledged) {
		throw new EnvironmentVscodeError('client_ack_timeout');
	}

	const runWithLogging = async (
		method: 'run' | 'collect',
		state: Parameters<typeof vitestRunBaseTests>[1],
		traces: Parameters<typeof vitestRunBaseTests>[2]
	) => {
		if (process.env.VITEST_ENV_VSCODE_DEBUG === '1') {
			const filepaths = state.ctx?.files?.map((file) => file.filepath) ?? [];
			console.log(`[${WORKER_NAME}] worker ${method} files:`, filepaths);
		}
		return vitestRunBaseTests(method, state, traces);
	};

	await new Promise((resolve) => {
		init({
			post: (response) => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				ws.send(response);
			},
			on: (callback) => {
				listeners.add(callback);
				if (!flushed) {
					flushed = true;
					const pending = buffered.splice(0);
					for (const data of pending) {
						for (const listener of listeners) listener(data);
					}
				}
			},
			off: (callback) => {
				listeners.delete(callback);
			},
			teardown: () => {
				resolve(undefined);
			},
			serialize: serialize,
			deserialize: deserialize,
			runTests: (state, traces) => runWithLogging('run', state, traces),
			collectTests: (state, traces) => runWithLogging('collect', state, traces),
			setup: async (context) => {
				const setupEnvironment = await loadSetupEnvironment();
				return setupEnvironment(context);
			},
		});
	});
}
