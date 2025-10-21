import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import WebSocket, { type WebSocketServer } from 'ws';
import * as vscodeTestElectron from '@vscode/test-electron';
import type { Vitest, TestProject, TestSpecification } from 'vitest/node';
import createVsCodePool, {
	createSerializableContext,
	type ClientConnection,
	type SerializedContext,
	type VsCodePoolOptions,
} from './pool';
import { CONTROL_CHANNEL, decodeEnvelope, encodeEnvelope, type ControlRequest } from './ipc';

class FakeWebSocket extends EventEmitter {
	public readyState: number = WebSocket.OPEN;
	public readonly sent: string[] = [];

	send(data: string) {
		this.sent.push(data);
	}

	close() {
		if (this.readyState === WebSocket.CLOSED) return;
		this.readyState = WebSocket.CLOSED;
		this.emit('close', 1000, Buffer.from('manual-close'));
	}

	emitMessage(data: string) {
		this.emit('message', data);
	}

	emitError(error: Error) {
		this.emit('error', error);
	}

	simulateDisconnect(code = 1006, reason = 'Connection lost') {
		this.readyState = WebSocket.CLOSED;
		this.emit('close', code, Buffer.from(reason));
	}
}

class FakeWebSocketServer extends EventEmitter {
	public readonly connections: FakeWebSocket[] = [];
	public readonly clients = new Set<FakeWebSocket>();
	public isListening = false;

	constructor(private readonly port = 41_234) {
		super();
		queueMicrotask(() => {
			this.isListening = true;
			this.emit('listening');
		});
	}

	address() {
		return { port: this.port };
	}

	close(callback?: () => void) {
		this.isListening = false;
		queueMicrotask(() => {
			this.emit('close');
			callback?.();
		});
	}

	connect(socket: FakeWebSocket) {
		this.connections.push(socket);
		this.clients.add(socket);
		socket.once('close', () => {
			this.clients.delete(socket);
			const index = this.connections.indexOf(socket);
			if (index >= 0) this.connections.splice(index, 1);
		});
		this.emit('connection', socket);
	}
}

type VitestStub = {
	instance: Vitest;
	clearFiles: ReturnType<typeof vi.fn>;
	loggerError: ReturnType<typeof vi.fn>;
	loggerLog: ReturnType<typeof vi.fn>;
	onCancelHandlers: ((reason: unknown) => void)[];
};

const createVitestStub = (): VitestStub => {
	const clearFiles = vi.fn();
	const loggerError = vi.fn();
	const loggerLog = vi.fn();
	const onCancelHandlers: ((reason: unknown) => void)[] = [];
	const instance = {
		logger: {
			log: loggerLog,
			error: loggerError,
		},
		config: { root: '/workspace' },
		state: {
			clearFiles,
		},
		onCancel(handler: (reason: unknown) => void) {
			onCancelHandlers.push(handler);
		},
	} as unknown as Vitest;

	return { instance, clearFiles, loggerError, loggerLog, onCancelHandlers };
};

const createProject = (name: string, vitest: Vitest, environment?: string): TestProject => {
	const config = {
		environment,
		environmentOptions: environment ? { target: environment } : undefined,
	};
	return {
		name,
		vitest: vitest as unknown as TestProject['vitest'],
		config: config as unknown as TestProject['config'],
		serializedConfig: { name } as TestProject['serializedConfig'],
		getProvidedContext: () => ({ project: name }),
	} as unknown as TestProject;
};

const createSpec = (
	project: TestProject,
	moduleId: string,
	testLines: number[] = []
): TestSpecification => {
	return {
		moduleId,
		project,
		testLines,
	} as unknown as TestSpecification;
};

const flushAsync = async () => {
	await new Promise<void>((resolve) => setImmediate(resolve));
};

const launchTestsMock = vi.spyOn(vscodeTestElectron, 'runTests').mockResolvedValue(0 as never);

afterEach(() => {
	launchTestsMock.mockClear();
});

const drainControlRequest = (socket: FakeWebSocket): ControlRequest => {
	const raw = socket.sent.shift();
	if (!raw) throw new Error('Expected control message to be sent');
	const envelope = decodeEnvelope(raw);
	if (envelope.channel !== CONTROL_CHANNEL)
		throw new Error(`Unexpected channel ${envelope.channel}`);
	return envelope.payload as ControlRequest;
};

