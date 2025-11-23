const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

let cachedRun;

async function loadRun() {
	if (cachedRun) return cachedRun;
	const workerPath = resolve(__dirname, 'dist', 'vscode-worker.js');
	const moduleUrl = pathToFileURL(workerPath).href;
	const mod = await import(moduleUrl);
	if (typeof mod.run !== 'function') {
		throw new Error(
			'vitest-environment-vscode: Expected dist/vscode-worker.js to export a run function.'
		);
	}
	cachedRun = mod.run;
	return cachedRun;
}

module.exports.run = async (...args) => {
	const run = await loadRun();
	return run(...args);
};
