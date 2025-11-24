import type { PoolOptions } from 'vitest/node';
import { z } from 'zod';

export const vitestVscodeConfigSchema = z
	.object({
		version: z
			.union([z.literal('stable'), z.literal('insiders'), z.string()])
			.default(process.env.VSCODE_VERSION || 'stable'),
		/**
		 * Whether to reuse the VS Code worker instance across test runs.
		 * @default false
		 */
		reuseWorker: z.boolean().optional().default(false),
		/**
		 * The VS Code executable path used for testing.
		 * If not passed, will use `version` to download a copy of VS Code for testing.
		 */
		vscodeExecutablePath: z.string().optional(),
		/**
		 * Whether VS Code should be launched using default settings and extensions
		 * installed on this machine. If `false`, then separate directories will be
		 * used inside the `.vscode-test` folder within the project.
		 * @default false
		 */
		reuseMachineInstall: z.boolean().optional(),
		/**
		 * Additional launch arguments passed to VS Code executable.
		 * See `code --help` for possible arguments.
		 */
		launchArgs: z.array(z.string()).optional(),
		/**
		 * The VS Code platform to download. If not specified, defaults to current platform.
		 * Possible values: 'win32-x64-archive', 'win32-arm64-archive', 'darwin', 'darwin-arm64',
		 * 'linux-x64', 'linux-arm64', 'linux-armhf'
		 */
		platform: z.string().optional(),
		/**
		 * Path where the downloaded VS Code instance is stored.
		 * Defaults to `.vscode-test` within your working directory.
		 */
		cachePath: z.string().optional(),
		/**
		 * Number of milliseconds after which to time out if no data is received when downloading VS Code.
		 */
		timeout: z.number().optional(),
	})
	.loose();

export type VitestVscodeConfig = z.infer<typeof vitestVscodeConfigSchema>;

export function config(poolOptions?: PoolOptions & VitestVscodeConfig) {
	// Allow VSCODE_VERSION environment variable to override the version
	const options: Partial<VitestVscodeConfig> = poolOptions ? { ...poolOptions } : {};
	if (process.env.VSCODE_VERSION) {
		options.version = process.env.VSCODE_VERSION;
	}

	return {
		pool: import.meta.resolve('vitest-environment-vscode'),
		poolOptions: options,
	};
}
