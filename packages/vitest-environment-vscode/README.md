# vitest-environment-vscode

A Vitest environment for VS Code

> **Note:** The project name intentionally keeps the "environment" phrasing even though it ships a Vitest pool under the hood. The branding matches how folks search for VS Code testing tooling, so we're sticking with it for now.

## Installation

```bash
yarn install
```

## Configuration

### VS Code Download Cache Location

When the pool downloads VS Code via `@vscode/test-electron`, it controls the
cache location through the `cachePath` option in the pool config.

- If you explicitly set `cachePath`, that value is used as-is.
- If you do not set `cachePath` and a `node_modules` directory exists in the
  extension project root, the pool uses `node_modules/.cache/.vscode-test`.
- If there is no `node_modules` directory, the default `.vscode-test` folder
  in the project root is used (the upstream `@vscode/test-electron` default).

This keeps the downloaded VS Code binary inside `node_modules/.cache` when
possible, instead of cluttering the workspace root.

### Log Level

By default, the pool produces minimal output. To see debug logs for troubleshooting, set the `logLevel` in your Vitest config:

```typescript
// vite.config.ts or vitest.config.ts
import { defineConfig } from 'vitest/config';
import { vsCodeWorker } from 'vitest-environment-vscode';

export default defineConfig({
	test: {
		logLevel: 'debug', // Show detailed pool and worker logs
		// Use the VS Code pool
		pool: vsCodeWorker({
			reuseWorker: true,
		}),
		// ... other config
	},
});
```

You can also control it via CLI:

```bash
# Show debug logs
vitest --logLevel=debug

# Suppress debug logs (default)
vitest --logLevel=info
```

## Development

```bash
yarn dev
```

## Build

```bash
yarn build
```
