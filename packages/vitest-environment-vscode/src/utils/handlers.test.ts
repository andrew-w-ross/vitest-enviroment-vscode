import { describe, expect, it, vi } from 'vitest';
import type { Fn } from '../types';
import { handleOn, handleOnce, type Off, type On, type Once } from './handlers';

describe('handleOnce', () => {
	type EventMap = {
		stringEvent: (value: string) => void;
		tupleEvent: (value: number, flag: boolean) => void;
		voidEvent: () => void;
	};

	type TestEmitter = Off &
		Once & {
			once(event: 'stringEvent', handler: EventMap['stringEvent']): void;
			once(event: 'tupleEvent', handler: EventMap['tupleEvent']): void;
			once(event: 'voidEvent', handler: EventMap['voidEvent']): void;
		};

	const createEmitter = () => {
		const handlers = new Map<string, Fn>();
		const off = vi.fn<(event: string, handler: Fn) => void>();

		const emitter: TestEmitter = {
			once(event: string, handler: Fn) {
				handlers.set(event, handler);
			},
			off(event: string, handler: Fn) {
				off(event, handler);
				handlers.delete(event);
			},
		};

		return { emitter, handlers, off };
	};

	it('resolves with the single handler argument', async () => {
		const { emitter, handlers, off } = createEmitter();
		const disposable = handleOnce(emitter, 'stringEvent');
		const handler = handlers.get('stringEvent') as (value: string) => void;
		expect(handler).toBeTypeOf('function');

		handler('test-value');

		await expect(disposable).resolves.toBe('test-value');

		disposable[Symbol.dispose]();
		expect(off).toHaveBeenCalledWith('stringEvent', handler);
	});

	it('resolves with a tuple when handler has multiple parameters', async () => {
		const { emitter, handlers } = createEmitter();
		const disposable = handleOnce(emitter, 'tupleEvent');
		const handler = handlers.get('tupleEvent') as (value: number, flag: boolean) => void;
		expect(handler).toBeTypeOf('function');

		handler(42, true);

		await expect(disposable).resolves.toEqual([42, true]);
	});

	it('resolves to undefined when handler receives no arguments', async () => {
		const { emitter, handlers } = createEmitter();
		const disposable = handleOnce(emitter, 'voidEvent');
		const handler = handlers.get('voidEvent') as () => void;
		expect(handler).toBeTypeOf('function');

		handler();

		await expect(disposable).resolves.toBeUndefined();
	});

	it('removes the listener when disposed before being resolved', () => {
		const { emitter, handlers, off } = createEmitter();
		const disposable = handleOnce(emitter, 'stringEvent');
		const handler = handlers.get('stringEvent') as Fn;
		expect(handler).toBeTypeOf('function');

		disposable[Symbol.dispose]();
		expect(off).toHaveBeenCalledWith('stringEvent', handler);
	});

	it('rejects with single argument when rejects flag is true', async () => {
		const { emitter, handlers, off } = createEmitter();
		const disposable = handleOnce(emitter, 'stringEvent', true);
		const handler = handlers.get('stringEvent') as (value: string) => void;
		expect(handler).toBeTypeOf('function');

		handler('error-value');

		await expect(disposable).rejects.toBe('error-value');

		disposable[Symbol.dispose]();
		expect(off).toHaveBeenCalledWith('stringEvent', handler);
	});

	it('rejects with tuple when rejects flag is true and multiple arguments', async () => {
		const { emitter, handlers } = createEmitter();
		const disposable = handleOnce(emitter, 'tupleEvent', true);
		const handler = handlers.get('tupleEvent') as (value: number, flag: boolean) => void;
		expect(handler).toBeTypeOf('function');

		handler(99, false);

		await expect(disposable).rejects.toEqual([99, false]);
	});

	it('can be used with using declaration for automatic disposal', async () => {
		const { emitter, handlers, off } = createEmitter();
		let handler: Fn;

		{
			using disposable = handleOnce(emitter, 'stringEvent');
			handler = handlers.get('stringEvent') as (value: string) => void;

			handler('auto-dispose');
			await expect(disposable).resolves.toBe('auto-dispose');
		}

		// Should have been automatically disposed
		expect(off).toHaveBeenCalledWith('stringEvent', handler);
	});
});

