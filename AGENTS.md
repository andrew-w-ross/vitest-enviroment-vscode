# Agent Guide

## Project Overview

- **Name:** vitest-environment-vscode
- **Type:** Monorepo with Yarn Workspaces
- **Goal:** Provide a Vitest-powered test pool that runs VS Code extension tests directly inside the VS Code Extension Host, exposing the real `vscode` API without heavy mocking.
- **Packages:**
    - `packages/vitest-environment-vscode` - Main library implementation
    - `packages/dummy-extension` - Sample VS Code extension for testing
    - `packages/typescript-configs` - Shared TypeScript configuration files

- **Key Artifacts:**
    - `README.md` (root) for architecture details, repository layout, and the Mermaid sequence diagram under **How It Works**. This file is also copied into `packages/vitest-environment-vscode/README.md` during the release workflow, so when instructions mention "update the README" they refer to the root `README.md`.
    - `packages/vitest-environment-vscode/src/` for implementation (pool entry point, VS Code worker, WebSocket bridge between Vitest and the VS Code Extension Host).

## Tooling Expectations

- Package manager: `yarn` with workspaces (see root `package.json`).
- Build orchestration: `turbo` (installed locally, not globally) for task caching and parallel execution.
- Development scripts (from root):
    - `yarn install` – install dependencies for all packages.
    - `yarn build` – produce production bundles for all packages (uses Turborepo).
    - `yarn build:watch` – run the development build/watch for all packages.
    - `yarn typecheck` – run TypeScript type checking for all packages.
    - `yarn typecheck:watch` – run TypeScript type checking in watch mode for all packages.
    - `yarn test` – run tests for all packages.
    - `yarn test:watch` – run tests in watch mode for all packages.
    - `yarn lint` – run ESLint on the entire codebase.
    - `yarn lint:fix` – run ESLint and automatically fix issues.
    - `yarn format` – format code using Prettier.
    - `yarn format:check` – check code formatting without making changes.
    - `yarn check` – full pre-commit check (format:check, lint, test).
- To run commands for a specific package, use the `--filter` flag:
    - Example: `yarn build --filter=vitest-environment-vscode`
    - Example: `yarn test --filter=dummy-extension`
    - This allows you to target individual packages in the monorepo without running the command across all packages.
- TypeScript project configured via workspace-specific `tsconfig.json` and `vite.config.ts` files.
- Shared TypeScript configs in `packages/typescript-configs`.

### Turborepo

- Tasks defined in `turbo.json` with dependency chains and output caching.
- `^build` notation means "dependencies must build first."
- Cache stored in `.turbo/` (gitignored).
- Persistent tasks (`build:watch`, `typecheck:watch`) disable caching.
- Force rebuild: `turbo run build --force`

## Architectural Highlights

- Custom Vitest pool launches VS Code via `@vscode/test-electron`.
- Worker script executes inside the Extension Host and communicates over `birpc`.
- RPC bridge coordinates task execution and state updates between processes.
- Design emphasizes reuse of Vitest infrastructure and real VS Code API access.

## Agent Execution Checklist

1. Review `README.md` (especially **How It Works** and **Repository Layout**) to stay aligned with the current architecture.
2. Use editor tools (not raw grep) for symbol discovery per workspace guidelines.
3. Prefer modifying files with provided apply/edit tools; avoid ad-hoc shell edits.
4. Verify changes and ensure Mermaid diagrams render when modified.
5. Confirm commands target the macOS `zsh` shell environment when needed.
6. When working with packages, navigate to the specific package directory or use workspace commands.
7. **Use Context7 for documentation:** When you need up-to-date library documentation or API references, use the Context7 MCP tools if available. These tools provide authoritative, current documentation for libraries and frameworks.
8. Before wrapping up a change, run `yarn check` and fix any reported issues.

## Notes

- Maintain ASCII encoding unless existing files justify otherwise.
- Do not revert user-authored changes without explicit instruction.
- Seek clarification if requirements are ambiguous before proceeding.
