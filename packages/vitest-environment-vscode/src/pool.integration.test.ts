/* eslint-disable no-empty-pattern */
import { describe, it as baseIt, expect } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import type { Vitest, TestProject, TestSpecification } from 'vitest/node';
import createVsCodePool from './pool';
import {
	CONTROL_CHANNEL,
	RPC_CHANNEL,
	decodeEnvelope,
	encodeEnvelope,
	type ControlRequest,
	type ControlResponse,
} from './ipc';

/**
 * Integration tests for the VS Code pool using real WebSocket connections.
 * These tests verify end-to-end communication between the pool and worker.
 */

type TestContext = {
	wss: WebSocketServer;
	port: number;
};

const it = baseIt.extend<TestContext>({
	wss: async ({}, use) => {
		const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
		await new Promise<void>((resolve) => wss.once('listening', resolve));
		await use(wss);
		await new Promise<void>((resolve) => {
			wss.close(() => resolve());
		});
	},
	port: async ({ wss }, use) => {
		const address = wss.address();
		if (!address || typeof address === 'string') throw new Error('Failed to get port');
		await use(address.port);
	},
});

describe('VS Code Pool Integration', () => {
	const sendReadySignal = async (socket: WebSocket) => {
		const readyRequest: ControlRequest = {
			id: `ready-${Date.now()}`,
			action: 'ready',
		};
		socket.send(encodeEnvelope(CONTROL_CHANNEL, readyRequest));

		// Wait for ready response
		await new Promise<void>((resolve) => {
			const handler = (data: unknown) => {
				const envelope = decodeEnvelope(data);
				if (envelope.channel === CONTROL_CHANNEL) {
					const response = envelope.payload as ControlResponse;
					if (response.id === readyRequest.id) {
						socket.off('message', handler);
						resolve();
					}
				}
			};
			socket.on('message', handler);
		});
	};

	const createWorkerConnection = (port: number) => {
		let resolveSocket: ((socket: WebSocket) => void) | undefined;
		let rejectSocket: ((error: Error) => void) | undefined;

		const socketPromise = new Promise<WebSocket>((resolve, reject) => {
			resolveSocket = resolve;
			rejectSocket = reject;
		});

		const connect = () => {
			const socket = new WebSocket(`ws://127.0.0.1:${port}`);
			socket.once('open', () => {
				void (async () => {
					await sendReadySignal(socket);
					resolveSocket?.(socket);
					resolveSocket = undefined;
				})();
			});
			socket.once('error', (error) => {
				const normalized = error instanceof Error ? error : new Error(String(error));
				rejectSocket?.(normalized);
				rejectSocket = undefined;
			});
			return socket;
		};

		return {
			socketPromise,
			connect,
		};
	};

	const createMockVitest = (): Vitest => {
		return {
			logger: {
				log: () => {
					// Intentionally empty for testing
				},
				error: () => {
					// Intentionally empty for testing
				},
			},
			config: { root: '/workspace' },
			state: {
				clearFiles: () => {
					// Intentionally empty for testing
				},
			},
			onCancel: () => {
				// Intentionally empty for testing
			},
		} as unknown as Vitest;
	};

	const createMockProject = (name: string, vitest: Vitest): TestProject => {
		return {
			name,
			vitest: vitest as unknown as TestProject['vitest'],
			config: {
				environment: 'node',
			} as unknown as TestProject['config'],
			serializedConfig: { name } as TestProject['serializedConfig'],
			getProvidedContext: () => ({ project: name }),
		} as unknown as TestProject;
	};

	const createMockSpec = (project: TestProject, moduleId: string): TestSpecification => {
		return {
			moduleId,
			project,
			testLines: [],
		} as unknown as TestSpecification;
	};

	it('establishes WebSocket connection and handles control messages', async ({ wss, port }) => {
		const vitest = createMockVitest();
		const project = createMockProject('integration-test', vitest);
		const spec = createMockSpec(project, 'test/integration.test.ts');

		let workerSocket: WebSocket | null = null;
		const messagePromises: Promise<void>[] = [];

		const worker = createWorkerConnection(port);

		const pool = await createVsCodePool(vitest, {
			makeServer: () => {
				worker.connect();
				return wss;
			},
			launchTests: async () => {
				await worker.socketPromise;
				return 0;
			},
		});

		workerSocket = await worker.socketPromise;
		workerSocket.on('message', (data) => {
			const envelope = decodeEnvelope(data);

			if (envelope.channel === CONTROL_CHANNEL) {
				const request = envelope.payload as ControlRequest;
				const response: ControlResponse = {
					id: request.id,
					success: true,
				};

				messagePromises.push(
					new Promise<void>((resolveMsg) => {
						setTimeout(() => {
							if (workerSocket && workerSocket.readyState === WebSocket.OPEN) {
								workerSocket.send(encodeEnvelope(CONTROL_CHANNEL, response));
							}
							resolveMsg();
						}, 10);
					})
				);
			}
		});

		expect(workerSocket).not.toBeNull();

		// Execute a collect operation
		await pool.collectTests([spec]);

		// Execute a run operation
		await pool.runTests([spec]);

		// Close the pool
		await pool.close!();

		// Wait for all message promises to complete
		await Promise.all(messagePromises);

		if (workerSocket) {
			if (workerSocket.readyState !== WebSocket.CLOSED) {
				await new Promise<void>((resolve) => {
					workerSocket.once('close', () => resolve());
				});
			}
			expect(workerSocket.readyState).toBe(WebSocket.CLOSED);
		}
	});

	it('handles RPC channel messages separately from control messages', async ({ wss, port }) => {
		const vitest = createMockVitest();
		const receivedRpcMessages: unknown[] = [];

		const worker = createWorkerConnection(port);

		const pool = await createVsCodePool(vitest, {
			makeServer: () => {
				worker.connect();
				return wss;
			},
			launchTests: async () => {
				await worker.socketPromise;
				return 0;
			},
		});

		const workerSocket = await worker.socketPromise;
		workerSocket.on('message', (data) => {
			const envelope = decodeEnvelope(data);

			if (envelope.channel === RPC_CHANNEL) {
				receivedRpcMessages.push(envelope.payload);
			} else if (envelope.channel === CONTROL_CHANNEL) {
				const request = envelope.payload as ControlRequest;
				const response: ControlResponse = {
					id: request.id,
					success: true,
				};
				setTimeout(() => {
					if (workerSocket.readyState === WebSocket.OPEN) {
						workerSocket.send(encodeEnvelope(CONTROL_CHANNEL, response));
					}
				}, 5);
			}
		});

		// Simulate RPC message from worker
		workerSocket.send(
			encodeEnvelope(RPC_CHANNEL, { type: 'test-result', data: { passed: true } })
		);

		// Give time for message processing
		await new Promise((resolve) => setTimeout(resolve, 50));

		// RPC messages should be handled by the bridge (not tested here, but should not crash)
		await pool.close!();
	});

	it('handles worker errors during shutdown gracefully', async ({ wss, port }) => {
		const vitest = createMockVitest();
		let shutdownAttempts = 0;

		const worker = createWorkerConnection(port);

		const pool = await createVsCodePool(vitest, {
			makeServer: () => {
				worker.connect();
				return wss;
			},
			launchTests: async () => {
				await worker.socketPromise;
				return 0;
			},
		});

		const workerSocket = await worker.socketPromise;
		workerSocket.on('message', (data) => {
			const envelope = decodeEnvelope(data);

			if (envelope.channel === CONTROL_CHANNEL) {
				const request = envelope.payload as ControlRequest;

				if (request.action === 'shutdown') {
					shutdownAttempts++;
					const response: ControlResponse = {
						id: request.id,
						success: false,
						error: 'Worker failed to shutdown cleanly',
					};
					setTimeout(() => {
						if (workerSocket.readyState === WebSocket.OPEN) {
							workerSocket.send(encodeEnvelope(CONTROL_CHANNEL, response));
						}
					}, 5);
				}
			}
		});

		// Close should handle the error but still complete
		await expect(pool.close!()).rejects.toThrow();
		expect(shutdownAttempts).toBe(1);
	});

	it('supports multiple sequential operations on same connection', async ({ wss, port }) => {
		const vitest = createMockVitest();
		const project = createMockProject('sequential-test', vitest);
		const operations: string[] = [];

		const worker = createWorkerConnection(port);

		const pool = await createVsCodePool(vitest, {
			makeServer: () => {
				worker.connect();
				return wss;
			},
			launchTests: async () => {
				await worker.socketPromise;
				return 0;
			},
		});

		const workerSocket = await worker.socketPromise;
		workerSocket.on('message', (data) => {
			const envelope = decodeEnvelope(data);

			if (envelope.channel === CONTROL_CHANNEL) {
				const request = envelope.payload as ControlRequest;
				operations.push(request.action);

				const response: ControlResponse = {
					id: request.id,
					success: true,
				};
				setTimeout(() => {
					if (workerSocket.readyState === WebSocket.OPEN) {
						workerSocket.send(encodeEnvelope(CONTROL_CHANNEL, response));
					}
				}, 5);
			}
		});

		// Execute multiple operations
		await pool.collectTests([createMockSpec(project, 'test1.ts')]);
		await pool.runTests([createMockSpec(project, 'test2.ts')]);
		await pool.collectTests([createMockSpec(project, 'test3.ts')]);

		await pool.close!();

		expect(operations).toEqual(['collect', 'run', 'collect', 'shutdown']);
	});
});
