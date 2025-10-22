import { describe, expectTypeOf, it } from 'vitest';
import type { Fn } from '../types';
import { handleOn, handleOnce } from './handlers';

describe('handleOnce', () => {
	type TestEmitter = {
		once(event: 'stringEvent', handler: (value: string) => void): void;
		once(event: 'numberEvent', handler: (value: number) => void): void;
		once(event: 'multiParam', handler: (a: string, b: number, c: boolean) => void): void;
		once(event: 'withReturn', handler: (value: string) => void): number;
		off(event: string, handler: Fn): void;
	};

	const emitter = null as unknown as TestEmitter;

	it('should accept valid event names', () => {
		expectTypeOf(handleOnce(emitter, 'stringEvent', () => {})).toHaveProperty('result');

		expectTypeOf(handleOnce(emitter, 'numberEvent', () => {})).toHaveProperty('result');

		expectTypeOf(handleOnce(emitter, 'multiParam', () => {})).toHaveProperty('result');

		expectTypeOf(handleOnce(emitter, 'withReturn', () => {})).toHaveProperty('result');
	});

	it('should reject invalid event names', () => {
		// @ts-expect-error - 'invalidEvent' is not a valid event name
		handleOnce(emitter, 'invalidEvent', () => {});
	});

	it('should infer correct handler parameter types', () => {
		handleOnce(emitter, 'stringEvent', (value) => {
			expectTypeOf(value).toEqualTypeOf<string>();
		});

		handleOnce(emitter, 'numberEvent', (value) => {
			expectTypeOf(value).toEqualTypeOf<number>();
		});

		handleOnce(emitter, 'multiParam', (a, b, c) => {
			expectTypeOf(a).toEqualTypeOf<string>();
			expectTypeOf(b).toEqualTypeOf<number>();
			expectTypeOf(c).toEqualTypeOf<boolean>();
		});
	});

	it('should reject handlers with wrong parameter types', () => {
		// @ts-expect-error - handler expects string, not number
		handleOnce(emitter, 'stringEvent', (value: number) => {});

		// @ts-expect-error - handler expects number, not string
		handleOnce(emitter, 'numberEvent', (value: string) => {});

		// @ts-expect-error - wrong parameter types
		handleOnce(emitter, 'multiParam', (a: number, b: string, c: boolean) => {});
	});

	it('should return correct return type', () => {
		const resultNumber = handleOnce(emitter, 'withReturn', () => {});
		expectTypeOf(resultNumber.result).toEqualTypeOf<number>();
	});

	it('should work with emitters that have single overload', () => {
		type SingleOverloadEmitter = {
			once(event: 'onlyEvent', handler: (value: string) => void): void;
			off(event: string, handler: Fn): void;
		};

		const singleEmitter = null as unknown as SingleOverloadEmitter;

		handleOnce(singleEmitter, 'onlyEvent', (value) => {
			expectTypeOf(value).toEqualTypeOf<string>();
		});

		// @ts-expect-error - invalid event name
		handleOnce(singleEmitter, 'otherEvent', () => {});
	});

	it('should work with emitters that have two overloads', () => {
		type TwoOverloadEmitter = {
			once(event: 'first', handler: (value: string) => void): void;
			once(event: 'second', handler: (value: number) => void): void;
			off(event: string, handler: Fn): void;
		};

		const twoEmitter = null as unknown as TwoOverloadEmitter;

		handleOnce(twoEmitter, 'first', (value) => {
			expectTypeOf(value).toEqualTypeOf<string>();
		});

		handleOnce(twoEmitter, 'second', (value) => {
			expectTypeOf(value).toEqualTypeOf<number>();
		});
	});
});

describe('handleOn', () => {
	type TestEmitter = {
		on(event: 'stringEvent', handler: (value: string) => void): void;
		on(event: 'numberEvent', handler: (value: number) => void): void;
		on(event: 'multiParam', handler: (a: string, b: number, c: boolean) => void): void;
		on(event: 'withReturn', handler: (value: string) => void): number;
		off(event: string, handler: Fn): void;
	};

	const emitter = null as unknown as TestEmitter;

	it('should accept valid event names', () => {
		expectTypeOf(handleOn(emitter, 'stringEvent', () => {})).toHaveProperty('result');

		expectTypeOf(handleOn(emitter, 'numberEvent', () => {})).toHaveProperty('result');

		expectTypeOf(handleOn(emitter, 'multiParam', () => {})).toHaveProperty('result');

		expectTypeOf(handleOn(emitter, 'withReturn', () => {})).toHaveProperty('result');
	});

	it('should reject invalid event names', () => {
		// @ts-expect-error - 'invalidEvent' is not a valid event name
		handleOn(emitter, 'invalidEvent', () => {});
	});

	it('should infer correct handler parameter types', () => {
		handleOn(emitter, 'stringEvent', (value) => {
			expectTypeOf(value).toEqualTypeOf<string>();
		});

		handleOn(emitter, 'numberEvent', (value) => {
			expectTypeOf(value).toEqualTypeOf<number>();
		});

		handleOn(emitter, 'multiParam', (a, b, c) => {
			expectTypeOf(a).toEqualTypeOf<string>();
			expectTypeOf(b).toEqualTypeOf<number>();
			expectTypeOf(c).toEqualTypeOf<boolean>();
		});
	});

	it('should reject handlers with wrong parameter types', () => {
		// @ts-expect-error - handler expects string, not number
		handleOn(emitter, 'stringEvent', (value: number) => {});

		// @ts-expect-error - handler expects number, not string
		handleOn(emitter, 'numberEvent', (value: string) => {});

		// @ts-expect-error - wrong parameter types
		handleOn(emitter, 'multiParam', (a: number, b: string, c: boolean) => {});
	});

	it('should return correct return type', () => {
		const resultNumber = handleOn(emitter, 'withReturn', () => {});
		expectTypeOf(resultNumber.result).toEqualTypeOf<number>();
	});

	it('should work with emitters that have single overload', () => {
		type SingleOverloadEmitter = {
			on(event: 'onlyEvent', handler: (value: string) => void): void;
			off(event: string, handler: Fn): void;
		};

		const singleEmitter = null as unknown as SingleOverloadEmitter;

		handleOn(singleEmitter, 'onlyEvent', (value) => {
			expectTypeOf(value).toEqualTypeOf<string>();
		});

		// @ts-expect-error - invalid event name
		handleOn(singleEmitter, 'otherEvent', () => {});
	});

	it('should work with emitters that have two overloads', () => {
		type TwoOverloadEmitter = {
			on(event: 'first', handler: (value: string) => void): void;
			on(event: 'second', handler: (value: number) => void): void;
			off(event: string, handler: Fn): void;
		};

		const twoEmitter = null as unknown as TwoOverloadEmitter;

		handleOn(twoEmitter, 'first', (value) => {
			expectTypeOf(value).toEqualTypeOf<string>();
		});

		handleOn(twoEmitter, 'second', (value) => {
			expectTypeOf(value).toEqualTypeOf<number>();
		});
	});
});
