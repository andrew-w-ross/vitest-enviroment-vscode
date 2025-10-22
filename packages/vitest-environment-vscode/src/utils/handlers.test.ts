import { describe, expect, it, vi } from 'vitest';
import type { Fn } from '../types';
import { handleOn, handleOnce } from './handlers';

describe('handleOnce', () => {
	type TestEmitter = {
		once(event: 'testEvent', handler: (value: string) => void): void;
		once(event: 'withReturn', handler: (value: number) => void): number;
		off(event: string, handler: Fn): void;
	};

	it('should call emitter.once with correct arguments', () => {
		const mockOnce = vi.fn();
		const mockOff = vi.fn();
		const emitter: TestEmitter = {
			once: mockOnce,
			off: mockOff,
		};

		const handler = (value: string) => {};

		handleOnce(emitter, 'testEvent', handler);

		expect(mockOnce).toHaveBeenCalledWith('testEvent', handler);
	});

	it('should call emitter.off on disposal', () => {
		const mockOnce = vi.fn();
		const mockOff = vi.fn();
		const emitter: TestEmitter = {
			once: mockOnce,
			off: mockOff,
		};

		const handler = (value: string) => {};

		{
			using disposable = handleOnce(emitter, 'testEvent', handler);
		}

		expect(mockOff).toHaveBeenCalledWith('testEvent', handler);
	});

	it('should return result from emitter.once', () => {
		const mockOnce = vi.fn().mockReturnValue(42);
		const mockOff = vi.fn();
		const emitter: TestEmitter = {
			once: mockOnce,
			off: mockOff,
		};

		const handler = (value: number) => {};

		const disposable = handleOnce(emitter, 'withReturn', handler);

		expect(disposable.result).toBe(42);
	});

	it('should allow manual disposal', () => {
		const mockOnce = vi.fn();
		const mockOff = vi.fn();
		const emitter: TestEmitter = {
			once: mockOnce,
			off: mockOff,
		};

		const handler = (value: string) => {};

		const disposable = handleOnce(emitter, 'testEvent', handler);

		expect(mockOff).not.toHaveBeenCalled();

		disposable[Symbol.dispose]();

		expect(mockOff).toHaveBeenCalledWith('testEvent', handler);
	});
});

describe('handleOn', () => {
	type TestEmitter = {
		on(event: 'testEvent', handler: (value: string) => void): void;
		on(event: 'withReturn', handler: (value: number) => void): number;
		off(event: string, handler: Fn): void;
	};

	it('should call emitter.on with correct arguments', () => {
		const mockOn = vi.fn();
		const mockOff = vi.fn();
		const emitter: TestEmitter = {
			on: mockOn,
			off: mockOff,
		};

		const handler = (value: string) => {};

		handleOn(emitter, 'testEvent', handler);

		expect(mockOn).toHaveBeenCalledWith('testEvent', handler);
	});

	it('should call emitter.off on disposal', () => {
		const mockOn = vi.fn();
		const mockOff = vi.fn();
		const emitter: TestEmitter = {
			on: mockOn,
			off: mockOff,
		};

		const handler = (value: string) => {};

		{
			using disposable = handleOn(emitter, 'testEvent', handler);
		}

		expect(mockOff).toHaveBeenCalledWith('testEvent', handler);
	});

	it('should return result from emitter.on', () => {
		const mockOn = vi.fn().mockReturnValue(42);
		const mockOff = vi.fn();
		const emitter: TestEmitter = {
			on: mockOn,
			off: mockOff,
		};

		const handler = (value: number) => {};

		const disposable = handleOn(emitter, 'withReturn', handler);

		expect(disposable.result).toBe(42);
	});

	it('should allow manual disposal', () => {
		const mockOn = vi.fn();
		const mockOff = vi.fn();
		const emitter: TestEmitter = {
			on: mockOn,
			off: mockOff,
		};

		const handler = (value: string) => {};

		const disposable = handleOn(emitter, 'testEvent', handler);

		expect(mockOff).not.toHaveBeenCalled();

		disposable[Symbol.dispose]();

		expect(mockOff).toHaveBeenCalledWith('testEvent', handler);
	});
});
