# vitest-environment-vscode

A Vitest environment for VS Code

> **Note:** The project name intentionally keeps the "environment" phrasing even though it ships a Vitest pool under the hood. The branding matches how folks search for VS Code testing tooling, so we're sticking with it for now.

## Installation

```bash
yarn install
```

## Configuration

### Log Level

By default, the pool produces minimal output. To see debug logs for troubleshooting, set the `logLevel` in your Vitest config:

```typescript
// vite.config.ts or vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    logLevel: 'debug', // Show detailed pool and worker logs
    pool: import.meta.resolve('vitest-environment-vscode/pool'),
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
