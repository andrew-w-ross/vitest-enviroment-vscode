export function wait(ms = 100) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
