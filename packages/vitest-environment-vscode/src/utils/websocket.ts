import { WebSocketServer } from 'ws';
import { EnviromentVscodeError } from '../errors';
import { toAsyncDispose } from './disposable';

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
	if (!address || typeof address === "string") {
		new EnviromentVscodeError("server_initialization");
	}
	return toAsyncDispose({
		wss
	}, async ({ wss }) => {
		await new Promise((resolve, reject) => {
			wss.close((error) => {
				if (error != null)
					return reject(error);

				resolve(undefined)
			})
		})
	})
}
