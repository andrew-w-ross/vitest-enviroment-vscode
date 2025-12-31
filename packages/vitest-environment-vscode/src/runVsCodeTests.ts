import {
	type DownloadOptions,
	SilentReporter,
	downloadAndUnzipVSCode,
	resolveCliArgsFromVSCodeExecutablePath,
} from '@vscode/test-electron';
import { spawn } from 'child_process';
import { EnviromentVscodeError } from './errors';
import type { Vitest } from 'vitest/node';
import { invoke, once, timeout } from 'indisposed';
import { CliArgs } from './utils/cliArgs';

/** Default timeout in milliseconds for VS Code to start and complete tests */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Additional timeout when a debugger is attached */
const DEBUG_TIMEOUT_EXTENSION_MS = 60_000;

export type VsCodeTestOptions = {
	vscodeExecutablePath?: string;
	version?: string;
	platform?: string;
	cachePath?: string;
	reuseMachineInstall?: boolean;
	extensionDevelopmentPath: string | string[];
	extensionTestsPath: string;
	extensionTestsEnv?: Record<string, string>;
	launchArgs?: string[];
	logger?: Vitest['logger'];
	isDebug?: boolean;
	/** Timeout in ms for VS Code to start. Defaults to 60s, extended by 60s if debugger attached. */
	timeout?: number;
};

/**
 * This is essentially a copy of the runVsc
 * @param options
 * @returns
 */
export async function runVsCodeTests(options: VsCodeTestOptions) {
	let executable = options.vscodeExecutablePath;
	if (!executable) {
		const downloadOptions = {
			version: options.version,
			platform: options.platform,
			cachePath: options.cachePath,
			reporter: new SilentReporter(),
		} satisfies Partial<DownloadOptions>;
		executable = await downloadAndUnzipVSCode(downloadOptions);
	}

	const [cli, ...platformArgs] = resolveCliArgsFromVSCodeExecutablePath(executable, options);

	if (cli == null) {
		throw new EnviromentVscodeError('vscode_not_found');
	}

	// Build CLI arguments using CliArgs so callers can more easily
	// inspect and tweak `--key=value` style options while still
	// preserving positional arguments.
	// Combine platform-specific args from resolve with user-provided launchArgs
	const cliArgs = new CliArgs([...platformArgs, ...(options.launchArgs ?? [])])
		.set('no-sandbox')
		.set('disable-gpu-sandbox')
		.set('disable-updates')
		.set('skip-welcome')
		.set('skip-release-notes')
		.set('disable-workspace-trust')
		.set('extensionTestsPath', options.extensionTestsPath);

	if (Array.isArray(options.extensionDevelopmentPath)) {
		for (const devPath of options.extensionDevelopmentPath) {
			cliArgs.set('extensionDevelopmentPath', devPath);
		}
	} else {
		cliArgs.set('extensionDevelopmentPath', options.extensionDevelopmentPath);
	}

	const fullEnv: NodeJS.ProcessEnv = {
		...process.env,
		...options.extensionTestsEnv,
	};

	const shell = process.platform === 'win32';

	const cmd = spawn(shell ? `"${cli}"` : cli, cliArgs.toArray(), {
		env: fullEnv,
		shell,
	});

	// Calculate timeout: use provided timeout, or default + extension if debugging
	const baseTimeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
	const timeoutMs = options.isDebug ? baseTimeout + DEBUG_TIMEOUT_EXTENSION_MS : baseTimeout;

	return await invoke(async () => {
		using errorResult = once(cmd, 'error', true);
		using closeResult = once(cmd, 'close');
		using timeOutResult = timeout(timeoutMs);
		using disposer = new DisposableStack();

		if (options.logger) {
			cmd.stderr.pipe(options.logger.errorStream);
			disposer.defer(() => cmd.stderr.unpipe(options.logger?.errorStream));

			if (options.isDebug) {
				cmd.stdout.pipe(options.logger.outputStream);
				cmd.stderr.pipe(options.logger.errorStream);

				disposer.defer(() => {
					cmd.stdout.unpipe(options.logger?.outputStream);
					cmd.stderr.unpipe(options.logger?.errorStream);
				});
			}
		}

		await Promise.race([
			timeOutResult.then(() => {
				killProcess(cmd);
				throw new EnviromentVscodeError('vscode_timeout');
			}),
			closeResult.then(([code]) => {
				if (code !== 0) {
					throw new Error(`VS Code test run failed with code ${code}`);
				}
			}),
			errorResult,
		]);
	});
}

/**
 * Kill a child process and its entire process tree.
 * On Windows, uses taskkill. On Unix, sends SIGTERM then SIGKILL.
 */
function killProcess(cmd: ReturnType<typeof spawn>): void {
	const pid = cmd.pid;
	if (pid == null) {
		return;
	}

	try {
		if (process.platform === 'win32') {
			// On Windows, use taskkill to kill the process tree
			spawn('taskkill', ['/pid', pid.toString(), '/T', '/F'], { stdio: 'ignore' });
		} else {
			// On Unix, try SIGTERM first, then SIGKILL
			cmd.kill('SIGTERM');
			setTimeout(() => {
				try {
					// Check if process is still running and force kill
					process.kill(pid, 0); // throws if process doesn't exist
					cmd.kill('SIGKILL');
				} catch {
					// Process already dead, ignore
				}
			}, 2000);
		}
	} catch {
		// Ignore errors during kill
	}
}
