import type { Fn } from '~/types';

export function invoke<TFn extends Fn>(fn: TFn) {
	return fn() as ReturnType<TFn>;
}
