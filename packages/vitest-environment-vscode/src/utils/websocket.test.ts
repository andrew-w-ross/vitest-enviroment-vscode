import { describe, expect, vi, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { createWebSocketServer, waitForWebSocketClient } from './websocket.js';
import { EnviromentVscodeError } from '../errors.js';

describe('createWebSocketServer', () => {
	test('should create a WebSocketServer with correct configuration', async () => {
		await using server = await createWebSocketServer();

		expect(server).toBeInstanceOf(WebSocketServer);
		// Verify it's configured for localhost
		const address = server.address() as AddressInfo;
		expect(address.address).toBe('127.0.0.1');
		expect(address.port).toBeGreaterThan(0);
	});

	test('should wait for server to be ready before resolving', async () => {
		await using server = await createWebSocketServer();

		// Server should be listening and have a valid address
		const address = server.address();
		expect(address).toBeTruthy();
		expect(typeof address).not.toBe('string');
	});

	test('should return an async disposable WebSocketServer', async () => {
		await using server = await createWebSocketServer();

		expect(server).toBeInstanceOf(WebSocketServer);
		expect(typeof server[Symbol.asyncDispose]).toBe('function');
	});

	test('should close the WebSocket server when disposed', async () => {
		const server = await createWebSocketServer();

		// Server should be listening
		expect(server.address()).toBeTruthy();

		await server[Symbol.asyncDispose]();

		// After disposal, address should be null
		expect(server.address()).toBeNull();
	});

	test('should automatically dispose when using await using syntax', async () => {
		let serverInstance: Awaited<ReturnType<typeof createWebSocketServer>> | undefined;

		{
			await using server = await createWebSocketServer();
			expect(server).toBeInstanceOf(WebSocketServer);
			serverInstance = server;
			// Server should be listening within scope
			expect(server.address()).toBeTruthy();
		}

		expect(serverInstance).toBeDefined();
		if (serverInstance == null) {
			throw new Error('serverInstance should be defined after using scope');
		}
		// After scope exit, server should be disposed
		expect(serverInstance.address()).toBeNull();
	});

	test('should only close the server once even if disposed multiple times', async () => {
		const server = await createWebSocketServer();
		const closeSpy = vi.spyOn(server, 'close');

		await server[Symbol.asyncDispose]();
		await server[Symbol.asyncDispose]();
		await server[Symbol.asyncDispose]();

		expect(closeSpy).toHaveBeenCalledOnce();
	});

	test('should handle concurrent disposal calls', async () => {
		const server = await createWebSocketServer();
		const closeSpy = vi.spyOn(server, 'close');

		const promises = [
			server[Symbol.asyncDispose](),
			server[Symbol.asyncDispose](),
			server[Symbol.asyncDispose](),
		];

		await Promise.all(promises);

		expect(closeSpy).toHaveBeenCalledOnce();
	});

	test('should resolve with undefined when close succeeds', async () => {
		const server = await createWebSocketServer();
		const disposeResult = await server[Symbol.asyncDispose]();

		expect(disposeResult).toBeUndefined();
	});

	test('should accept WebSocket connections', async () => {
		await using server = await createWebSocketServer();
		const address = server.address() as AddressInfo;

		// Create a client connection
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		await new Promise<void>((resolve, reject) => {
			client.on('open', () => resolve());
			client.on('error', reject);
		});

		expect(client.readyState).toBe(WebSocket.OPEN);

		client.close();
	});

	test('should handle disposal in error scenarios', async () => {
		let serverInstance: Awaited<ReturnType<typeof createWebSocketServer>> | undefined;

		try {
			await using server = await createWebSocketServer();
			serverInstance = server;
			expect(server.address()).toBeTruthy();
			throw new Error('Simulated error');
		} catch (_error) {
			// Expected error
		}

		// Server should still be disposed despite the error
		expect(serverInstance!.address()).toBeNull();
	});
});

describe('waitForWebSocketClient', () => {
	test('should wait for and return a WebSocket client connection', async () => {
		await using server = await createWebSocketServer();
		const address = server.address() as AddressInfo;

		// Create a client connection
		const clientPromise = waitForWebSocketClient(server);
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		await using serverClient = await clientPromise;

		expect(serverClient).toBeDefined();
		expect(serverClient.readyState).toBe(WebSocket.OPEN);

		await new Promise<void>((resolve) => {
			if (client.readyState === WebSocket.OPEN) {
				client.close();
				client.once('close', () => resolve());
			} else {
				client.once('open', () => {
					client.close();
					client.once('close', () => resolve());
				});
			}
		});
	});

	test('should return an async disposable WebSocket client', async () => {
		await using server = await createWebSocketServer();
		const address = server.address() as AddressInfo;

		const clientPromise = waitForWebSocketClient(server);
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		await using serverClient = await clientPromise;

		expect(serverClient).toBeInstanceOf(WebSocket);
		expect(typeof serverClient[Symbol.asyncDispose]).toBe('function');

		await new Promise<void>((resolve) => {
			if (client.readyState === WebSocket.OPEN) {
				client.close();
				client.once('close', () => resolve());
			} else {
				client.once('open', () => {
					client.close();
					client.once('close', () => resolve());
				});
			}
		});
	});

	test('should close the WebSocket client when disposed', async () => {
		await using server = await createWebSocketServer();
		const address = server.address() as AddressInfo;

		const clientPromise = waitForWebSocketClient(server);
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		const serverClient = await clientPromise;
		expect(serverClient).toBeInstanceOf(WebSocket);
		expect(serverClient.readyState).toBe(WebSocket.OPEN);

		await serverClient[Symbol.asyncDispose]();

		expect(serverClient.readyState).toBe(WebSocket.CLOSED);

		await new Promise<void>((resolve) => {
			if (client.readyState === WebSocket.CLOSED) {
				resolve();
			} else {
				client.once('close', () => resolve());
			}
		});
	});

	test('should automatically dispose when using await using syntax', async () => {
		await using server = await createWebSocketServer();
		const address = server.address() as AddressInfo;

		let serverClientInstance: Awaited<ReturnType<typeof waitForWebSocketClient>> | undefined;

		{
			const clientPromise = waitForWebSocketClient(server);
			const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

			await using serverClient = await clientPromise;
			serverClientInstance = serverClient;
			expect(serverClient.readyState).toBe(WebSocket.OPEN);

			await new Promise<void>((resolve) => {
				if (client.readyState === WebSocket.OPEN) {
					client.close();
					client.once('close', () => resolve());
				} else {
					client.once('open', () => {
						client.close();
						client.once('close', () => resolve());
					});
				}
			});
		}

		// After scope exit, client should be disposed
		if (serverClientInstance == null) {
			throw new Error('serverClientInstance should be defined after using scope');
		}
		expect(serverClientInstance.readyState).toBe(WebSocket.CLOSED);
	});

	test('should handle already closed WebSocket on disposal', async () => {
		await using server = await createWebSocketServer();
		const address = server.address() as AddressInfo;

		const clientPromise = waitForWebSocketClient(server);
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		const serverClient = await clientPromise;

		// Close the WebSocket before disposal
		serverClient.close();
		await new Promise((resolve) => serverClient.once('close', resolve));

		// Disposal should complete without errors
		await expect(serverClient[Symbol.asyncDispose]()).resolves.toBeUndefined();

		await new Promise<void>((resolve) => {
			if (client.readyState === WebSocket.CLOSED) {
				resolve();
			} else {
				client.once('close', () => resolve());
			}
		});
	});

	test('should reject with client_connection error when server closes before connection', async () => {
		await using server = await createWebSocketServer();

		const clientPromise = waitForWebSocketClient(server);

		// Wait a bit to ensure listeners are attached, then close the server
		await new Promise((resolve) => setTimeout(resolve, 10));
		await server[Symbol.asyncDispose]();

		await expect(clientPromise).rejects.toThrow(EnviromentVscodeError);
		await expect(clientPromise).rejects.toMatchObject({
			type: 'client_connection',
		});
	});

	test('should reject with error when server has error before connection', async () => {
		await using server = await createWebSocketServer();

		const clientPromise = waitForWebSocketClient(server);

		// Trigger an error on the server
		const error = new Error('Server error');
		server.emit('error', error);

		await expect(clientPromise).rejects.toThrow(error);
	});

	test('should handle multiple sequential connections', async () => {
		await using server = await createWebSocketServer();
		const address = server.address() as AddressInfo;

		// First connection
		const client1Promise = waitForWebSocketClient(server);
		const client1 = new WebSocket(`ws://127.0.0.1:${address.port}`);
		await using serverClient1 = await client1Promise;
		expect(serverClient1.readyState).toBe(WebSocket.OPEN);

		// Second connection
		const client2Promise = waitForWebSocketClient(server);
		const client2 = new WebSocket(`ws://127.0.0.1:${address.port}`);
		await using serverClient2 = await client2Promise;
		expect(serverClient2.readyState).toBe(WebSocket.OPEN);

		await Promise.all([
			new Promise<void>((resolve) => {
				if (client1.readyState === WebSocket.OPEN) {
					client1.close();
					client1.once('close', () => resolve());
				} else {
					client1.once('open', () => {
						client1.close();
						client1.once('close', () => resolve());
					});
				}
			}),
			new Promise<void>((resolve) => {
				if (client2.readyState === WebSocket.OPEN) {
					client2.close();
					client2.once('close', () => resolve());
				} else {
					client2.once('open', () => {
						client2.close();
						client2.once('close', () => resolve());
					});
				}
			}),
		]);
	});

	test('should handle disposal in error scenarios', async () => {
		await using server = await createWebSocketServer();
		const address = server.address() as AddressInfo;

		let serverClientInstance: Awaited<ReturnType<typeof waitForWebSocketClient>> | undefined;

		try {
			const clientPromise = waitForWebSocketClient(server);
			const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

			await using serverClient = await clientPromise;
			serverClientInstance = serverClient;
			expect(serverClient.readyState).toBe(WebSocket.OPEN);

			await new Promise<void>((resolve) => {
				if (client.readyState === WebSocket.OPEN) {
					client.close();
					client.once('close', () => resolve());
				} else {
					client.once('open', () => {
						client.close();
						client.once('close', () => resolve());
					});
				}
			});
			throw new Error('Simulated error');
		} catch (_error) {
			// Expected error
		}

		// Client should still be disposed despite the error
		expect(serverClientInstance!.readyState).toBe(WebSocket.CLOSED);
	});
});
