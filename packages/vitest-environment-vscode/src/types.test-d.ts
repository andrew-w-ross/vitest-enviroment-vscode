import { describe, expectTypeOf, it } from 'vitest';
import type { EventNames, OverloadedParameters } from './types';

describe('OverloadedParameters', () => {
	it('should extract parameters from a single overload', () => {
		type SingleOverload = (a: string) => void;

		type Result = OverloadedParameters<SingleOverload>;

		expectTypeOf<Result>().toEqualTypeOf<[a: string]>();
	});

	it('should extract parameters from two overloads', () => {
		type TwoOverloads = {
			(a: string): void;
			(b: number): void;
		};

		type Result = OverloadedParameters<TwoOverloads>;

		expectTypeOf<Result>().toEqualTypeOf<[a: string] | [b: number]>();
	});

	it('should extract parameters from three overloads', () => {
		type ThreeOverloads = {
			(a: string): void;
			(b: number): void;
			(c: boolean): void;
		};

		type Result = OverloadedParameters<ThreeOverloads>;

		expectTypeOf<Result>().toEqualTypeOf<[a: string] | [b: number] | [c: boolean]>();
	});

	it('should extract parameters from four overloads', () => {
		type FourOverloads = {
			(a: string): void;
			(b: number): void;
			(c: boolean): void;
			(d: symbol): void;
		};

		type Result = OverloadedParameters<FourOverloads>;

		expectTypeOf<Result>().toEqualTypeOf<
			[a: string] | [b: number] | [c: boolean] | [d: symbol]
		>();
	});

	it('should extract parameters from five overloads', () => {
		type FiveOverloads = {
			(a: string): void;
			(b: number): void;
			(c: boolean): void;
			(d: symbol): void;
			(e: bigint): void;
		};

		type Result = OverloadedParameters<FiveOverloads>;

		expectTypeOf<Result>().toEqualTypeOf<
			[a: string] | [b: number] | [c: boolean] | [d: symbol] | [e: bigint]
		>();
	});

	it('should extract parameters with multiple arguments', () => {
		type MultiArgOverloads = {
			(name: string, age: number): void;
			(id: number): void;
		};

		type Result = OverloadedParameters<MultiArgOverloads>;

		expectTypeOf<Result>().toEqualTypeOf<[name: string, age: number] | [id: number]>();
	});

	it('should extract parameters from complex overloads', () => {
		type ComplexOverloads = {
			(event: 'data', handler: (value: string) => void): void;
			(event: 'error', handler: (error: Error) => void): number;
			(event: 'close'): boolean;
		};

		type Result = OverloadedParameters<ComplexOverloads>;

		expectTypeOf<Result>().toEqualTypeOf<
			| [event: 'data', handler: (value: string) => void]
			| [event: 'error', handler: (error: Error) => void]
			| [event: 'close']
		>();
	});

	it('should handle overloads with optional parameters', () => {
		type OptionalOverloads = {
			(a: string, b?: number): void;
			(a: number): void;
		};

		type Result = OverloadedParameters<OptionalOverloads>;

		expectTypeOf<Result>().toEqualTypeOf<[a: string, b?: number] | [a: number]>();
	});

	it('should handle overloads with rest parameters', () => {
		type RestOverloads = {
			(a: string, ...rest: number[]): void;
			(a: boolean): void;
		};

		type Result = OverloadedParameters<RestOverloads>;

		expectTypeOf<Result>().toEqualTypeOf<[a: string, ...rest: number[]] | [a: boolean]>();
	});
});

describe('EventNames', () => {
	it('should extract event name from tuple', () => {
		type EventTuple = ['data', (value: string) => void];

		type Result = EventNames<EventTuple>;

		expectTypeOf<Result>().toEqualTypeOf<'data'>();
	});

	it('should extract event names from union of tuples', () => {
		type EventTuples = ['data', (value: string) => void] | ['error', (error: Error) => void];

		type Result = EventNames<EventTuples>;

		expectTypeOf<Result>().toEqualTypeOf<'data' | 'error'>();
	});

	it('should extract string literal event names', () => {
		type EventTuples =
			| ['open', () => void]
			| ['close', () => void]
			| ['message', (data: unknown) => void];

		type Result = EventNames<EventTuples>;

		expectTypeOf<Result>().toEqualTypeOf<'open' | 'close' | 'message'>();
	});

	it('should return never for non-tuple types', () => {
		type NotATuple = string;

		type Result = EventNames<NotATuple>;

		expectTypeOf<Result>().toEqualTypeOf<never>();
	});

	it('should extract number event names', () => {
		type NumberEvents = [1, () => void] | [2, () => void];

		type Result = EventNames<NumberEvents>;

		expectTypeOf<Result>().toEqualTypeOf<1 | 2>();
	});

	it('should work with OverloadedParameters', () => {
		type MyEmitter = {
			(event: 'data', handler: (value: string) => void): void;
			(event: 'error', handler: (error: Error) => void): void;
			(event: 'close'): void;
		};

		type Params = OverloadedParameters<MyEmitter>;
		type Events = EventNames<Params>;

		expectTypeOf<Events>().toEqualTypeOf<'data' | 'error' | 'close'>();
	});
});