describe('handleOn', () => {
	type EventMap = {
		stringEvent: (value: string) => void;
		numberEvent: (value: number) => void;
		tupleEvent: (x: number, y: number) => void;
	};

	type TestEmitter = Off &
		On & {
			on(event: 'stringEvent', handler: EventMap['stringEvent']): void;
			on(event: 'numberEvent', handler: EventMap['numberEvent']): void;
			on(event: 'tupleEvent', handler: EventMap['tupleEvent']): void;
		};

	const createEmitter = () => {
		const handlers = new Map<string, Fn[]>();
		const off = vi.fn<(event: string, handler: Fn) => void>();

		const emitter: TestEmitter = {
			on(event: string, handler: Fn) {
				if (!handlers.has(event)) {
					handlers.set(event, []);
				}
				handlers.get(event)!.push(handler);
			},
			off(event: string, handler: Fn) {
				off(event, handler);
				const eventHandlers = handlers.get(event);
				if (eventHandlers) {
					const index = eventHandlers.indexOf(handler);
					if (index !== -1) {
						eventHandlers.splice(index, 1);
					}
				}
			},
		};

		const emit = (event: string, ...args: unknown[]) => {
			const eventHandlers = handlers.get(event);
			if (eventHandlers) {
				for (const handler of eventHandlers) {
					handler(...args);
				}
			}
		};

		return { emitter, emit, off };
	};

	it('yields events as they are emitted', async () => {
		const { emitter, emit } = createEmitter();
		const iterator = handleOn(emitter, 'stringEvent');

		emit('stringEvent', 'first');
		emit('stringEvent', 'second');

		const result1 = await iterator.next();
		expect(result1).toEqual({ value: 'first', done: false });

		const result2 = await iterator.next();
		expect(result2).toEqual({ value: 'second', done: false });

		iterator[Symbol.dispose]();
	});

	it('buffers events when no consumer is waiting', async () => {
		const { emitter, emit } = createEmitter();
		const iterator = handleOn(emitter, 'numberEvent');

		// Emit multiple events before consuming
		emit('numberEvent', 1);
		emit('numberEvent', 2);
		emit('numberEvent', 3);

		// Should get all buffered events in order
		expect(await iterator.next()).toEqual({ value: 1, done: false });
		expect(await iterator.next()).toEqual({ value: 2, done: false });
		expect(await iterator.next()).toEqual({ value: 3, done: false });

		iterator[Symbol.dispose]();
	});

	it('drops oldest events when buffer exceeds maxBuffer', async () => {
		const { emitter, emit } = createEmitter();
		const iterator = handleOn(emitter, 'numberEvent', 3);

		// Emit more events than buffer size
		emit('numberEvent', 1);
		emit('numberEvent', 2);
		emit('numberEvent', 3);
		emit('numberEvent', 4); // This should drop 1

		// Should only get the last 3 events
		expect(await iterator.next()).toEqual({ value: 2, done: false });
		expect(await iterator.next()).toEqual({ value: 3, done: false });
		expect(await iterator.next()).toEqual({ value: 4, done: false });

		iterator[Symbol.dispose]();
	});

	it('yields tuples for handlers with multiple parameters', async () => {
		const { emitter, emit } = createEmitter();
		const iterator = handleOn(emitter, 'tupleEvent');

		emit('tupleEvent', 10, 20);

		const result = await iterator.next();
		expect(result).toEqual({ value: [10, 20], done: false });

		iterator[Symbol.dispose]();
	});

	it('removes listener when disposed', () => {
		const { emitter, off } = createEmitter();
		const iterator = handleOn(emitter, 'stringEvent');

		iterator[Symbol.dispose]();

		// Should have called off with the handler
		expect(off).toHaveBeenCalledTimes(1);
		expect(off).toHaveBeenCalledWith('stringEvent', expect.any(Function));
	});

	it('returns done after disposal', async () => {
		const { emitter, emit } = createEmitter();
		const iterator = handleOn(emitter, 'stringEvent');

		emit('stringEvent', 'before-dispose');
		iterator[Symbol.dispose]();

		// Next call should return done
		const result = await iterator.next();
		expect(result.done).toBe(true);
	});

	it('resolves pending consumers with done on disposal', async () => {
		const { emitter } = createEmitter();
		const iterator = handleOn(emitter, 'stringEvent');

		// Start waiting for an event
		const nextPromise = iterator.next();

		// Dispose before emitting
		iterator[Symbol.dispose]();

		// Should resolve with done
		const result = await nextPromise;
		expect(result.done).toBe(true);
	});

	it('can be used with for await...of loop', async () => {
		const { emitter, emit } = createEmitter();
		const iterator = handleOn(emitter, 'numberEvent');

		// Emit some events
		emit('numberEvent', 1);
		emit('numberEvent', 2);
		emit('numberEvent', 3);

		const results: number[] = [];
		let count = 0;

		for await (const value of iterator) {
			results.push(value);
			count++;
			if (count === 3) {
				break; // Exit the loop
			}
		}

		expect(results).toEqual([1, 2, 3]);
	});

	it('can be used with using declaration for automatic disposal', async () => {
		const { emitter, emit, off } = createEmitter();

		{
			using iterator = handleOn(emitter, 'stringEvent');
			emit('stringEvent', 'test' as never);

			const result = await iterator.next();
			expect(result.value).toBe('test');
		}

		// Should have been automatically disposed
		expect(off).toHaveBeenCalledTimes(1);
	});

	it('handles rapid emission and consumption', async () => {
		const { emitter, emit } = createEmitter();
		const iterator = handleOn(emitter, 'numberEvent');

		// Interleave emissions and consumptions
		emit('numberEvent', 1);
		const r1 = await iterator.next();
		expect(r1.value).toBe(1);

		emit('numberEvent', 2);
		emit('numberEvent', 3);
		const r2 = await iterator.next();
		const r3 = await iterator.next();
		expect(r2.value).toBe(2);
		expect(r3.value).toBe(3);

		iterator[Symbol.dispose]();
	});
});
