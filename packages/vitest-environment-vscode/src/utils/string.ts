const IS_WHITESPACE = /^\s*$/;

export function isNullOrEmpty(value?: string | null): value is null | undefined | '' {
	return value == null || IS_WHITESPACE.test(value);
}
