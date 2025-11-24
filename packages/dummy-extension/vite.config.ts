import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
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
		}),
		testTimeout: 20000,
		hookTimeout: 20000,
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
