export type ErrorType =
	| 'server_initialization'
	| 'server_started_before_ready'
	| 'client_connection'
	| 'client_env'
	| 'client_ack_timeout'
	| 'client_unauthorized';

const ERROR_MESSAGES: Record<ErrorType, string> = {
	server_initialization: 'Failed to determine the WebSocket server address.',
	server_started_before_ready: 'The pool worker was used before the WebSocket client connected.',
	client_connection: 'The WebSocket connection closed before the handshake completed.',
	client_env: 'The VITEST_VSCODE_ADDRESS environment variable is missing.',
	client_ack_timeout: 'Timed out waiting for the pool to acknowledge the worker.',
	client_unauthorized: 'The worker presented an invalid handshake token.',
};

export class EnvironmentVscodeError extends Error {
	type: ErrorType;

	constructor(type: ErrorType) {
		super(ERROR_MESSAGES[type]);
		this.name = 'EnvironmentVscodeError';
		this.type = type;
	}
}

export const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));
