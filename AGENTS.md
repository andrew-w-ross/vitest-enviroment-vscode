# Agent Guide

## Project Overview
- **Name:** vitest-environment-vscode
- **Goal:** Provide a Vitest-powered test pool that runs VS Code extension tests directly inside the VS Code Extension Host, exposing the real `vscode` API without heavy mocking.
- **Key Artifacts:**
  - `docs/design.md` for architecture details.
  - `docs/roadmap.md` for delivery milestones.
  - `src/` for implementation (pool entry point, VS Code worker, RPC bridge).

## Tooling Expectations
- Package manager: `yarn` (see `package.json`).
- Development scripts:
  - `yarn install` – install dependencies.
  - `yarn dev` – run the development build/watch.
  - `yarn build` – produce production bundles.
- TypeScript project configured via `tsconfig.json` and `vite.config.ts`.

## Architectural Highlights
- Custom Vitest pool launches VS Code via `@vscode/test-electron`.
- Worker script executes inside the Extension Host and communicates over `birpc`.
- RPC bridge coordinates task execution and state updates between processes.
- Design emphasizes reuse of Vitest infrastructure and real VS Code API access.

## Agent Execution Checklist
1. Review `docs/design.md` to stay aligned with the current architecture.
2. Use editor tools (not raw grep) for symbol discovery per workspace guidelines.
3. Prefer modifying files with provided apply/edit tools; avoid ad-hoc shell edits.
4. Verify changes and ensure Mermaid diagrams render when modified.
5. Confirm commands target the macOS `zsh` shell environment when needed.

## Notes
- Maintain ASCII encoding unless existing files justify otherwise.
- Do not revert user-authored changes without explicit instruction.
- Seek clarification if requirements are ambiguous before proceeding.
