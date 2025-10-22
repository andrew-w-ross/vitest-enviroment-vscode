import { describe, expect, vi, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { createWebSocketServer, waitForWebSocketClient } from './websocket.js';
import { EnviromentVscodeError } from '../errors.js';

describe('createWebSocketServer', () => {
	test('should create a WebSocketServer with correct configuration', async () => {
		await using server = await createWebSocketServer();

		expect(server.wss).toBeInstanceOf(WebSocketServer);
		// Verify it's configured for localhost
		const address = server.wss.address() as AddressInfo;
		expect(address.address).toBe('127.0.0.1');
		expect(address.port).toBeGreaterThan(0);
	});

	test('should wait for server to be ready before resolving', async () => {
		await using server = await createWebSocketServer();

		// Server should be listening and have a valid address
		const address = server.wss.address();
		expect(address).toBeTruthy();
		expect(typeof address).not.toBe('string');
	});

	test('should return a disposable object with wss property', async () => {
		await using server = await createWebSocketServer();

		expect(server).toHaveProperty('wss');
		expect(server.wss).toBeInstanceOf(WebSocketServer);
		expect(typeof server[Symbol.asyncDispose]).toBe('function');
	});

	test('should close the WebSocket server when disposed', async () => {
		const server = await createWebSocketServer();

		// Server should be listening
		expect(server.wss.address()).toBeTruthy();

		await server[Symbol.asyncDispose]();

		// After disposal, address should be null
		expect(server.wss.address()).toBeNull();
	});

	test('should automatically dispose when using await using syntax', async () => {
		let serverInstance: Awaited<ReturnType<typeof createWebSocketServer>> | undefined;

		{
			await using server = await createWebSocketServer();
			serverInstance = server;
			// Server should be listening within scope
			expect(server.wss.address()).toBeTruthy();
		}

		// After scope exit, server should be disposed
		expect(serverInstance!.wss.address()).toBeNull();
	});

	test('should only close the server once even if disposed multiple times', async () => {
		const server = await createWebSocketServer();
		const closeSpy = vi.spyOn(server.wss, 'close');

		await server[Symbol.asyncDispose]();
		await server[Symbol.asyncDispose]();
		await server[Symbol.asyncDispose]();

		expect(closeSpy).toHaveBeenCalledOnce();
	});

	test('should handle concurrent disposal calls', async () => {
		const server = await createWebSocketServer();
		const closeSpy = vi.spyOn(server.wss, 'close');

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
		const address = server.wss.address() as AddressInfo;

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
			expect(server.wss.address()).toBeTruthy();
			throw new Error('Simulated error');
		} catch (error) {
			// Expected error
		}

		// Server should still be disposed despite the error
		expect(serverInstance!.wss.address()).toBeNull();
	});

	test('should throw error when server address is null', async () => {
		const addressSpy = vi.spyOn(WebSocketServer.prototype, 'address');

		addressSpy.mockImplementationOnce(function (this: WebSocketServer) {
			// First call: check if ready - return null to wait for listening event
			return null;
		});

		addressSpy.mockImplementationOnce(function (this: WebSocketServer) {
			// Second call: after listening event - return null to trigger error
			return null;
		});

		try {
			const server = await createWebSocketServer();
			// Clean up if somehow it succeeded
			await server[Symbol.asyncDispose]();
			expect.fail('Should have thrown an error');
		} catch (error) {
			expect(error).toBeInstanceOf(EnviromentVscodeError);
			expect((error as EnviromentVscodeError).type).toBe('server_initialization');
		} finally {
			vi.restoreAllMocks();
		}
	});

	test('should throw error when server address is a string (Unix socket)', async () => {
		const addressSpy = vi.spyOn(WebSocketServer.prototype, 'address');

		addressSpy.mockImplementationOnce(function (this: WebSocketServer) {
			// First call: check if ready - return null to wait for listening event
			return null;
		});

		addressSpy.mockImplementationOnce(function (this: WebSocketServer) {
			// Second call: after listening event - return string to trigger error
			return '/tmp/socket.sock';
		});

		try {
			const server = await createWebSocketServer();
			// Clean up if somehow it succeeded
			await server[Symbol.asyncDispose]();
			expect.fail('Should have thrown an error');
		} catch (error) {
			expect(error).toBeInstanceOf(EnviromentVscodeError);
			expect((error as EnviromentVscodeError).type).toBe('server_initialization');
		} finally {
			vi.restoreAllMocks();
		}
	});
});

