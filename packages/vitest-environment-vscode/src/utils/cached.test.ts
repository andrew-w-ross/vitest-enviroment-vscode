import { describe, it, expect, vi } from 'vitest';
import { cached } from './cached';

describe('cached', () => {
	it('should cache function results', () => {
		const fn = vi.fn((x: number) => x * 2);
		const cachedFn = cached(fn);

		const result1 = cachedFn(5);
		const result2 = cachedFn(5);

		expect(result1).toBe(10);
		expect(result2).toBe(10);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should call function again for different arguments', () => {
		const fn = vi.fn((x: number) => x * 2);
		const cachedFn = cached(fn);

		const result1 = cachedFn(5);
		const result2 = cachedFn(10);

		expect(result1).toBe(10);
		expect(result2).toBe(20);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('should expose cache as property', () => {
		const fn = (x: number) => x * 2;
		const cachedFn = cached(fn);

		cachedFn(5);

		expect(cachedFn.cache).toBeInstanceOf(Array);
		expect(cachedFn.cache.length).toBe(1);
	});

	it('should respect cache limit', () => {
		const fn = vi.fn((x: number) => x * 2);
		const cachedFn = cached(fn, { limit: 2 });

		cachedFn(1);
		cachedFn(2);
		cachedFn(3);

		expect(cachedFn.cache.length).toBe(2);
		expect(fn).toHaveBeenCalledTimes(3);

		cachedFn(1);
		expect(fn).toHaveBeenCalledTimes(4);
	});

	it('should handle functions with multiple arguments', () => {
		const fn = vi.fn((a: number, b: number) => a + b);
		const cachedFn = cached(fn);

		const result1 = cachedFn(2, 3);
		const result2 = cachedFn(2, 3);

		expect(result1).toBe(5);
		expect(result2).toBe(5);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should handle functions with no arguments', () => {
		let callCount = 0;
		const fn = vi.fn(() => ++callCount);
		const cachedFn = cached(fn);

		const result1 = cachedFn();
		const result2 = cachedFn();

		expect(result1).toBe(1);
		expect(result2).toBe(1);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should cache undefined results', () => {
		const fn = vi.fn(() => undefined);
		const cachedFn = cached(fn);

		cachedFn();
		cachedFn();

		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should work with async functions', async () => {
		const fn = vi.fn(async (x: number) => Promise.resolve(x * 2));
		const cachedFn = cached(fn);

		const result1 = await cachedFn(5);
		const result2 = await cachedFn(5);

		expect(result1).toBe(10);
		expect(result2).toBe(10);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should handle object return values', () => {
		const fn = vi.fn((x: number) => ({ value: x }));
		const cachedFn = cached(fn);

		const result1 = cachedFn(5);
		const result2 = cachedFn(5);

		expect(result1).toEqual({ value: 5 });
		expect(result1).toBe(result2);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
