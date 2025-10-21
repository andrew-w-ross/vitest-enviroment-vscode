# vitest-environment-vscode

A monorepo for Vitest environment for VS Code

> **Note:** The project name intentionally keeps the "environment" phrasing even though it ships a Vitest pool under the hood. The branding matches how folks search for VS Code testing tooling, so we're sticking with it for now.

## Project Structure

This monorepo contains:

- **`packages/vitest-environment-vscode`** - The main library that provides a Vitest pool for running tests inside VS Code Extension Host
- **`packages/dummy-extension`** - A sample VS Code extension used for testing
- **`packages/typescript-configs`** - Shared TypeScript configuration files

## Installation

```bash
yarn install
```

## Development

```bash
yarn build:watch
```

## Build

```bash
yarn build
```

## Testing

```bash
# Run unit tests
yarn test:unit

# Run integration tests
yarn test:integration

# Run all tests
yarn test
```
