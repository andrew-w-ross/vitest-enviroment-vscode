import * as vscode from 'vscode';

async function countWorkspaceTodos(): Promise<number> {
	// Count TODO comments in the current workspace's TypeScript sources.
	// In this repo's tests, the workspace root is the sample-project folder.
	const files = await vscode.workspace.findFiles('src/**/*.ts');
	let total = 0;
	const decoder = new TextDecoder('utf-8');

	for (const file of files) {
		const contents = await vscode.workspace.fs.readFile(file);
		const text = decoder.decode(contents);
		const matches = text.match(/TODO/g);
		if (matches) {
			total += matches.length;
		}
	}

	return total;
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Dummy extension activated!');

	const helloDisposable = vscode.commands.registerCommand('dummy-extension.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from dummy extension!');
	});

	const countTodosDisposable = vscode.commands.registerCommand(
		'dummy-extension.countWorkspaceTodos',
		async () => {
			const total = await countWorkspaceTodos();
			vscode.window.showInformationMessage(
				`Found ${total} TODO comments in workspace TypeScript files`
			);
			return total;
		}
	);

	context.subscriptions.push(helloDisposable, countTodosDisposable);
}

export function deactivate() {
	// No cleanup needed
}
