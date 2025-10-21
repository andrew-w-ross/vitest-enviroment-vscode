import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Dummy extension activated!');

	const disposable = vscode.commands.registerCommand('dummy-extension.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from dummy extension!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {
	// No cleanup needed
}
