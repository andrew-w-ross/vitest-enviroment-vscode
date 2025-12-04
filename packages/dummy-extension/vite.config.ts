import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { vsCodeWorker } from 'vitest-environment-vscode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
	build: {
		target: 'node22',
		lib: {
			entry: {
				extension: resolve(__dirname, 'src/extension.ts'),
			},
			formats: ['es'],
		},
		outDir: 'dist',
		sourcemap: true,
		minify: false,
		rollupOptions: {
			external: ['vscode'],
		},
	},
	test: {
		pool: vsCodeWorker({
			version: 'insiders',
			reuseWorker: true,
			// Open the fake workspace project so vscode.workspace APIs see its files.
			// Relative paths are resolved against the Vitest project root
			// (here: packages/dummy-extension).
			workspaceRoot: '../sample-workspace',
		}),
		include: ['src/**/*.{test,spec}.ts'],
		globals: false,
		silent: true,
		server: {
			deps: {
				external: [/^vscode$/],
			},
		},
	},
});
