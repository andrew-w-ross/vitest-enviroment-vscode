export type RpcListener = (payload: unknown) => void;

export type WorkerTransport = {
	post(message: unknown): void;
	subscribe(listener: RpcListener): () => void;
};

let transport: WorkerTransport | null = null;

export function setTransport(next: WorkerTransport): void {
	transport = next;
}

export function getTransport(): WorkerTransport {
	if (!transport) {
		throw new Error('VS Code worker transport is not initialized.');
	}
	return transport;
}
