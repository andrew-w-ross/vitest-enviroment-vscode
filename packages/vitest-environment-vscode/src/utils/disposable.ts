export type DisposeFn<T> = (value: T) => unknown;
export type Disposable<T extends object> = ReturnType<typeof toDispose<T>>;

/**
 * Make a value disposable by adding a Symbol.dispose method
 * @param value item to make disposable (must be an extensible object)
 * @param disposeFn function that will cleanup the item
 * @returns value that's disposable
 * @example
 * ```ts
 * // Direct usage with extensible objects
 * const resource = toDispose({ handle: 123 }, (r) => closeHandle(r.handle));
 * using handle = resource; // automatically disposed at end of scope
 *
 * // For non-extensible values (primitives, sealed objects, class instances), wrap them:
 * const connection = new WebSocket('ws://localhost');
 * const disposableConnection = toDispose(
 *   { socket: connection },
 *   (wrapped) => wrapped.socket.close()
 * );
 * using conn = disposableConnection;
 * ```
 */
export function toDispose<T extends object>(value: T, disposeFn: DisposeFn<T>) {
	let disposed = false;
	return Object.assign(value, {
		[Symbol.dispose]: () => {
			if (disposed) return;
			disposeFn(value);
			disposed = true;
		},
	});
}

export type AsyncDispose<T> = (value: T) => PromiseLike<T>;
export type AsyncDisposable<T extends object> = ReturnType<typeof toAsyncDispose<T>>;

/**
 * Make a value async disposable by adding a Symbol.asyncDispose method
 * @param value item to make disposable (must be an extensible object)
 * @param disposeFn async function that will cleanup the item
 * @returns value that's async disposable
 * @example
 * ```ts
 * // Direct usage with extensible objects
 * const resource = toAsyncDispose({ stream: fs.createReadStream('file.txt') }, async (r) => {
 *   await r.stream.close();
 *   return r;
 * });
 * await using file = resource; // automatically disposed at end of scope
 *
 * // For non-extensible values (sealed objects, class instances), wrap them:
 * const database = new DatabaseConnection();
 * const disposableDb = toAsyncDispose(
 *   { connection: database },
 *   async (wrapped) => {
 *     await wrapped.connection.close();
 *     return wrapped;
 *   }
 * );
 * await using db = disposableDb;
 * ```
 */
export function toAsyncDispose<T extends object>(value: T, disposeFn: AsyncDispose<T>) {
	let disposingPromise: PromiseLike<unknown> | undefined;

	return Object.assign(value, {
		[Symbol.asyncDispose]: async () => {
			if (disposingPromise == null) {
				disposingPromise = disposeFn(value);
			}
			await disposingPromise;
		},
	});
}
