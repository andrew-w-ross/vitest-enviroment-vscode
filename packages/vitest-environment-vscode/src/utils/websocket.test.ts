import { describe, expect, vi, test as baseTest } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { http, ws } from 'msw';
import { setupServer } from 'msw/node';
import { createWebSocketServer } from './websocket.js';

const test = baseTest.extend<{
	mswServer: ReturnType<typeof setupServer>;
}>({
	mswServer: [
		async ({ }, use) => {
			ws.link('ws://127.0.0.1:*');
			const server = setupServer();
			server.listen({ onUnhandledRequest: 'bypass' });
			await use(server);
			server.close();
		},
		{ auto: true },
	],
});

describe('createWebSocketServer', () => {

	test('should create a WebSocketServer with correct configuration', async () => {
		const result = await createWebSocketServer();

		expect(result.wss).toBeInstanceOf(WebSocketServer);
		// Verify it's configured for localhost
		const address = result.wss.address() as AddressInfo;
		expect(address.address).toBe('127.0.0.1');
		expect(address.port).toBeGreaterThan(0);

		await result[Symbol.asyncDispose]();
	});

	test('should wait for server to be ready before resolving', async () => {
		const result = await createWebSocketServer();

		// Server should be listening and have a valid address
		const address = result.wss.address();
		expect(address).toBeTruthy();
		expect(typeof address).not.toBe('string');

		await result[Symbol.asyncDispose]();
	});

	test('should return a disposable object with wss property', async () => {
		const result = await createWebSocketServer();

		expect(result).toHaveProperty('wss');
		expect(result.wss).toBeInstanceOf(WebSocketServer);
		expect(typeof result[Symbol.asyncDispose]).toBe('function');

		await result[Symbol.asyncDispose]();
	});

	test('should close the WebSocket server when disposed', async () => {
		const result = await createWebSocketServer();

		// Server should be listening
		expect(result.wss.address()).toBeTruthy();

		await result[Symbol.asyncDispose]();

		// After disposal, address should be null
		expect(result.wss.address()).toBeNull();
	});

	test('should only close the server once even if disposed multiple times', async () => {
		const result = await createWebSocketServer();
		const closeSpy = vi.spyOn(result.wss, 'close');

		await result[Symbol.asyncDispose]();
		await result[Symbol.asyncDispose]();
		await result[Symbol.asyncDispose]();

		expect(closeSpy).toHaveBeenCalledOnce();
	});

	test('should handle concurrent disposal calls', async () => {
		const result = await createWebSocketServer();
		const closeSpy = vi.spyOn(result.wss, 'close');

		const promises = [
			result[Symbol.asyncDispose](),
			result[Symbol.asyncDispose](),
			result[Symbol.asyncDispose](),
		];

		await Promise.all(promises);

		expect(closeSpy).toHaveBeenCalledOnce();
	});

	test('should resolve with undefined when close succeeds', async () => {
		const result = await createWebSocketServer();
		const disposeResult = await result[Symbol.asyncDispose]();

		expect(disposeResult).toBeUndefined();
	});

	test('should accept WebSocket connections', async () => {
		const result = await createWebSocketServer();
		const address = result.wss.address() as AddressInfo;

		// Create a client connection
		const WebSocket = (await import('ws')).default;
		const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

		await new Promise<void>((resolve, reject) => {
			client.on('open', () => resolve());
			client.on('error', reject);
		});

		expect(client.readyState).toBe(WebSocket.OPEN);

		client.close();
		await result[Symbol.asyncDispose]();
	});
});
