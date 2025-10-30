import type { Maybe } from '~/types';

const IS_WHITESPACE = /^\s*$/;

export function isNullOrEmpty(value?: Maybe<string>): value is null | undefined | '' {
	return value == null || IS_WHITESPACE.test(value);
}