const respondSuccess = (socket: FakeWebSocket, id: string) => {
	socket.emitMessage(encodeEnvelope(CONTROL_CHANNEL, { id, success: true }));
};

const respondError = (socket: FakeWebSocket, id: string, error: string) => {
	socket.emitMessage(encodeEnvelope(CONTROL_CHANNEL, { id, success: false, error }));
};

const sendReadySignal = (socket: FakeWebSocket) => {
	const readyRequest: ControlRequest = {
		id: `ready-${Date.now()}`,
		action: 'ready',
	};
	socket.emitMessage(encodeEnvelope(CONTROL_CHANNEL, readyRequest));
};

const connectAndReady = async (server: FakeWebSocketServer, socket: FakeWebSocket) => {
	server.connect(socket);
	await flushAsync();
	sendReadySignal(socket);
	await flushAsync();
	// Clear messages from ready handshake so tests can check for new messages
	socket.sent.length = 0;
};

describe('createVsCodePool', () => {
	describe('test collection', () => {
		it('dispatches collect control requests with serialized context', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const bridgeCalls: boolean[] = [];
			const bridgeFactory: NonNullable<VsCodePoolOptions['createBridge']> = (
				_project,
				_client,
				collect
			) => {
				bridgeCalls.push(collect);
				return { dispose: vi.fn() };
			};
			const connections: ClientConnection[] = [];
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
				now: () => 1_000,
				onClientConnected: (connection) => connections.push(connection),
				createBridge: bridgeFactory,
			});
			expect(launchTestsMock).toHaveBeenCalledTimes(1);

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);
			expect(connections).toHaveLength(1);

			const project = createProject('alpha', vitestStub.instance, 'jsdom');
			const spec = createSpec(project, 'tests/alpha.test.ts');

			const collectPromise = pool.collectTests([spec]);
			await flushAsync();
			const request = drainControlRequest(socket);
			expect(request.action).toBe('collect');

			const ctx = request.ctx as SerializedContext;
			expect(ctx.pool).toBe('vscode');
			expect(ctx.workerId).toBe(1);
			expect(ctx.projectName).toBe('alpha');
			expect(ctx.environment).toEqual({ name: 'jsdom', options: { target: 'jsdom' } });
			expect(ctx.files).toEqual([
				{
					filepath: 'tests/alpha.test.ts',
					testLocations: [],
				},
			]);

			respondSuccess(socket, request.id);
			await collectPromise;
			expect(vitestStub.clearFiles).toHaveBeenCalledWith(project, ['tests/alpha.test.ts']);
			expect(bridgeCalls).toEqual([true]);

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			expect(shutdown.action).toBe('shutdown');
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});

		it('skips collection when specs array is empty', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			await pool.collectTests([]);
			expect(socket.sent).toHaveLength(0);
			expect(vitestStub.clearFiles).not.toHaveBeenCalled();

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});
	});

	describe('test execution', () => {
		it('runs tests and forwards invalidations', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const bridgeStates: boolean[] = [];
			const bridgeFactory: NonNullable<VsCodePoolOptions['createBridge']> = (
				_project,
				_client,
				collect
			) => {
				bridgeStates.push(collect);
				return { dispose: vi.fn() };
			};
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
				now: (() => {
					let current = 2_000;
					return () => ++current;
				})(),
				createBridge: bridgeFactory,
			});
			expect(launchTestsMock).toHaveBeenCalledTimes(1);

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			const project = createProject('beta', vitestStub.instance);
			const specA = createSpec(project, 'src/a.test.ts', [10]);
			const specB = createSpec(project, 'src/b.test.ts', [20]);

			const runPromise = pool.runTests([specA, specB], ['src/shared.ts']);
			await flushAsync();
			const request = drainControlRequest(socket);
			expect(request.action).toBe('run');

			const ctx = request.ctx as SerializedContext;
			expect(ctx.invalidates).toEqual(['src/shared.ts']);
			expect(ctx.files).toHaveLength(2);
			expect(ctx.files.map((file) => file.filepath)).toEqual([
				'src/a.test.ts',
				'src/b.test.ts',
			]);
			expect(ctx.workerId).toBe(1);

			respondSuccess(socket, request.id);
			await runPromise;

			expect(vitestStub.clearFiles).toHaveBeenCalledWith(project, [
				'src/a.test.ts',
				'src/b.test.ts',
			]);
			expect(bridgeStates).toEqual([false]);

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});

		it('skips execution when specs array is empty', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			await pool.runTests([]);
			expect(socket.sent).toHaveLength(0);
			expect(vitestStub.clearFiles).not.toHaveBeenCalled();

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});

		it('groups specs by project and executes sequentially', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const executionOrder: string[] = [];
			const bridgeFactory: NonNullable<VsCodePoolOptions['createBridge']> = (project) => {
				executionOrder.push(project.name);
				return { dispose: vi.fn() };
			};
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
				createBridge: bridgeFactory,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			const projectA = createProject('project-a', vitestStub.instance);
			const projectB = createProject('project-b', vitestStub.instance);
			const specs = [
				createSpec(projectA, 'a1.test.ts'),
				createSpec(projectB, 'b1.test.ts'),
				createSpec(projectA, 'a2.test.ts'),
			];

			const runPromise = pool.runTests(specs);
			await flushAsync();

			// First project's request
			const req1 = drainControlRequest(socket);
			expect(req1.action).toBe('run');
			respondSuccess(socket, req1.id);
			await flushAsync();

			// Second project's request
			const req2 = drainControlRequest(socket);
			expect(req2.action).toBe('run');
			respondSuccess(socket, req2.id);

			await runPromise;
			expect(executionOrder).toEqual(['project-a', 'project-b']);

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});
	});

	describe('error handling', () => {
		it('handles worker disconnection during collect', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			const project = createProject('gamma', vitestStub.instance);
			const spec = createSpec(project, 'test.ts');

			const collectPromise = pool.collectTests([spec]);
			await flushAsync();

			drainControlRequest(socket);
			socket.simulateDisconnect();

			await expect(collectPromise).rejects.toThrow('VS Code worker disconnected');
		});

		it('handles control request errors', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			const project = createProject('delta', vitestStub.instance);
			const spec = createSpec(project, 'test.ts');

			const runPromise = pool.runTests([spec]);
			await flushAsync();

			const request = drainControlRequest(socket);
			respondError(socket, request.id, 'Worker execution failed');

			await expect(runPromise).rejects.toThrow('Worker execution failed');
		});

		it('handles malformed worker messages', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			// Send malformed message
			socket.emitMessage('not-valid-json{}}');

			// Should log error but not crash
			await flushAsync();
			expect(vitestStub.loggerError).toHaveBeenCalledWith(
				expect.stringContaining('[vitest-vscode] Failed to decode worker message')
			);

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});

		it('aggregates errors on close', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			// Use a promise that won't settle until we want it to
			let rejectLaunch: (error: Error) => void;
			const launchPromise = new Promise<number>((_resolve, reject) => {
				rejectLaunch = reject;
			});
			// Prevent unhandled rejection warning
			launchPromise.catch(() => {
				// Intentionally empty - we handle the error in the test
			});
			const launchTests = vi.fn().mockReturnValue(launchPromise);

			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
				launchTests,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			const closePromise = Promise.resolve(pool.close!()).catch(
				(error: unknown) => error as AggregateError
			);
			await flushAsync();

			const shutdown = drainControlRequest(socket);
			respondError(socket, shutdown.id, 'Shutdown failed');

			// Now reject the launch promise
			rejectLaunch!(new Error('VS Code launch failed'));
			await flushAsync();

			// Wait for the error and validate the aggregate error structure
			const aggError = await closePromise;
			expect(aggError).toBeInstanceOf(AggregateError);
			if (!(aggError instanceof AggregateError)) {
				expect.fail('Expected close to reject with AggregateError');
				return;
			}
			expect(aggError.message).toBe('Errors occurred while closing VS Code pool');
			expect(aggError.errors.length).toBeGreaterThanOrEqual(1);
			expect(
				aggError.errors.some((err) => (err as Error).message.includes('Shutdown failed'))
			).toBe(true);
		});

		it('handles socket errors gracefully', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			socket.emitError(new Error('Socket error'));

			await flushAsync();
			expect(vitestStub.loggerError).toHaveBeenCalledWith(
				'[vitest-vscode] Worker socket error',
				expect.any(Error)
			);

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});
	});

	describe('concurrency', () => {
		it('waits for client connection with timeout', async () => {
			vi.useFakeTimers();
			try {
				const vitestStub = createVitestStub();
				const server = new FakeWebSocketServer();
				const pool = await createVsCodePool(vitestStub.instance, {
					makeServer: () => server as unknown as WebSocketServer,
				});

				const project = createProject('epsilon', vitestStub.instance);
				const spec = createSpec(project, 'test.ts');

				// Don't connect a socket - should timeout
				const collectPromise = pool.collectTests([spec]);

				// The pool should throw a timeout error
				// We need to set up the expectation before advancing timers
				const expectPromise = expect(collectPromise).rejects.toThrow(
					'Timed out waiting for VS Code worker to connect'
				);

				// Fast-forward time to trigger the timeout
				await vi.advanceTimersByTimeAsync(30_001);

				// Now verify the rejection
				await expectPromise;
			} finally {
				vi.useRealTimers();
			}
		});

		it('times out control request if worker does not respond', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
				controlRequestTimeout: 100, // Use a very short timeout for testing
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			const project = createProject('timeout-test', vitestStub.instance);
			const spec = createSpec(project, 'test.ts');

			// Start a collect operation
			const collectPromise = pool.collectTests([spec]);
			await flushAsync();

			// Drain the control request but don't respond
			const request = drainControlRequest(socket);
			expect(request.action).toBe('collect');

			// Wait for timeout to occur
			// The promise should reject with a timeout error
			await expect(collectPromise).rejects.toThrow(/timed out after 100ms/i);

			// Socket should still be open for cleanup
			expect(socket.readyState).toBe(WebSocket.OPEN);
		});

		it('reuses existing client connection', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const connections: ClientConnection[] = [];
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
				onClientConnected: (connection) => connections.push(connection),
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			const project = createProject('zeta', vitestStub.instance);
			const spec1 = createSpec(project, 'test1.ts');
			const spec2 = createSpec(project, 'test2.ts');

			const run1 = pool.runTests([spec1]);
			await flushAsync();
			const req1 = drainControlRequest(socket);
			respondSuccess(socket, req1.id);
			await run1;

			const run2 = pool.runTests([spec2]);
			await flushAsync();
			const req2 = drainControlRequest(socket);
			respondSuccess(socket, req2.id);
			await run2;

			// Should reuse the same connection
			expect(connections).toHaveLength(1);

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});
	});

	describe('bridge lifecycle', () => {
		it('creates bridge with collect=true for collectTests', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const bridgeConfigs: boolean[] = [];
			const bridgeFactory: NonNullable<VsCodePoolOptions['createBridge']> = (
				_project,
				_client,
				collect
			) => {
				bridgeConfigs.push(collect);
				return { dispose: vi.fn() };
			};
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
				createBridge: bridgeFactory,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			const project = createProject('eta', vitestStub.instance);
			const spec = createSpec(project, 'test.ts');

			const collectPromise = pool.collectTests([spec]);
			await flushAsync();
			const request = drainControlRequest(socket);
			respondSuccess(socket, request.id);
			await collectPromise;

			expect(bridgeConfigs).toEqual([true]);

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});

		it('disposes bridge after execution', async () => {
			const vitestStub = createVitestStub();
			const server = new FakeWebSocketServer();
			const dispose = vi.fn();
			const bridgeFactory: NonNullable<VsCodePoolOptions['createBridge']> = () => {
				return { dispose };
			};
			const pool = await createVsCodePool(vitestStub.instance, {
				makeServer: () => server as unknown as WebSocketServer,
				createBridge: bridgeFactory,
			});

			const socket = new FakeWebSocket();
			await connectAndReady(server, socket);

			const project = createProject('theta', vitestStub.instance);
			const spec = createSpec(project, 'test.ts');

			const runPromise = pool.runTests([spec]);
			await flushAsync();
			const request = drainControlRequest(socket);
			respondSuccess(socket, request.id);
			await runPromise;

			expect(dispose).toHaveBeenCalledTimes(1);

			const closePromise = pool.close!();
			const shutdown = drainControlRequest(socket);
			respondSuccess(socket, shutdown.id);
			await closePromise;
		});
	});
});

describe('createSerializableContext', () => {
	it('produces default environment metadata', () => {
		const vitestStub = createVitestStub();
		const project = createProject('gamma', vitestStub.instance);
		const spec = createSpec(project, 'tests/gamma.test.ts', [5]);
		const context = createSerializableContext(project, [spec], 7, ['file.ts']);
		expect(context.environment).toEqual({ name: 'node', options: null });
		expect(context.workerId).toBe(7);
		expect(context.invalidates).toEqual(['file.ts']);
		const [file] = context.files;
		expect(file?.testLocations).toEqual([5]);
	});
});
