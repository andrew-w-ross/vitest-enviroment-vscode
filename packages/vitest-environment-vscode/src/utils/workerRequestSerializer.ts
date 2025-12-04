import { parse, stringify } from 'devalue';
import type { WorkerRequest } from 'vitest/node';

export type ControlRequest =
	| {
			type: 'ready';
	  }
	| {
			type: 'ready_ack';
	  };

export type Request = WorkerRequest | ControlRequest;

export function serialize(request: Request): Buffer {
	const json = stringify(request);
	return Buffer.from(json, 'utf-8');
}

export function deserialize(value: unknown): Request {
	let json: string;

	if (typeof value === 'string') {
		json = value;
	} else if (Buffer.isBuffer(value)) {
		json = value.toString('utf-8');
	} else {
		throw new TypeError('Expected string or Buffer for deserialization');
	}

	return parse(json) as Request;
}
