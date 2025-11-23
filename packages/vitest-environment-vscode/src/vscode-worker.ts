import 'core-js/proposals/explicit-resource-management';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isNullOrEmpty } from '~/utils/string';
import { EnviromentVscodeError } from '~/errors';
import { wait } from '~/utils/fn';
import { waitForConnection } from '~/utils/websocket';
import { init, runBaseTests as vitestRunBaseTests } from 'vitest/worker';
import type { ControlRequest } from './utils/workerRequestSerializer';
import { deserialize, serialize } from './utils/workerRequestSerializer';
import { invoke, once } from 'indisposed/no-polyfill';

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
	if (isNullOrEmpty(serverAddress)) throw new EnviromentVscodeError('client_env');
	if (process.env.VITEST_ENV_VSCODE_DEBUG === '1') {
		console.log(`[${WORKER_NAME}] debug logging enabled`);
	}

	const ws = await waitForConnection(serverAddress);

	const handShakePromise = invoke(async () => {
		using message = once(ws, 'message');
		using error = once(ws, 'error', true);
		return await Promise.race([message, error]);
	}).then(([data]) => deserialize(data));

	// Send ready signal to pool
	for (let i = 0; i < 11; i++) {
		ws.send(serialize({ type: 'ready' } satisfies ControlRequest));
		const raceResult = await Promise.race([handShakePromise, wait(10)]);
		if (raceResult != null && raceResult.type === 'ready_ack') {
			break;
		}
		if (i > 10) {
			throw new EnviromentVscodeError('client_ack_timeout');
		}
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
				ws.on('message', callback);
			},
			off: (callback) => {
				ws.off('message', callback);
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
