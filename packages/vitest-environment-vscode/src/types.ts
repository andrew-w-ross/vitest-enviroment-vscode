/* eslint-disable @typescript-eslint/no-explicit-any */
//Probally should share this file

/**
 * Describes just any function
 */
export type Fn = (...args: any) => any;

/**
 * Helper to unwrap function types for tail-recursion optimization
 */
type UnwrapFunction<T> = T extends (...args: infer Args) => unknown ? Args : never;

/**
 * Extracts all overload parameter signatures from a function type as a union of tuples.
 * Uses tail-recursion to support unlimited overloads.
 */
export type OverloadedParameters<T, Acc = never> = T extends {
	(...args: infer Head): unknown;
	(...args: infer Tail): unknown;
}
	? Tail extends Head
		? Acc | Head
		: OverloadedParameters<(...args: Tail) => unknown, Acc | Head>
	: Acc | UnwrapFunction<T>;

/**
 * Extracts event names from overloaded parameter tuples.
 */
export type EventNames<T> = T extends [infer Event, unknown] ? Event : never;
