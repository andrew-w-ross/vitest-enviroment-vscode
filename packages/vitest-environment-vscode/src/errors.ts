export type ErrorType = 'server_initialization' | 'client_connection' | 'client_env';

export class EnviromentVscodeError extends Error {
	type: ErrorType;

	constructor(type: ErrorType) {
		super();
		this.type = type;
	}
}

export class NotImplementedError extends Error {
	constructor() {
		super('This is not implemented yet.');
	}
}

export const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

export const toErrorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
};
