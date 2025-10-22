import { WebSocketServer, type WebSocket } from 'ws';
import { EnviromentVscodeError } from '../errors';
import { toAsyncDispose } from './disposable';

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
	await new Promise<void>((resolve, reject) => {
		//If it has an address it's already ready
		if (wss.address() != null) {
			return resolve();
		}
		wss.once('listening', resolve);
		wss.once('error', reject);
	});

	const address = wss.address();
	if (!address || typeof address === 'string') {
		throw new EnviromentVscodeError('server_initialization');
	}
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
	const ws = await new Promise<WebSocket>((resolve, reject) => {
		const onConnection = (ws: WebSocket) => {
			cleanup();
			resolve(ws);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onClose = () => {
			cleanup();
			reject(new EnviromentVscodeError('client_connection'));
		};

		const cleanup = () => {
			wss.off('connection', onConnection);
			wss.off('error', onError);
			wss.off('close', onClose);
		};

		wss.once('connection', onConnection);
		wss.once('error', onError);
		wss.once('close', onClose);
	});

	return toAsyncDispose(
		{
			ws,
		},
		async ({ ws }) => {
			await new Promise<void>((resolve, reject) => {
				if (ws.readyState === ws.CLOSED) {
					return resolve();
				}

				const onClose = () => {
					cleanup();
					resolve();
				};
				const onError = (error: Error) => {
					cleanup();
					reject(error);
				};

				const cleanup = () => {
					ws.off('close', onClose);
					ws.off('error', onError);
				};

				ws.once('close', onClose);
				ws.once('error', onError);
				ws.close();
			});
		}
	);
}
