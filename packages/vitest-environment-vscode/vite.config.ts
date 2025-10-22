import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const poolSrc = resolve(__dirname, 'src/pool.ts');

export default defineConfig({
	build: {
		target: 'node22',
		lib: {
			entry: {
				pool: poolSrc,
				'worker-entry': resolve(__dirname, 'src/worker-entry.ts'),
				'vscode-worker': resolve(__dirname, 'src/vscode-worker.ts'),
			},
			formats: ['es'],
		},
		outDir: 'dist',
		sourcemap: true,
		minify: false,
		ssr: true,
		rollupOptions: {
			external: ['vscode'],
		},
	},
	test: {
		testTimeout: 1500,
		hookTimeout: 1500,
		name: 'unit',
		include: ['src/**/*.{test,spec}.ts'],
		environment: 'node',
		globals: false,
		typecheck: {
			enabled: true,
			include: ['src/**/*.test-d.ts'],
		},
	},
});
