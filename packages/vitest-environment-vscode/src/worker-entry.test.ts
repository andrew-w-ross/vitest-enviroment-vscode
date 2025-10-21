import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { CONTROL_CHANNEL, RPC_CHANNEL, encodeEnvelope, decodeEnvelope } from './ipc';
import { createWorkerRuntime, type WorkerRuntimeDependencies } from './worker-entry';

type RuntimeTransport = {
	post: (payload: unknown) => void;
	subscribe: (listener: (payload: unknown) => void) => () => void;
};

class MockSocket extends EventEmitter {
	public readyState: number = WebSocket.OPEN;
	public closed = false;
	public readonly sent: string[] = [];

	send(data: string) {
		this.sent.push(data);
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.readyState = WebSocket.CLOSED;
		this.emit('close', 1000, Buffer.from('closed'));
	}

	emitOpen() {
		this.emit('open');
	}

	emitMessage(data: string) {
		this.emit('message', data);
	}
}

const flushAsync = async () => {
	await new Promise<void>((resolve) => setImmediate(resolve));
};

const respondToReady = (socket: MockSocket) => {
	// Find and respond to the ready request
	for (const message of socket.sent) {
		try {
			const envelope = decodeEnvelope(message);
			if (envelope.channel === CONTROL_CHANNEL) {
				const payload = envelope.payload as { action?: string; id?: string };
				if (payload.action === 'ready') {
					socket.emitMessage(
						encodeEnvelope(CONTROL_CHANNEL, { id: payload.id ?? '', success: true })
					);
					return;
				}
			}
		} catch {
			// Ignore decode errors
		}
	}
};

describe('createWorkerRuntime', () => {
	const createDeps = (overrides: Partial<WorkerRuntimeDependencies> = {}) => {
		const socket = new MockSocket();
		let transport: RuntimeTransport | undefined;
		const deps: WorkerRuntimeDependencies = {
			getPort: () => '3777',
			createSocket: () => socket as unknown as WebSocket,
			collectVitestWorkerTests: () => Promise.resolve(),
			runVitestWorker: () => Promise.resolve(),
			setTransport: (api) => {
				transport = api;
			},
			workerModuleUrl: 'module-url',
			...overrides,
		};
		return { socket, transportRef: () => transport!, deps } as const;
	};

	const startRuntime = async (overrides: Partial<WorkerRuntimeDependencies> = {}) => {
		const context = createDeps(overrides);
		const runtime = createWorkerRuntime(context.deps);
		const runPromise = runtime.run();
		context.socket.emitOpen();
		await flushAsync();
		respondToReady(context.socket);
		await flushAsync();
		return { ...context, runPromise } as const;
	};

	const createContextPayload = (
		overrides: Partial<{
			pool: string;
			workerId: number;
			config: Record<string, unknown>;
			projectName: string;
			files: unknown[];
			environment: { name: string; options: unknown };
			providedContext: Record<string, unknown>;
		}> = {}
	) => ({
		pool: 'vscode',
		workerId: 42,
		config: {},
		projectName: 'demo',
		files: [],
		environment: { name: 'node', options: null },
		providedContext: {},
		...overrides,
	});

	it('forwards rpc traffic between socket and transport', async () => {
		const { socket, transportRef, runPromise } = await startRuntime();
		const transport = transportRef();
		const rpcListener = vi.fn();
		const unsubscribe = transport.subscribe(rpcListener);
		socket.emitMessage(encodeEnvelope(RPC_CHANNEL, { ping: 1 }));
		expect(rpcListener).toHaveBeenCalledWith({ ping: 1 });
		unsubscribe();
		socket.emitMessage(encodeEnvelope(RPC_CHANNEL, { ping: 2 }));
		expect(rpcListener).toHaveBeenCalledTimes(1);

		transport.post({ pong: true });
		const rpcEnvelope = decodeEnvelope(socket.sent.pop()!);
		expect(rpcEnvelope.channel).toBe(RPC_CHANNEL);
		expect(rpcEnvelope.payload).toEqual({ pong: true });

		socket.emitMessage(encodeEnvelope(CONTROL_CHANNEL, { id: 'shutdown', action: 'shutdown' }));
		await flushAsync();
		await runPromise;
		expect(socket.closed).toBe(true);
	});

	it('handles collect requests', async () => {
		const collectWorker = vi.fn(() => Promise.resolve());
		const { socket, runPromise } = await startRuntime({
			collectVitestWorkerTests: collectWorker,
		});

		const baseContext = createContextPayload();

		socket.emitMessage(
			encodeEnvelope(CONTROL_CHANNEL, { id: 'collect', action: 'collect', ctx: baseContext })
		);
		await flushAsync();
		expect(collectWorker).toHaveBeenCalledTimes(1);
		const collectCall = collectWorker.mock.calls[0] as unknown[] | undefined;
		const collectArgs = collectCall?.[0] as Record<string, unknown> | undefined;
		expect(collectArgs).toMatchObject({ worker: 'module-url', projectName: 'demo' });
		const collectResponse = decodeEnvelope(socket.sent.pop()!);
		expect(collectResponse.channel).toBe(CONTROL_CHANNEL);
		expect(collectResponse.payload).toMatchObject({ id: 'collect', success: true });

		socket.emitMessage(encodeEnvelope(CONTROL_CHANNEL, { id: 'shutdown', action: 'shutdown' }));
		await flushAsync();
		await runPromise;
		expect(socket.closed).toBe(true);
	});

	it('handles run requests and shutdown', async () => {
		const runWorker = vi.fn(() => Promise.resolve());
		const { socket, runPromise } = await startRuntime({ runVitestWorker: runWorker });

		const baseContext = createContextPayload({ workerId: 99, projectName: 'run-demo' });

		socket.emitMessage(
			encodeEnvelope(CONTROL_CHANNEL, { id: 'run', action: 'run', ctx: baseContext })
		);
		await flushAsync();
		expect(runWorker).toHaveBeenCalledTimes(1);
		const runResponse = decodeEnvelope(socket.sent.pop()!);
		expect(runResponse.payload).toMatchObject({ id: 'run', success: true });

		socket.emitMessage(encodeEnvelope(CONTROL_CHANNEL, { id: 'shutdown', action: 'shutdown' }));
		await flushAsync();
		const shutdownResponse = decodeEnvelope(socket.sent.pop()!);
		expect(shutdownResponse.payload).toMatchObject({ id: 'shutdown', success: true });
		await runPromise;
		expect(socket.closed).toBe(true);
	});

	it('sends error response for malformed requests', async () => {
		const collectWorker = vi.fn();
		const runWorker = vi.fn();
		const { socket, deps } = createDeps({
			collectVitestWorkerTests: collectWorker,
			runVitestWorker: runWorker,
		});
		const runtime = createWorkerRuntime(deps);
		const runPromise = runtime.run();
		socket.emitOpen();
		await flushAsync();
		respondToReady(socket);
		await flushAsync();

		socket.emitMessage(encodeEnvelope(CONTROL_CHANNEL, { id: 'bad', action: 'run' }));
		await flushAsync();
		expect(collectWorker).not.toHaveBeenCalled();
		expect(runWorker).not.toHaveBeenCalled();
		const errorResponse = decodeEnvelope(socket.sent.pop()!);
		expect(errorResponse.channel).toBe(CONTROL_CHANNEL);
		expect(errorResponse.payload).toMatchObject({ id: 'bad', success: false });

		socket.emitMessage(encodeEnvelope(CONTROL_CHANNEL, { id: 'shutdown', action: 'shutdown' }));
		await flushAsync();
		await runPromise;
		expect(socket.closed).toBe(true);
	});
});
