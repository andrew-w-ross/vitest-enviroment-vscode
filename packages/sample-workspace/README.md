# fixture-workspace-todos

A fake VS Code workspace used by this repo's tests and docs.

- Lives at `packages/sample-workspace`
- Exposes a tiny TypeScript module in `src/index.ts`
- Contains a couple of `TODO` comments for extensions to discover

## How it's used

- The dummy extension opens this folder as its workspace root via `workspaceRoot: '../sample-workspace'` in its Vitest config.
- The `dummy-extension.countWorkspaceTodos` command walks `src/**/*.ts` in this workspace and counts `TODO` comments.

In your own extension, you can follow the same pattern:

1. Create a small fixture workspace (like this package) with representative files and comments.
2. Point `workspaceRoot` at that folder in your Vitest config.
3. Use `vscode.workspace.findFiles` and `vscode.workspace.fs.readFile` to exercise workspace-aware logic in tests.
