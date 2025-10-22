export type ErrorType = 'server_initialization' | 'client_connection';

export class EnviromentVscodeError extends Error {
	type: ErrorType;

	constructor(type: ErrorType) {
		super();
		this.type = type;
	}
}
