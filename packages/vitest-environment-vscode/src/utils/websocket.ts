import { WebSocket, WebSocketServer } from 'ws';
import { EnviromentVscodeError } from '../errors';
import { invoke, once, toAsyncDisposable } from 'indisposed';

/**
 * Start a localhost WebSocket server on a random port and return an async disposable wrapper.
 * Rejects with `EnviromentVscodeError` when the server fails to bind.
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
 * Wait for the next inbound client connection and return an async disposable WebSocket instance.
 * Throws `EnviromentVscodeError` if the server closes or errors before a client appears.
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
 * Connect to a remote WebSocket endpoint and wait until the handshake finishes.
 * Throws `EnviromentVscodeError` if the remote side shuts down before opening.
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
