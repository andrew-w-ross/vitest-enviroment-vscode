import { isNullOrEmpty } from '~/utils/string';
import { EnviromentVscodeError } from '~/errors';
import { waitForConnection } from '~/utils/websocket';
import { init, runBaseTests } from 'vitest/worker';
import { deserialize, serialize } from './utils/workerRequestSerializer';

export async function run() {
	const serverAddress = process.env.VITEST_VSCODE_ADDRESS;
	if (isNullOrEmpty(serverAddress)) throw new EnviromentVscodeError('client_env');

	const ws = await waitForConnection(serverAddress);
	await new Promise((resolve) => {
		init({
			post: (response) => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				ws.send(response);
			},
			on: (callback) => {
				ws.on('message', callback);
			},
			off: (callback) => {
				ws.off('message', callback);
			},
			teardown: () => {
				resolve(undefined);
			},
			serialize: serialize,
			deserialize: deserialize,
			runTests: (state) => runBaseTests('run', state),
			collectTests: (state) => runBaseTests('collect', state),
		});
	});
}
