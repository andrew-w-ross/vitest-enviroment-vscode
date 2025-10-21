import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FileSpecification } from '@vitest/runner';
import WebSocket, { type RawData } from 'ws';
import { runVitestWorker, collectVitestWorkerTests } from 'vitest/workers';
import {
	CONTROL_CHANNEL,
	RPC_CHANNEL,
	decodeEnvelope,
	encodeEnvelope,
	isControlRequest,
	isControlResponse,
	type ControlRequest,
	type ControlResponse,
} from './ipc';
import { setTransport } from './worker-transport';

type SerializableContext = {
	pool: string;
	workerId: number;
	config: Record<string, unknown>;
	projectName: string;
	files: FileSpecification[];
	environment: {
		name: string;
		options: Record<string, unknown> | null;
	};
	providedContext: Record<string, unknown>;
	invalidates?: string[];
};

// When VS Code loads this via extensionTestsPath, it will be loaded from disk as a file.
// The worker-entry.js and vscode-worker.js files are in the same directory (dist/).
// Use import.meta.filename (Node 20.11+) or parse from stack to get current file path.
const getDefaultWorkerModuleUrl = () => {
	// Try import.meta.filename first (Node.js 20.11+)
	if (typeof import.meta.filename === 'string') {
		return join(dirname(import.meta.filename), 'vscode-worker.js');
	}

	// Fallback: parse from stack trace to get the actual file path
	const stack = new Error().stack;
	if (stack) {
		// Look for file:// URL in the stack
		const match = stack.match(/file:\/\/([^\s)]+worker-entry\.js)/);
		if (match) {
			const workerEntryPath = fileURLToPath('file://' + match[1]);
			return join(dirname(workerEntryPath), 'vscode-worker.js');
		}
	}

	throw new Error('Unable to resolve worker module path from current file location');
};

const defaultWorkerModuleUrl = getDefaultWorkerModuleUrl();
type WorkerRunContext = Parameters<typeof runVitestWorker>[0];

export type WorkerRuntimeDependencies = {
	getPort?: () => string | undefined;
	createSocket?: (port: string) => WebSocket;
	runVitestWorker?: typeof runVitestWorker;
	collectVitestWorkerTests?: typeof collectVitestWorkerTests;
	setTransport?: typeof setTransport;
	workerModuleUrl?: string;
};

const toErrorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
};

const toErrorDetail = (error: unknown): string => {
	if (error instanceof Error) {
		return error.stack ?? error.message;
	}
	return toErrorMessage(error);
};

export function createWorkerRuntime(deps: WorkerRuntimeDependencies = {}) {
	const {
		getPort = () => process.env.VITEST_VSCODE_PORT,
		createSocket = (port: string) => new WebSocket(`ws://127.0.0.1:${port}`),
		runVitestWorker: runWorker = runVitestWorker,
		collectVitestWorkerTests: collectWorkerTests = collectVitestWorkerTests,
		setTransport: applyTransport = setTransport,
		workerModuleUrl = defaultWorkerModuleUrl,
	} = deps;

	const rpcListeners = new Set<(payload: unknown) => void>();
	let socket: WebSocket | undefined;
	let shuttingDown = false;
	let shutdownResolve: (() => void) | undefined;
	let commandQueue: Promise<void> = Promise.resolve();

	const sendControlResponse = (response: ControlResponse) => {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error('IPC socket is not open');
		}
		socket.send(encodeEnvelope(CONTROL_CHANNEL, response));
	};

	const handleControlRequest = async (request: ControlRequest) => {
		if (request.action === 'shutdown') {
			shuttingDown = true;
			try {
				sendControlResponse({ id: request.id, success: true });
			} finally {
				rpcListeners.clear();
				if (socket) {
					socket.off('message', onMessage);
					shutdownResolve?.();
					socket.close();
				}
			}
			return;
		}

		if (!request.ctx || typeof request.ctx !== 'object') {
			await Promise.resolve(
				sendControlResponse({
					id: request.id,
					success: false,
					error: 'Missing execution context',
				})
			);
			return;
		}

		const ctx = request.ctx as SerializableContext;

		const workerCtx = { ...ctx, worker: workerModuleUrl } as unknown as WorkerRunContext;

		try {
			if (request.action === 'collect') {
				await collectWorkerTests(workerCtx);
			} else {
				await runWorker(workerCtx);
			}
			sendControlResponse({ id: request.id, success: true });
		} catch (error) {
			sendControlResponse({ id: request.id, success: false, error: toErrorDetail(error) });
		}
	};

	const onMessage = (raw: RawData) => {
		let envelope;
		try {
			envelope = decodeEnvelope(raw);
		} catch {
			return;
		}

		if (envelope.channel === RPC_CHANNEL) {
			for (const listener of rpcListeners) {
				listener(envelope.payload);
			}
			return;
		}

		const payload = envelope.payload;
		if (isControlRequest(payload)) {
			const request = payload;
			commandQueue = commandQueue
				.then(() => handleControlRequest(request))
				.catch(() => {
					// Silently handle control request errors
				});
		}
	};

	const run = async () => {
		const port = getPort();
		if (!port) throw new Error('Missing VITEST_VSCODE_PORT environment variable.');

		socket = createSocket(port);

		await new Promise<void>((resolve, reject) => {
			socket!.once('open', resolve);
			socket!.once('error', reject);
		});

		applyTransport({
			post(message) {
				socket!.send(encodeEnvelope(RPC_CHANNEL, message));
			},
			subscribe(listener) {
				rpcListeners.add(listener);
				return () => rpcListeners.delete(listener);
			},
		});

		socket.on('message', onMessage);

		// Send ready signal to the pool
		const readyRequest: ControlRequest = {
			id: `ready-${Date.now()}`,
			action: 'ready',
		};
		socket.send(encodeEnvelope(CONTROL_CHANNEL, readyRequest));

		// Wait for ready acknowledgment
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error('Timed out waiting for ready acknowledgment'));
			}, 5000);

			const readyHandler = (raw: RawData) => {
				try {
					const envelope = decodeEnvelope(raw);
					if (
						envelope.channel === CONTROL_CHANNEL &&
						isControlResponse(envelope.payload)
					) {
						const response = envelope.payload;
						if (response.id === readyRequest.id) {
							clearTimeout(timeout);
							socket!.off('message', readyHandler);
							resolve();
						}
					}
				} catch {
					// Ignore decode errors during ready handshake
				}
			};

			socket!.on('message', readyHandler);
		});

		return await new Promise<void>((resolve, reject) => {
			shutdownResolve = resolve;
			const handleClose = () => {
				if (shuttingDown) {
					resolve();
					return;
				}
				reject(new Error('VS Code pool socket closed unexpectedly'));
			};
			const handleError = (error: Error) => {
				if (shuttingDown) {
					resolve();
					return;
				}
				reject(error);
			};
			socket!.once('close', handleClose);
			socket!.once('error', handleError);
		});
	};

	return {
		run,
	};
}

export type WorkerRuntime = ReturnType<typeof createWorkerRuntime>;

export async function run() {
	const runtime = createWorkerRuntime();
	return await runtime.run();
}
