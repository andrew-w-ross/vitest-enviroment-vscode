import { describe, expect, it, vi } from 'vitest';
import { toAsyncDispose, toDispose } from './disposable.js';

describe('toDispose', () => {
	it('should call dispose function when Symbol.dispose is invoked', () => {
		const disposeFn = vi.fn();
		const resource = { handle: 123 };

		{
			using disposable = toDispose(resource, disposeFn);
			expect(disposable.handle).toBe(123);
			expect(disposeFn).not.toHaveBeenCalled();
		}

		expect(disposeFn).toHaveBeenCalledOnce();
		expect(disposeFn).toHaveBeenCalledWith(resource);
	});

	it('should only dispose once even if called multiple times', () => {
		const disposeFn = vi.fn();
		const resource = { handle: 456 };

		const disposable = toDispose(resource, disposeFn);
		disposable[Symbol.dispose]();
		disposable[Symbol.dispose]();
		disposable[Symbol.dispose]();

		expect(disposeFn).toHaveBeenCalledOnce();
	});

	it('should work with wrapped non-extensible values', () => {
		class Connection {
			closed = false;
			close() {
				this.closed = true;
			}
		}

		const connection = new Connection();
		const disposeFn = vi.fn((wrapped: { conn: Connection }) => {
			wrapped.conn.close();
		});

		{
			using disposable = toDispose({ conn: connection }, disposeFn);
			expect(disposable.conn).toBe(connection);
			expect(connection.closed).toBe(false);
		}

		expect(disposeFn).toHaveBeenCalledOnce();
		expect(connection.closed).toBe(true);
	});

	it('should preserve original object properties', () => {
		const resource = { handle: 789, name: 'test', getValue: () => 42 };
		const disposeFn = vi.fn();

		const disposable = toDispose(resource, disposeFn);

		expect(disposable.handle).toBe(789);
		expect(disposable.name).toBe('test');
		expect(disposable.getValue()).toBe(42);
	});
});

describe('toAsyncDispose', () => {
	it('should call async dispose function when Symbol.asyncDispose is invoked', async () => {
		const disposeFn = vi.fn(async (resource: { stream: string }) => {
			await Promise.resolve();
			return resource;
		});
		const resource = { stream: 'stream-handle' };

		{
			await using disposable = toAsyncDispose(resource, disposeFn);
			expect(disposable.stream).toBe('stream-handle');
			expect(disposeFn).not.toHaveBeenCalled();
		}

		expect(disposeFn).toHaveBeenCalledOnce();
		expect(disposeFn).toHaveBeenCalledWith(resource);
	});

	it('should only dispose once even if called multiple times', async () => {
		const disposeFn = vi.fn(async (resource: { stream: string }) => {
			await Promise.resolve();
			return resource;
		});
		const resource = { stream: 'stream-handle' };

		const disposable = toAsyncDispose(resource, disposeFn);
		await Promise.all([
			disposable[Symbol.asyncDispose](),
			disposable[Symbol.asyncDispose](),
			disposable[Symbol.asyncDispose](),
		]);

		expect(disposeFn).toHaveBeenCalledOnce();
	});

	it('should work with wrapped non-extensible values', async () => {
		class DatabaseConnection {
			connected = true;
			async close() {
				await new Promise((resolve) => setTimeout(resolve, 10));
				this.connected = false;
			}
		}

		const database = new DatabaseConnection();
		const disposeFn = vi.fn(async (wrapped: { db: DatabaseConnection }) => {
			await wrapped.db.close();
			return wrapped;
		});

		{
			await using disposable = toAsyncDispose({ db: database }, disposeFn);
			expect(disposable.db).toBe(database);
			expect(database.connected).toBe(true);
		}

		expect(disposeFn).toHaveBeenCalledOnce();
		expect(database.connected).toBe(false);
	});

	it('should preserve original object properties', async () => {
		const resource = { stream: 'test-stream', name: 'test', getValue: () => 42 };
		const disposeFn = vi.fn(async (r: typeof resource) => {
			await Promise.resolve();
			return r;
		});

		const disposable = toAsyncDispose(resource, disposeFn);

		expect(disposable.stream).toBe('test-stream');
		expect(disposable.name).toBe('test');
		expect(disposable.getValue()).toBe(42);

		await disposable[Symbol.asyncDispose]();
	});

	it('should handle async disposal errors gracefully', async () => {
		const error = new Error('Disposal failed');
		const disposeFn = vi.fn(async () => {
			await Promise.resolve();
			throw error;
		});
		const resource = { stream: 'stream' };

		const disposable = toAsyncDispose(resource, disposeFn);

		await expect(disposable[Symbol.asyncDispose]()).rejects.toThrow('Disposal failed');
	});

	it('should reuse the same disposal promise for concurrent calls', async () => {
		let callCount = 0;
		type ResourceType = { stream: string };
		const disposeFn = vi.fn(async (resource: ResourceType) => {
			callCount++;
			await new Promise<void>((resolve) => setTimeout(resolve, 50));
			return resource;
		});
		const resource: ResourceType = { stream: 'stream' };

		const disposable = toAsyncDispose(resource, disposeFn);

		// Start multiple concurrent disposals
		const promises = [
			disposable[Symbol.asyncDispose](),
			disposable[Symbol.asyncDispose](),
			disposable[Symbol.asyncDispose](),
		];

		await Promise.all(promises);

		// Should only call the dispose function once
		expect(callCount).toBe(1);
		expect(disposeFn).toHaveBeenCalledOnce();
	});
});
