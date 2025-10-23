/* eslint-disable */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CancelReason, FileSpecification } from '@vitest/runner';
import { runTests as launchVsCodeTests } from '@vscode/test-electron';
import { createBirpc } from 'birpc';
import { parse, stringify } from 'flatted';
import WebSocket, { WebSocketServer } from 'ws';
import {
	createMethodsRPC,
	type ProcessPool,
	type TestProject,
	type TestSpecification,
	type Vitest,
} from 'vitest/node';
import {
	CONTROL_CHANNEL,
	RPC_CHANNEL,
	encodeEnvelope,
	decodeEnvelope,
	isControlRequest,
	isControlResponse,
	type ControlRequest,
	type ControlResponse,
} from './ipc';
import { toAsyncDispose, toDispose } from './utils/disposable';
import { createWebSocketServer, waitForWebSocketClient } from './utils/websocket';

const POOL_NAME = 'vscode';

type MaybePromise<T> = T | PromiseLike<T>;
type WebSocketServerHandle = Awaited<ReturnType<typeof createWebSocketServer>>;
type WebSocketClientHandle = Awaited<ReturnType<typeof waitForWebSocketClient>>;

type RunnerRpc = {
	onCancel: (reason: CancelReason) => void;
};

export type SerializedContext = {
	pool: string;
	workerId: number;
	config: TestProject['serializedConfig'];
	projectName: string;
	files: FileSpecification[];
	environment: {
		name: string;
		options: Record<string, any> | null;
	};
	providedContext: Record<string, any>;
	invalidates?: string[];
};

type PendingControl = {
	resolve: () => void;
	reject: (error: Error) => void;
};

export type ClientConnection = {
	ws: WebSocket;
	rpcSubscribers: Set<(payload: unknown) => void>;
	pending: Map<string, PendingControl>;
	dispose?: () => Promise<void>;
};

export type VsCodePoolOptions = {
	makeServer?: () => MaybePromise<WebSocketServer | WebSocketServerHandle>;
	launchTests?: typeof launchVsCodeTests;
	methodsFactory?: typeof createMethodsRPC;
	birpcFactory?: typeof createBirpc;
	now?: () => number;
	onClientConnected?: (connection: ClientConnection) => void;
	createBridge?: (
		project: TestProject,
		client: ClientConnection,
		collect: boolean
	) => { dispose: () => void };
	controlRequestTimeout?: number;
};

const isServerHandle = (value: unknown): value is WebSocketServerHandle => {
	return (
		typeof value === 'object' &&
		value !== null &&
		'wss' in (value as Record<string, unknown>) &&
		Symbol.asyncDispose in (value as Record<PropertyKey, unknown>)
	);
};

const wrapServerHandle = (wss: WebSocketServer): WebSocketServerHandle =>
	toAsyncDispose({ wss }, async ({ wss }) => {
		await new Promise<void>((resolve, reject) => {
			wss.close((error) => {
				if (error != null) return reject(error);
				resolve();
			});
		});
	});

const ensureServerHandle = async (
	makeServer: NonNullable<VsCodePoolOptions['makeServer']>
): Promise<WebSocketServerHandle> => {
	const server = await makeServer();
	return isServerHandle(server) ? server : wrapServerHandle(server as WebSocketServer);
};

const waitForServerListening = async (wss: WebSocketServer) => {
	if (wss.address() != null) return;

	await new Promise<void>((resolve, reject) => {
		const onListening = () => {
			wss.off('error', onError);
			resolve();
		};

		const onError = (error: Error) => {
			wss.off('listening', onListening);
			reject(error);
		};

		wss.once('listening', onListening);
		wss.once('error', onError);
	});
};

const wrapExistingSocket = (ws: WebSocket): WebSocketClientHandle =>
	toAsyncDispose({ ws }, async ({ ws }) => {
		await new Promise<void>((resolve, reject) => {
			if (ws.readyState === WebSocket.CLOSED) {
				return resolve();
			}

			const onClose = () => {
				ws.off('error', onError);
				resolve();
			};

			const onError = (error: Error) => {
				ws.off('close', onClose);
				reject(error);
			};

			ws.once('close', onClose);
			ws.once('error', onError);
			ws.close();
		});
	});

const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

const toErrorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
};

