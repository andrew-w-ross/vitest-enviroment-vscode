import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from './package.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate entry points from package.json exports
const entry = Object.entries(pkg.exports as Record<string, { import: string }>).reduce(
	(acc, [key, value]) => {
		// Extract the name from the export path (e.g., "./pool" -> "pool", "." -> "pool")
		const name = key === '.' ? 'index' : key.replace('./', '');
		// Convert dist path to src path (e.g., "./dist/pool" -> "src/pool.ts")
		const srcPath = value.import.replace('./dist/', 'src/').replace(/\.d\.ts$/, '') + '.ts';
		acc[name] = resolve(__dirname, srcPath);
		return acc;
	},
	{} as Record<string, string>
);

export default defineConfig({
	plugins: [
		tsconfigPaths({
			configNames: ['tsconfig.app.json'],
		}),
	],
	build: {
		target: 'node22',
		lib: {
			entry,
			formats: ['es'],
		},
		outDir: 'dist',
		sourcemap: true,
		minify: false,
		emptyOutDir: false,
		rollupOptions: {
			external: [...Object.keys(pkg.dependencies), /^node:/],
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
			checker: 'tsc',
			tsconfig: './tsconfig.test.json',
		},
	},
});
