import { describe, expectTypeOf, it } from 'vitest';
import type { Fn } from '../types';
import { handleOn, handleOnce } from './handlers';

describe('handleOnce', () => {
	type TestEmitter = {
		once(event: 'stringEvent', handler: (value: string) => void): void;
		once(event: 'tupleEvent', handler: (value: number, flag: boolean) => void): void;
		once(event: 'booleanEvent', handler: (boolean: boolean) => void): void;
		once(event: 'voidEvent', handler: () => void): void;
		off(event: string, handler: Fn): void;
	};

	const emitter = null as unknown as TestEmitter;

	it('should resolve with the inferred handler arguments', () => {
		expectTypeOf(handleOnce(emitter, 'stringEvent')).resolves.toEqualTypeOf<string>();
		expectTypeOf(handleOnce(emitter, 'tupleEvent')).resolves.toEqualTypeOf<[number, boolean]>();
		expectTypeOf(handleOnce(emitter, 'booleanEvent')).resolves.toEqualTypeOf<boolean>();
		expectTypeOf(handleOnce(emitter, 'voidEvent')).resolves.toBeUndefined();
	});

	it('should reject invalid event names', () => {
		// @ts-expect-error - 'invalidEvent' is not a valid event name
		void handleOnce(emitter, 'invalidEvent');
	});
});

describe('handleOn', () => {
	type TestEmitter = {
		on(event: 'stringEvent', handler: (value: string) => void): void;
		on(event: 'tupleEvent', handler: (value: number, flag: boolean) => void): void;
		on(event: 'numberEvent', handler: (value: number) => void): void;
		on(event: 'voidEvent', handler: () => void): void;
		off(event: string, handler: Fn): void;
	};

	const emitter = null as unknown as TestEmitter;

	it('should return an async iterator with proper type', () => {
		const stringIterator = handleOn(emitter, 'stringEvent');
		expectTypeOf(stringIterator).toHaveProperty('next');
		expectTypeOf(stringIterator).toHaveProperty(Symbol.dispose);
		expectTypeOf(stringIterator).toHaveProperty(Symbol.asyncIterator);
	});

	it('should infer correct value types from event handlers', () => {
		const stringIterator = handleOn(emitter, 'stringEvent');
		const numberIterator = handleOn(emitter, 'numberEvent');
		const tupleIterator = handleOn(emitter, 'tupleEvent');
		const voidIterator = handleOn(emitter, 'voidEvent');

		// Verify the iterator yields the correct types by checking the resolved value
		expectTypeOf(stringIterator).toExtend<AsyncIterableIterator<string>>();
		expectTypeOf(numberIterator).toExtend<AsyncIterableIterator<number>>();
		expectTypeOf(tupleIterator).toExtend<AsyncIterableIterator<[number, boolean]>>();
		expectTypeOf(voidIterator).toExtend<AsyncIterableIterator<undefined>>();
	});

	it('should work with using declaration', () => {
		using iterator = handleOn(emitter, 'numberEvent');
		expectTypeOf(iterator).toHaveProperty(Symbol.dispose);
	});

	it('should reject invalid event names', () => {
		// @ts-expect-error - 'invalidEvent' is not a valid event name
		void handleOn(emitter, 'invalidEvent');
	});
});
