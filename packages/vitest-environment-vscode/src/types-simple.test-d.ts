import { describe, expectTypeOf, it } from 'vitest';
import type { OverloadedParameters } from './types';

describe('OverloadedParameters - simple test', () => {
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

		// Debug: what does TypeScript actually infer?
		type _Debug = Result;

		expectTypeOf<Result>().toEqualTypeOf<[a: string] | [b: number] | [c: boolean]>();
	});
});
