import type { PoolRunnerInitializer } from 'vitest/node';
import { vitestVscodeConfigSchema, type VitestVscodeConfig } from './config';
import { VscodePoolWorker } from './VscodePoolWorker';

export { vitestVscodeConfigSchema, type VitestVscodeConfig } from './config';

const POOL_NAME = 'vitest-environment-vscode';

export function vsCodeWorker(configInput: VitestVscodeConfig): PoolRunnerInitializer {
	// Allow VSCODE_VERSION environment variable to override the version
	const input = { ...configInput };
	if (process.env.VSCODE_VERSION) {
		input.version = process.env.VSCODE_VERSION;
	}

	const customConfig = vitestVscodeConfigSchema.parse(input);

	return {
		name: POOL_NAME,
		createPoolWorker: (options) => new VscodePoolWorker(options, customConfig),
	};
}
