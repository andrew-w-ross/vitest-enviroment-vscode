import { parse, stringify } from 'flatted';

export const RPC_CHANNEL = 'rpc';
export const CONTROL_CHANNEL = 'control';

type EnvelopeChannel = typeof RPC_CHANNEL | typeof CONTROL_CHANNEL;

export type ControlRequest = {
	id: string;
	action: 'run' | 'collect' | 'shutdown' | 'ready';
	ctx?: unknown;
};

export type ControlResponse = {
	id: string;
	success: boolean;
	error?: string;
};

export type ControlMessage = ControlRequest | ControlResponse;

export type Envelope = {
	channel: EnvelopeChannel;
	payload: unknown;
};

export function encodeEnvelope(channel: EnvelopeChannel, payload: unknown): string {
	return stringify({ channel, payload } satisfies Envelope);
}

export function decodeEnvelope(raw: unknown): Envelope {
	let text: string;
	if (typeof raw === 'string') {
		text = raw;
	} else if (raw instanceof ArrayBuffer) {
		text = Buffer.from(raw).toString('utf8');
	} else if (ArrayBuffer.isView(raw)) {
		text = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
	} else if (Array.isArray(raw)) {
		const buffers = raw.map((chunk) => {
			if (Buffer.isBuffer(chunk)) return chunk;
			if (typeof chunk === 'string') return Buffer.from(chunk);
			if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
			if (ArrayBuffer.isView(chunk)) {
				return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
			}
			throw new TypeError('Unsupported IPC envelope chunk type');
		});
		text = Buffer.concat(buffers).toString('utf8');
	} else if (Buffer.isBuffer(raw)) {
		text = raw.toString('utf8');
	} else {
		throw new TypeError('Invalid IPC envelope received');
	}
	const envelope = parse(text) as Envelope;
	if (typeof envelope !== 'object' || envelope == null) {
		throw new TypeError('Invalid IPC envelope received');
	}
	if (envelope.channel !== RPC_CHANNEL && envelope.channel !== CONTROL_CHANNEL) {
		throw new TypeError(`Unknown IPC channel: ${String(envelope.channel)}`);
	}
	return envelope;
}

export function isControlRequest(message: unknown): message is ControlRequest {
	return typeof message === 'object' && message != null && 'action' in message && 'id' in message;
}

export function isControlResponse(message: unknown): message is ControlResponse {
	return (
		typeof message === 'object' && message != null && 'success' in message && 'id' in message
	);
}
