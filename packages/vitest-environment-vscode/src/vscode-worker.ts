import { parse, stringify } from 'flatted';
import { runBaseTests, type VitestWorker } from 'vitest/workers';
import { getTransport } from './worker-transport';

const worker: VitestWorker = {
	getRpcOptions() {
		const transport = getTransport();
		return {
			post: (data) => transport.post(data),
			on: (fn) => transport.subscribe(fn),
			serialize: stringify,
			deserialize: parse,
		};
	},
	runTests: (state) => runBaseTests('run', state),
	collectTests: (state) => runBaseTests('collect', state),
};

export default worker;
