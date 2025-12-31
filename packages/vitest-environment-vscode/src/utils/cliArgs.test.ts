import { expect, it } from 'vitest';
import { CliArgs } from './cliArgs';

it('separates options, flags, and positional argv', () => {
	const args = [
		'node',
		'script.js',
		'foo',
		'--bar=baz',
		'--flag-only',
		'qux',
		'--long-option=value',
	];

	const cli = new CliArgs(args);

	expect(cli.argv).toEqual(['node', 'script.js', 'foo', 'qux']);
	expect(cli.get('bar')).toBe('baz');
	expect(cli.get('long-option')).toBe('value');
	expect(cli.get('flag-only')).toBeUndefined();
});

it('supports get/set/delete/has on options map', () => {
	const cli = new CliArgs(['--foo=bar']);

	expect(cli.get('foo')).toBe('bar');
	expect(cli.has('foo')).toBe(true);

	cli.set('foo', 'baz');
	expect(cli.get('foo')).toBe('baz');

	cli.delete('foo');
	expect(cli.has('foo')).toBe(false);
	expect(cli.get('foo')).toBeUndefined();
});

it('serializes flags without equals', () => {
	const cli = new CliArgs(['node', 'script.js', '--flag'])
		.set('no-sandbox')
		.set('with-value', 'x');

	const result = cli.toArray();

	expect(result).toContain('node');
	expect(result).toContain('script.js');
	expect(result).toContain('--flag');
	expect(result).toContain('--no-sandbox');
	expect(result).toContain('--with-value=x');
});

it('round-trips to a flat argv array', () => {
	const args = ['node', 'index.js', '--foo=bar', 'baz'];
	const cli = new CliArgs(args)
		// change an option
		.set('foo', 'updated')
		.set('new', 'value')
		.set('flag2');

	const result = cli.toArray();

	expect(result).toContain('node');
	expect(result).toContain('index.js');
	expect(result).toContain('baz');
	expect(result).toContain('--foo=updated');
	expect(result).toContain('--new=value');
	expect(result).toContain('--flag2');
});
