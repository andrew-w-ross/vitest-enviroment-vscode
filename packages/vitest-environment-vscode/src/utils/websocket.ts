import { WebSocket, WebSocketServer } from 'ws';
import { EnviromentVscodeError } from '../errors';
import { toAsyncDispose } from './disposable';
import { handleOnce } from './handlers';
import { invoke } from './fn';

/**
 * Create a WebSocket server bound to localhost with automatic port allocation.
 * Returns an async disposable that will automatically close the server when disposed.
 * @returns A disposable object containing the WebSocket server instance
 * @throws {EnviromentVscodeError} When server fails to bind or address is invalid
 * @example
 * ```ts
 * // Automatic cleanup with await using
 * await using server = await createWebSocketServer();
 * const address = server.wss.address();
 * console.log(`Server listening on port ${address.port}`);
 * // Server automatically closes when scope exits
 *
 * // Manual cleanup when needed
 * const server = await createWebSocketServer();
 * try {
 *   // Use server.wss for WebSocket operations
 *   server.wss.on('connection', (ws) => {
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
		using listening = handleOnce(wss, 'listening');
		using error = handleOnce(wss, 'error', true);

		await Promise.race([listening, error]);
	});

	return toAsyncDispose(
		{
			wss,
		},
		async ({ wss }) => {
			await new Promise((resolve, reject) => {
				wss.close((error) => {
					if (error != null) return reject(error);

					resolve(undefined);
				});
			});
		}
	);
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
 * await using client = await waitForWebSocketClient(server.wss);
 * client.ws.send('Hello from server!');
 * // Client automatically closes when scope exits
 *
 * // Manual cleanup when needed
 * const server = await createWebSocketServer();
 * const client = await waitForWebSocketClient(server.wss);
 * try {
 *   client.ws.on('message', (data) => {
 *     console.log('Received:', data.toString());
 *   });
 * } finally {
 *   await client[Symbol.asyncDispose]();
 * }
 * ```
 */
export async function waitForWebSocketClient(wss: WebSocketServer) {
	const ws = await invoke(async () => {
		using connection = handleOnce(wss, 'connection');
		using serverError = handleOnce(wss, 'error', true);
		using serverClose = handleOnce(wss, 'close');

		const [ws] = await Promise.race([
			connection,
			serverError,
			serverClose.then(() => {
				throw new EnviromentVscodeError('client_connection');
			}),
		]);

		return ws;
	});

	return toAsyncDispose(
		{
			ws,
		},
		async ({ ws }) => {
			if (ws.readyState === ws.CLOSED) return;
			using closeListener = handleOnce(ws, 'close');
			using errorListener = handleOnce(ws, 'error', true);

			ws.close();
			await Promise.race([closeListener, errorListener]);
		}
	);
}

export async function waitForConnection(address: string) {
	const ws = new WebSocket(address);

	await invoke(async () => {
		using connection = handleOnce(ws, 'open');
		using serverError = handleOnce(ws, 'error', true);
		using serverClose = handleOnce(ws, 'close');

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
