import type { PoolRunnerInitializer } from 'vitest/node';
import { vitestVscodeConfigSchema, type VitestVscodeConfig } from './config';
import { VscodePoolWorker } from './VscodePoolWorker';

export { vitestVscodeConfigSchema, type VitestVscodeConfig } from './config';

const POOL_NAME = 'vitest-environment-vscode';

export function vsCodeWorker(configInput: VitestVscodeConfig): PoolRunnerInitializer {
	const customConfig = vitestVscodeConfigSchema.parse(configInput);

	return {
		name: POOL_NAME,
		createPoolWorker: (options) => new VscodePoolWorker(options, customConfig),
	};
}
