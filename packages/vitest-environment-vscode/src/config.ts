import type { PoolOptions } from 'vitest/node';
import { z } from 'zod';

export const vitestVscodeConfigSchema = z
	.object({
		version: z.union([z.literal('stable'), z.literal('insiders'), z.string()]).optional(),
	})
	.loose();

export type VitestVscodeConfig = z.infer<typeof vitestVscodeConfigSchema>;

export function config(poolOptions?: PoolOptions & VitestVscodeConfig) {
	return {
		pool: import.meta.resolve('vitest-environment-vscode'),
		poolOptions,
	};
}