export const createSerializableContext = (
	project: TestProject,
	specs: TestSpecification[],
	workerId: number,
	invalidates?: string[]
): SerializedContext => {
	const files: FileSpecification[] = specs.map((spec) => ({
		filepath: spec.moduleId,
		testLocations: spec.testLines,
	}));
	const environmentName = project.config.environment || 'node';
	const environment = {
		name: environmentName,
		options: project.config.environmentOptions ?? null,
	};
	return {
		pool: POOL_NAME,
		workerId,
		config: project.serializedConfig,
		projectName: project.name,
		files,
		environment,
		providedContext: project.getProvidedContext(),
		invalidates,
	};
};

export default async function createVsCodePool(
	vitest: Vitest,
	options: VsCodePoolOptions = {}
): Promise<ProcessPool> {
	// Suppress @vscode/test-electron download/validation output
	const originalStderrWrite = process.stderr.write;
	const suppressedPatterns = [
		/Validated version/,
		/Found existing install/,
		/Downloading VS Code/,
	];
	const filteredWrite = function (
		this: typeof process.stderr,
		chunk: string | Uint8Array,
		...args: any[]
	): boolean {
		const str = chunk.toString();
		if (suppressedPatterns.some((pattern) => pattern.test(str))) {
			return true;
		}
		return originalStderrWrite.apply(this, [chunk, ...args] as any);
	};
	process.stderr.write = filteredWrite as any;

	const logger = vitest.logger;
	const testTimeout = vitest.config.testTimeout ?? 30_000;
	// Use 80% of test timeout to leave time for cleanup and error reporting
	const defaultControlTimeout = Math.floor(testTimeout * 0.8);

	const {
		makeServer = () => createWebSocketServer(),
		launchTests = launchVsCodeTests,
		methodsFactory = createMethodsRPC,
		birpcFactory = createBirpc,
		now = Date.now,
		onClientConnected,
		createBridge,
		controlRequestTimeout = defaultControlTimeout,
	} = options;

	const serverHandle = await ensureServerHandle(makeServer);
	const { wss } = serverHandle;
	await waitForServerListening(wss);

	const clients: ClientConnection[] = [];
	const pendingConnections = new Map<WebSocket, ClientConnection>();
	let nextRequestId = 0;
	let nextWorkerId = 0;
	let readyResolvers: Array<(client: ClientConnection) => void> = [];

	const notifyClientReady = (client: ClientConnection) => {
		const resolvers = readyResolvers;
		readyResolvers = [];
		for (const resolve of resolvers) {
			resolve(client);
		}
	};

	const waitForClient = async (timeout = 10_000): Promise<ClientConnection> => {
		if (clients[0]) return clients[0];

		return await new Promise<ClientConnection>((resolve, reject) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout>;

			const resolver = (client: ClientConnection) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				const index = readyResolvers.indexOf(resolver);
				if (index >= 0) readyResolvers.splice(index, 1);
				resolve(client);
			};

			timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				const index = readyResolvers.indexOf(resolver);
				if (index >= 0) readyResolvers.splice(index, 1);
				reject(new Error('Timed out waiting for VS Code worker to connect'));
			}, timeout);

			readyResolvers.push(resolver);
		});
	};

	const registerConnection = (handle: WebSocketClientHandle): ClientConnection => {
		const { ws } = handle;

		for (const existing of clients) {
			if (existing.ws === ws) return existing;
		}
		const existingPending = pendingConnections.get(ws);
		if (existingPending) return existingPending;

		let isReady = false;

		const connection: ClientConnection = {
			ws,
			rpcSubscribers: new Set(),
			pending: new Map(),
			dispose: async () => {
				await handle[Symbol.asyncDispose]();
			},
		};

		pendingConnections.set(ws, connection);

		ws.on('message', (raw) => {
			let envelope;
			try {
				envelope = decodeEnvelope(raw as any);
			} catch (error) {
				logger.error(
					`[vitest-vscode] Failed to decode worker message: ${toErrorMessage(error)}`
				);
				return;
			}

			if (envelope.channel === RPC_CHANNEL) {
				for (const subscriber of connection.rpcSubscribers) {
					subscriber(envelope.payload);
				}
				return;
			}

			const payload = envelope.payload;

			if (!isReady && isControlRequest(payload as any)) {
				const request = payload as ControlRequest;
				if (request.action === 'ready') {
					isReady = true;
					pendingConnections.delete(ws);
					if (!clients.includes(connection)) {
						clients.push(connection);
					}
					notifyClientReady(connection);
					onClientConnected?.(connection);
					const response: ControlResponse = {
						id: request.id,
						success: true,
					};
					ws.send(encodeEnvelope(CONTROL_CHANNEL, response));
					return;
				}
			}

			if (isControlResponse(payload as any)) {
				const response = payload as ControlResponse;
				const pending = connection.pending.get(response.id);
				if (!pending) return;
				connection.pending.delete(response.id);
				if (response.success) {
					pending.resolve();
				} else {
					logger.error(
						`[vitest-vscode] Worker rejected control request ${response.id}: ${response.error ?? 'Unknown error'}`
					);
					pending.reject(new Error(response.error ?? 'VS Code worker reported an error'));
				}
			}
		});

		ws.on('close', (code, reason) => {
			if (code !== 1000 && code !== 1005) {
				logger.error(
					`[vitest-vscode] Worker socket closed code=${code} reason=${reason.toString()}`
				);
			}
			const index = clients.indexOf(connection);
			if (index >= 0) clients.splice(index, 1);
			pendingConnections.delete(ws);
			for (const pending of connection.pending.values()) {
				pending.reject(new Error('VS Code worker disconnected'));
			}
			connection.pending.clear();
			connection.rpcSubscribers.clear();
		});

		ws.on('error', (error) => {
			logger.error('[vitest-vscode] Worker socket error', error);
		});

		return connection;
	};

	for (const existing of wss.clients) {
		registerConnection(wrapExistingSocket(existing as WebSocket));
	}

	let serverStopping = false;

	const acceptConnections = (async () => {
		while (!serverStopping) {
			try {
				const handle = await waitForWebSocketClient(wss);
				registerConnection(handle);
			} catch (error) {
				if (serverStopping) {
					break;
				}
				logger.error(
					`[vitest-vscode] Failed to accept VS Code worker connection: ${toErrorMessage(error)}`
				);
			}
		}
	})();

	const address = wss.address();
	if (!address || typeof address === 'string')
		throw new Error(`Couldn't determine the port for the WebSocketServer`);
	const port = address.port;

	const workspaceRoot = vitest.config.root;
	const poolModuleUrl = import.meta.url;
	const poolDir = path.dirname(fileURLToPath(poolModuleUrl));
	const workerEntryPath = path.resolve(poolDir, 'worker-entry.js');

	const testPromise = launchTests({
		reuseMachineInstall: true,
		extensionDevelopmentPath: path.resolve(workspaceRoot),
		extensionTestsPath: workerEntryPath,
		extensionTestsEnv: {
			VITEST_VSCODE_PORT: port.toString(),
		},
		launchArgs: [
			'--disable-extensions',
			'--log',
			'off',
			'--logsPath',
			path.resolve(workspaceRoot, '.vscode-test', 'logs'),
		],
	}).catch((error) => {
		logger.error('[vitest-vscode] VS Code Extension Host exited with an error', error);
		throw error;
	});

	const defaultBridgeFactory = (
		project: TestProject,
		client: ClientConnection,
		collect: boolean
	) => {
		const listeners = new Set<(payload: unknown) => void>();
		const forwarder = (payload: unknown) => {
			for (const listener of listeners) listener(payload);
		};

		client.rpcSubscribers.add(forwarder);

		const rpc = birpcFactory<RunnerRpc, ReturnType<typeof createMethodsRPC>>(
			methodsFactory(project, { collect }),
			{
				eventNames: ['onCancel'],
				timeout: -1,
				post: (data) => {
					client.ws.send(encodeEnvelope(RPC_CHANNEL, data));
				},
				on: (fn) => {
					listeners.add(fn);
				},
				serialize: stringify,
				deserialize: parse,
			}
		);

		project.vitest.onCancel((reason) => rpc.onCancel(reason));

		const handleClose = () => {
			rpc.$close(new Error('[vitest-vscode] RPC closed due to socket termination'));
		};
		client.ws.on('close', handleClose);

		const dispose = () => {
			client.ws.off('close', handleClose);
			client.rpcSubscribers.delete(forwarder);
			listeners.clear();
			rpc.$close(new Error('[vitest-vscode] RPC disposed'));
		};

		return { rpc, dispose };
	};

	const buildBridge =
		createBridge ??
		((project: TestProject, client: ClientConnection, collect: boolean) =>
			defaultBridgeFactory(project, client, collect));

	const sendControlRequest = async (client: ClientConnection, request: ControlRequest) => {
		await new Promise<void>((resolve, reject) => {
			const timeout = controlRequestTimeout;
			const timer = setTimeout(() => {
				const pending = client.pending.get(request.id);
				if (pending) {
					client.pending.delete(request.id);
					const error = new Error(
						`Control request ${request.action} timed out after ${timeout}ms`
					);
					reject(error);
				}
			}, timeout);

			try {
				client.pending.set(request.id, {
					resolve: () => {
						clearTimeout(timer);
						resolve();
					},
					reject: (error) => {
						clearTimeout(timer);
						client.pending.delete(request.id);
						reject(error);
					},
				});
				client.ws.send(encodeEnvelope(CONTROL_CHANNEL, request));
			} catch (error) {
				clearTimeout(timer);
				client.pending.delete(request.id);
				reject(toError(error));
			}
		});
	};

	const executeForProject = async (
		method: 'run' | 'collect',
		project: TestProject,
		specs: TestSpecification[],
		invalidates?: string[]
	) => {
		if (!specs.length) return;
		const client = await waitForClient();
		const paths = specs.map((spec) => spec.moduleId);
		project.vitest.state.clearFiles(project, paths);

		const { dispose } = buildBridge(project, client, method === 'collect');
		using bridgeScope = toDispose({ dispose }, ({ dispose }) => dispose());

		const workerId = ++nextWorkerId;
		const request: ControlRequest = {
			id: `${now()}-${++nextRequestId}`,
			action: method,
			ctx: createSerializableContext(project, specs, workerId, invalidates),
		};

		await sendControlRequest(client, request);
	};

	const runForAllProjects = async (
		method: 'run' | 'collect',
		files: TestSpecification[],
		invalidates?: string[]
	) => {
		if (!files.length) return;
		const grouped = new Map<TestProject, TestSpecification[]>();
		for (const spec of files) {
			const list = grouped.get(spec.project);
			if (list) list.push(spec);
			else grouped.set(spec.project, [spec]);
		}

		for (const [project, specs] of grouped) {
			await executeForProject(method, project, specs, invalidates);
		}
	};

	return {
		name: POOL_NAME,
		collectTests: (files, invalidates) => runForAllProjects('collect', files, invalidates),
		runTests: (files, invalidates) => runForAllProjects('run', files, invalidates),
		async close() {
			const errors: Error[] = [];

			const closeConnection = async (connection: ClientConnection, sendShutdown: boolean) => {
				if (sendShutdown && connection.ws.readyState === WebSocket.OPEN) {
					const request: ControlRequest = {
						id: `${now()}-${++nextRequestId}`,
						action: 'shutdown',
					};
					try {
						await sendControlRequest(connection, request);
					} catch (error) {
						errors.push(toError(error));
					}
				}

				try {
					if (connection.dispose) {
						await connection.dispose();
					} else if (connection.ws.readyState === WebSocket.OPEN) {
						connection.ws.close();
					}
				} catch (error) {
					errors.push(toError(error));
				}
			};

			for (const client of [...clients]) {
				await closeConnection(client, true);
			}

			for (const connection of pendingConnections.values()) {
				await closeConnection(connection, false);
			}
			pendingConnections.clear();
			clients.length = 0;
			readyResolvers = [];

			serverStopping = true;

			try {
				await serverHandle[Symbol.asyncDispose]();
			} catch (error) {
				errors.push(toError(error));
			}

			try {
				await acceptConnections;
			} catch (error) {
				errors.push(toError(error));
			}

			try {
				await testPromise;
			} catch (error) {
				errors.push(toError(error));
			} finally {
				process.stderr.write = originalStderrWrite;
			}

			if (errors.length > 0) {
				throw new AggregateError(errors, 'Errors occurred while closing VS Code pool');
			}
		},
	} satisfies ProcessPool;
}
