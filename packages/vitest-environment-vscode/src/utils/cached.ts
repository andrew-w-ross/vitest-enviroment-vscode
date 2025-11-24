import type { Fn } from '../types';

export type CachedFn<TFn extends Fn> = TFn & {
	cache: { args: Parameters<TFn>; result: ReturnType<TFn> }[];
};

export type CachedOptions = {
	limit: number;
};

const argsEqual = <T extends unknown[]>(a: T, b: T): boolean => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (!Object.is(a[i], b[i])) return false;
	}
	return true;
};

export function cached<const TFn extends Fn>(fn: TFn, options?: CachedOptions) {
	const cache: { args: Parameters<TFn>; result: ReturnType<TFn> }[] = [];
	const limit = options?.limit ?? Number.POSITIVE_INFINITY;

	const cachedFn = (...args: Parameters<TFn>): ReturnType<TFn> => {
		const existing = cache.find((entry) => argsEqual(entry.args, args));
		if (existing !== undefined) {
			return existing.result;
		}

		const result = fn(...args) as ReturnType<TFn>;
		cache.push({ args, result });

		if (cache.length > limit) {
			cache.shift();
		}

		return result;
	};

	return Object.assign(cachedFn, { cache }) as CachedFn<TFn>;
}