describe('waitForWebSocketClient', () => {
	test('should wait for and return a WebSocket client connection', async () => {
		await using server = await createWebSocketServer();
		const address = server.wss.address() as AddressInfo;

		// Create a client connection
		const clientPromise = waitForWebSocketClient(server.wss);
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		await using serverClient = await clientPromise;

		expect(serverClient.ws).toBeDefined();
		expect(serverClient.ws.readyState).toBe(WebSocket.OPEN);

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

	test('should return a disposable object with ws property', async () => {
		await using server = await createWebSocketServer();
		const address = server.wss.address() as AddressInfo;

		const clientPromise = waitForWebSocketClient(server.wss);
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		await using serverClient = await clientPromise;

		expect(serverClient).toHaveProperty('ws');
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
		const address = server.wss.address() as AddressInfo;

		const clientPromise = waitForWebSocketClient(server.wss);
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		const serverClient = await clientPromise;

		expect(serverClient.ws.readyState).toBe(WebSocket.OPEN);

		await serverClient[Symbol.asyncDispose]();

		expect(serverClient.ws.readyState).toBe(WebSocket.CLOSED);

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
		const address = server.wss.address() as AddressInfo;

		let serverClientInstance: Awaited<ReturnType<typeof waitForWebSocketClient>> | undefined;

		{
			const clientPromise = waitForWebSocketClient(server.wss);
			const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

			await using serverClient = await clientPromise;
			serverClientInstance = serverClient;
			expect(serverClient.ws.readyState).toBe(WebSocket.OPEN);

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
		expect(serverClientInstance!.ws.readyState).toBe(WebSocket.CLOSED);
	});

	test('should handle already closed WebSocket on disposal', async () => {
		await using server = await createWebSocketServer();
		const address = server.wss.address() as AddressInfo;

		const clientPromise = waitForWebSocketClient(server.wss);
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		const serverClient = await clientPromise;

		// Close the WebSocket before disposal
		serverClient.ws.close();
		await new Promise((resolve) => serverClient.ws.once('close', resolve));

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

		const clientPromise = waitForWebSocketClient(server.wss);

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

		const clientPromise = waitForWebSocketClient(server.wss);

		// Trigger an error on the server
		const error = new Error('Server error');
		server.wss.emit('error', error);

		await expect(clientPromise).rejects.toThrow(error);
	});

	test('should handle multiple sequential connections', async () => {
		await using server = await createWebSocketServer();
		const address = server.wss.address() as AddressInfo;


		// First connection
		const client1Promise = waitForWebSocketClient(server.wss);
		const client1 = new WebSocket(`ws://127.0.0.1:${address.port}`);
		await using serverClient1 = await client1Promise;
		expect(serverClient1.ws.readyState).toBe(WebSocket.OPEN);

		// Second connection
		const client2Promise = waitForWebSocketClient(server.wss);
		const client2 = new WebSocket(`ws://127.0.0.1:${address.port}`);
		await using serverClient2 = await client2Promise;
		expect(serverClient2.ws.readyState).toBe(WebSocket.OPEN);

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
		const address = server.wss.address() as AddressInfo;

		let serverClientInstance: Awaited<ReturnType<typeof waitForWebSocketClient>> | undefined;

		try {
			const clientPromise = waitForWebSocketClient(server.wss);
			const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

			await using serverClient = await clientPromise;
			serverClientInstance = serverClient;
			expect(serverClient.ws.readyState).toBe(WebSocket.OPEN);

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
		} catch (error) {
			// Expected error
		}

		// Client should still be disposed despite the error
		expect(serverClientInstance!.ws.readyState).toBe(WebSocket.CLOSED);
	});
});
