/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IsLiteral } from 'type-fest';
import type { ExtractParams, Fn, OverLoadFunctions } from '../types';
import { toDispose } from './disposable';

type Subscription = (event: any, handler: Fn) => any;

/**
 * Represents an event emitter with an `off` method for removing listeners.
 */
export type Off = {
	off: Subscription;
};

/**
 * Represents an event emitter with an `on` method for registering listeners.
 */
export type On = {
	on: Subscription;
} & Off;

/**
 * Represents an event emitter with a `once` method for one-time listeners.
 */
export type Once = {
	once: Subscription;
} & Off;

type NakedEventNames<Parameters> = Parameters extends [infer E, ...unknown[]]
	? IsLiteral<E> extends true
		? E
		: never
	: never;

export type EventNames<Functions> = NakedEventNames<Parameters<OverLoadFunctions<Functions>>>;

//Leave this type as
type DistributeParams<Parameters, Event> = Parameters extends unknown
	? Parameters extends [Event, infer Handler]
		? ExtractParams<Handler> extends infer P
			? P extends any[]
				? any[] extends P
					? never
					: P
				: never
			: never
		: never
	: never;

export type EventHandlerParams<Functions, Event> = DistributeParams<
	Parameters<OverLoadFunctions<Functions>>,
	Event
>;

type UnpackArray<T extends unknown[]> = T['length'] extends 0
	? undefined
	: T['length'] extends 1
		? T[0]
		: T;

function unpackArray<T extends unknown[]>(values: T) {
	return (
		values.length === 0 ? undefined : values.length === 1 ? values[0] : values
	) as UnpackArray<T>;
}

export type OnceResult<
	EventEmitter extends Once,
	Event extends EventNames<EventEmitter['once']>,
	Rejects extends boolean,
> = Rejects extends true ? never : UnpackArray<EventHandlerParams<EventEmitter['once'], Event>>;

/**
 * Type-safe wrapper for event emitter's `once` method that preserves overload signatures.
 *
 * @param emitter - Event emitter with `once` and `off` methods
 * @param event - Event name (must match one of the emitter's overloads)
 * @param rejects - When true, the promise rejects with the handler arguments instead of resolving
 * @returns Disposable promise with the handler arguments and automatic cleanup via `off`
 *
 * @example
 * ```ts
 * type MyEmitter = {
 *   once(event: 'data', handler: (value: string) => void): void;
 *   once(event: 'error', handler: (error: Error) => void): number;
 *   off(event: string, handler: Fn): void;
 * };
 *
 * declare const emitter: MyEmitter;
 *
 * // Type-safe: 'value' is inferred as string
 * using result = handleOnce(emitter, 'data');
 * console.log((await result).toUpperCase());
 *
 * // Return type is inferred as number
 * const value = await handleOnce(emitter, 'error');
 * console.error(value.message);
 * ```
 */
export function handleOnce<
	EventEmitter extends Once,
	const Event extends EventNames<EventEmitter['once']>,
	const Rejects extends boolean = false,
>(emitter: EventEmitter, event: Event, rejects?: Rejects) {
	const { promise, resolve, reject } =
		Promise.withResolvers<OnceResult<EventEmitter, Event, Rejects>>();

	const handler: Fn = (...args: unknown[]) => {
		if (rejects) {
			reject(args.length === 1 ? args[0] : args);
			return;
		}
		resolve(unpackArray(args) as OnceResult<EventEmitter, Event, Rejects>);
	};
	emitter.once(event, handler);
	return toDispose(promise, () => emitter.off(event, handler));
}

export type OnResult<
	EventEmitter extends On,
	Event extends EventNames<EventEmitter['on']>,
> = UnpackArray<EventHandlerParams<EventEmitter['on'], Event>>;

/**
 * Type-safe wrapper for event emitter's `on` method that returns an async iterator.
 *
 * @param emitter - Event emitter with `on` and `off` methods
 * @param event - Event name (must match one of the emitter's overloads)
 * @param maxBuffer - Maximum number of events to buffer (default: 100)
 * @returns Disposable async iterator that yields handler arguments
 *
 * @example
 * ```ts
 * type MyEmitter = {
 *   on(event: 'data', handler: (value: string) => void): void;
 *   on(event: 'error', handler: (error: Error) => void): void;
 *   off(event: string, handler: Fn): void;
 * };
 *
 * declare const emitter: MyEmitter;
 *
 * // Type-safe: 'value' is inferred as string
 * using iterator = handleOn(emitter, 'data');
 * for await (const value of iterator) {
 *   console.log(value.toUpperCase());
 * }
 * ```
 */
export function handleOn<
	EventEmitter extends On,
	const Event extends EventNames<EventEmitter['on']>,
>(emitter: EventEmitter, event: Event, maxBuffer = 100) {
	const buffer: OnResult<EventEmitter, Event>[] = [];
	const pending: ((value: IteratorResult<OnResult<EventEmitter, Event>>) => void)[] = [];
	let done = false;

	const handler: Fn = (...args: unknown[]) => {
		const value = unpackArray(args) as OnResult<EventEmitter, Event>;

		// If there's a pending consumer, resolve immediately
		const resolve = pending.shift();
		if (resolve) {
			resolve({ value, done: false });
			return;
		}

		// Otherwise buffer the event (drop oldest if at capacity)
		if (buffer.length >= maxBuffer) {
			buffer.shift();
		}
		buffer.push(value);
	};

	emitter.on(event, handler);

	const dispose = () => {
		if (done) return;
		done = true;
		emitter.off(event, handler);

		// Resolve all pending consumers with done
		while (pending.length > 0) {
			const resolve = pending.shift();
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			resolve?.({ value: undefined as any, done: true });
		}
	};

	return toDispose(
		{
			async next() {
				// If already disposed, return done
				if (done) {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					return { value: undefined as any, done: true };
				}

				// If buffer has events, return the oldest one
				if (buffer.length > 0) {
					const value = buffer.shift()!;
					return { value, done: false };
				}

				// Wait for the next event
				return new Promise<IteratorResult<OnResult<EventEmitter, Event>>>((resolve) => {
					pending.push(resolve);
				});
			},

			return() {
				dispose();
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				return Promise.resolve({ value: undefined as any, done: true });
			},

			[Symbol.asyncIterator]() {
				return this;
			},
		} satisfies AsyncIterableIterator<OnResult<EventEmitter, Event>>,
		dispose
	);
}
