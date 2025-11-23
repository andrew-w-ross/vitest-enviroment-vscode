import { WebSocket, WebSocketServer } from 'ws';
import { EnviromentVscodeError } from '../errors';
import { invoke, once, toAsyncDisposable } from 'indisposed';

/**
 * Create a WebSocket server bound to localhost with automatic port allocation.
 * Returns an async disposable that will automatically close the server when disposed.
 * @returns A disposable object containing the WebSocket server instance
 * @throws {EnviromentVscodeError} When server fails to bind or address is invalid
 * @example
 * ```ts
 * // Automatic cleanup with await using
 * await using server = await createWebSocketServer();
 * const address = server.address();
 * console.log(`Server listening on port ${address.port}`);
 * // Server automatically closes when scope exits
 *
 * // Manual cleanup when needed
 * const server = await createWebSocketServer();
 * try {
 *   // Use the server for WebSocket operations
 *   server.on('connection', (ws) => {
 *     ws.send('Hello!');
 *   });
 * } finally {
 *   await server[Symbol.asyncDispose]();
 * }
 * ```
 */
export async function createWebSocketServer() {
	const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });

	await invoke(async () => {
		using listening = once(wss, 'listening');
		using error = once(wss, 'error', true);

		await Promise.race([listening, error]);
	});

	return toAsyncDisposable(wss, async (server) => {
		await new Promise((resolve, reject) => {
			server.close((error) => {
				if (error != null) return reject(error);

				resolve(undefined);
			});
		});
	});
}

/**
 * Wait for the next WebSocket client connection on the given server.
 * Returns an async disposable that will automatically close the client when disposed.
 * @param wss - The WebSocket server to wait for a connection on
 * @returns A disposable object containing the WebSocket client instance
 * @throws {EnviromentVscodeError} When server closes or encounters an error before a connection
 * @example
 * ```ts
 * // Automatic cleanup with await using
 * await using server = await createWebSocketServer();
 * await using client = await waitForWebSocketClient(server);
 * client.send('Hello from server!');
 * // Client automatically closes when scope exits
 *
 * // Manual cleanup when needed
 * const server = await createWebSocketServer();
 * const client = await waitForWebSocketClient(server);
 * try {
 *   client.on('message', (data) => {
 *     console.log('Received:', data.toString());
 *   });
 * } finally {
 *   await client[Symbol.asyncDispose]();
 * }
 * ```
 */
export async function waitForWebSocketClient(wss: WebSocketServer) {
	const ws = await invoke(async () => {
		using connection = once(wss, 'connection');
		using serverError = once(wss, 'error', true);
		using serverClose = once(wss, 'close');

		const [ws] = await Promise.race([
			connection,
			serverError,
			serverClose.then(() => {
				throw new EnviromentVscodeError('client_connection');
			}),
		]);

		return ws;
	});

	return toAsyncDisposable(ws, async (client) => {
		if (client.readyState === client.CLOSED) return;
		using closeListener = once(client, 'close');
		using errorListener = once(client, 'error', true);

		client.close();
		await Promise.race([closeListener, errorListener]);
	});
}

/**
 * Connect to a remote WebSocket endpoint and wait for the handshake to finish.
 * Unlike {@link waitForWebSocketClient}, this operates from the client side and
 * returns the raw `WebSocket` instance so callers can manage its lifecycle.
 * @param address - Full WebSocket address, e.g. `ws://127.0.0.1:12345`
 * @returns The connected WebSocket instance
 * @throws {EnviromentVscodeError} When the remote server closes before opening
 * @example
 * ```ts
 * import type { AddressInfo } from 'net';
 *
 * await using server = await createWebSocketServer();
 * const { port } = server.address() as AddressInfo;
 * const ws = await waitForConnection(`ws://127.0.0.1:${port}`);
 * ws.send('ping');
 * ```
 */
export async function waitForConnection(address: string) {
	const ws = new WebSocket(address);

	await invoke(async () => {
		using connection = once(ws, 'open');
		using serverError = once(ws, 'error', true);
		using serverClose = once(ws, 'close');

		await Promise.race([
			connection,
			serverError,
			serverClose.then(() => {
				throw new EnviromentVscodeError('client_connection');
			}),
		]);
	});

	return ws;
}
