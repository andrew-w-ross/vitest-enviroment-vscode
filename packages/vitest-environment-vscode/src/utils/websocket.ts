import { WebSocketServer, type WebSocket } from 'ws';
import { EnviromentVscodeError } from '../errors';
import { toAsyncDispose } from './disposable';
import { handleOnce } from './handlers';

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

		const stack = new DisposableStack();
		stack.use(
			handleOnce(wss, 'listening', () => {
				stack.dispose();
				resolve();
			})
		);
		stack.use(
			handleOnce(wss, 'error', (error: Error) => {
				stack.dispose();
				reject(error);
			})
		);
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
		const stack = new DisposableStack();

		stack.use(
			handleOnce(wss, 'connection', (ws: WebSocket) => {
				stack.dispose();
				resolve(ws);
			})
		);
		stack.use(
			handleOnce(wss, 'error', (error: Error) => {
				stack.dispose();
				reject(error);
			})
		);
		stack.use(
			handleOnce(wss, 'close', () => {
				stack.dispose();
				reject(new EnviromentVscodeError('client_connection'));
			})
		);
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

				const stack = new DisposableStack();

				stack.use(
					handleOnce(ws, 'close', () => {
						stack.dispose();
						resolve();
					})
				);
				stack.use(
					handleOnce(ws, 'error', (error: Error) => {
						stack.dispose();
						reject(error);
					})
				);

				ws.close();
			});
		}
	);
}
