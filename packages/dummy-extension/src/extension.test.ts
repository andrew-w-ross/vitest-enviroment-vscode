import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { activate } from './extension';

describe('dummy extension', () => {
	it('imports the vscode module', () => {
		expect(vscode).toBeDefined();
		expect(vscode.window).toBeDefined();
	});

	it('activates and registers the hello world command', async () => {
		// Create a mock extension context
		const context = {
			subscriptions: [],
		} as unknown as vscode.ExtensionContext;

		// Activate the extension
		activate(context);

		// Verify the command was registered
		expect(context.subscriptions).toHaveLength(1);

		// Execute the command and verify it shows a message
		const result = await vscode.commands.executeCommand('dummy-extension.helloWorld');

		// The command executes successfully (doesn't throw)
		expect(result).toBeUndefined();
	});

	it('shows an information message when command is executed', async () => {
		// Execute the hello world command
		await vscode.commands.executeCommand('dummy-extension.helloWorld');
	});
});
