import type { WorkerRequest } from 'vitest/node';

export function serialize(request: WorkerRequest): Buffer {
	const json = JSON.stringify(request);
	return Buffer.from(json, 'utf-8');
}

//TODO: Fix this mess
export function deserialize(value: unknown): WorkerRequest {
	let json: string;

	if (typeof value === 'string') {
		json = value;
	} else if (Buffer.isBuffer(value)) {
		json = value.toString('utf-8');
	} else {
		throw new TypeError('Expected string or Buffer for deserialization');
	}

	return JSON.parse(json) as WorkerRequest;
}
