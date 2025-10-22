import type { EventNames, Fn, OverloadedParameters } from '../types';
import { toDispose } from './disposable';

/**
 * Represents an event emitter with an `off` method for removing listeners.
 */
export type Off = {
	off(event: string, handler: Fn): void;
};

/**
 * Represents an event emitter with an `on` method for registering listeners.
 */
export type On = {
	on(event: string, handler: Fn): void;
};

/**
 * Represents an event emitter with a `once` method for one-time listeners.
 */
export type Once = {
	once(event: string, handler: Fn): void;
};

/**
 * Extracts the handler function type for a specific event from overloaded parameters.
 */
type HandlerForEvent<Overloads, Event> =
	Extract<Overloads, [Event, unknown]> extends [Event, infer Handler] ? Handler : never;

/**
 * Extracts the return type for a specific event and handler combination.
 */
type ReturnTypeForEvent<Method, Event, Handler> = Method extends (
	event: Event,
	handler: Handler
) => infer R
	? R
	: never;

/**
 * Type-safe wrapper for event emitter's `once` method that preserves overload signatures.
 *
 * @param emitter - Event emitter with `once` and `off` methods
 * @param event - Event name (must match one of the emitter's overloads)
 * @param handler - Event handler function (type is inferred from the event name)
 * @returns Disposable object with the result and automatic cleanup via `off` on disposal
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
 * using listener = handleOnce(emitter, 'data', (value) => {
 *   console.log(value.toUpperCase());
 * });
 *
 * // Return type is inferred as number
 * const { result } = handleOnce(emitter, 'error', (error) => {
 *   console.error(error.message);
 * });
 * ```
 */
export function handleOnce<
	E extends Off & Once,
	Overloads extends OverloadedParameters<E['once']>,
	Event extends EventNames<Overloads>,
	Handler extends HandlerForEvent<Overloads, Event>,
>(emitter: E, event: Event, handler: Handler) {
	const result = emitter.once(event, handler as unknown as Fn) as ReturnTypeForEvent<
		E['once'],
		Event,
		Handler
	>;

	return toDispose({ result }, () => emitter.off(event, handler as unknown as Fn));
}

/**
 * Type-safe wrapper for event emitter's `on` method that preserves overload signatures.
 *
 * @param emitter - Event emitter with `on` and `off` methods
 * @param event - Event name (must match one of the emitter's overloads)
 * @param handler - Event handler function (type is inferred from the event name)
 * @returns Disposable object with the result and automatic cleanup via `off` on disposal
 *
 * @example
 * ```ts
 * type MyEmitter = {
 *   on(event: 'data', handler: (value: string) => void): void;
 *   on(event: 'error', handler: (error: Error) => void): number;
 *   off(event: string, handler: Fn): void;
 * };
 *
 * declare const emitter: MyEmitter;
 *
 * // Type-safe: 'value' is inferred as string
 * using listener = handleOn(emitter, 'data', (value) => {
 *   console.log(value.toUpperCase());
 * });
 *
 * // Return type is inferred as number
 * const { result } = handleOn(emitter, 'error', (error) => {
 *   console.error(error.message);
 * });
 * ```
 */
export function handleOn<
	E extends Off & On,
	Overloads extends OverloadedParameters<E['on']>,
	Event extends EventNames<Overloads>,
	Handler extends HandlerForEvent<Overloads, Event>,
>(emitter: E, event: Event, handler: Handler) {
	const result = emitter.on(event, handler as unknown as Fn) as ReturnTypeForEvent<
		E['on'],
		Event,
		Handler
	>;

	return toDispose({ result }, () => emitter.off(event, handler as unknown as Fn));
}
