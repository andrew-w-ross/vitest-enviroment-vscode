import { WebSocketServer } from 'ws';

export async function createWebSocketServer() {
	const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
	await new Promise<void>((resolve, reject) => {
		if (wss.address() != null) {
			return resolve();
		}
		wss.once('listening', resolve);
		wss.once('error', reject);
	});
}
