export type ErrorType = 'server_initialization';

export class EnviromentVscodeError extends Error {
	type: ErrorType;

	constructor(type: ErrorType) {
		super();
		this.type = type;
	}
}
