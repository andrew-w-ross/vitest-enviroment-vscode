export class CliArgs {
	readonly argv: string[];
	readonly options: Map<string, string | undefined>;

	constructor(args: string[] = []) {
		this.argv = [];
		this.options = new Map();

		for (const arg of args) {
			if (arg.startsWith('--')) {
				const eqIndex = arg.indexOf('=');
				if (eqIndex === -1) {
					const key = arg.slice(2);
					this.set(key);
				} else {
					const key = arg.slice(2, eqIndex);
					const value = arg.slice(eqIndex + 1);
					this.set(key, value);
				}
			} else {
				this.argv.push(arg);
			}
		}
	}

	get(key: string): string | undefined {
		return this.options.get(key);
	}

	set(key: string, value?: string): this {
		this.options.set(key, value);
		return this;
	}

	delete(key: string): this {
		this.options.delete(key);
		return this;
	}

	has(key: string): boolean {
		return this.options.has(key);
	}

	/**
	 * Serialize back to a flat argv-style array containing
	 * the positional argv entries followed by all `--key=value` options.
	 */
	toArray(): string[] {
		const optionArgs: string[] = [];
		for (const [key, value] of this.options.entries()) {
			if (value === undefined) {
				optionArgs.push(`--${key}`);
			} else {
				optionArgs.push(`--${key}=${value}`);
			}
		}
		return [...this.argv, ...optionArgs];
	}
}
