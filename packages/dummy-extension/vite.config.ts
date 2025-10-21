import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
	build: {
		target: 'node22',
		lib: {
			entry: resolve(__dirname, 'src/extension.ts'),
			formats: ['es'],
		},
		outDir: 'dist',
		sourcemap: true,
		minify: false,
		ssr: true,
		rollupOptions: {
			external: ["vscode"]
		}
	},
	test: {
		testTimeout: 40000,
		hookTimeout: 40000,
		pool: import.meta.resolve('vitest-environment-vscode/pool'),
		include: ['tests/**/*.{test,spec}.ts'],
		globals: false,
		silent: true,
		server: {
			deps: {
				external: [/^vscode$/],
			},
		},
	},
});
