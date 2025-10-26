/* eslint-disable @typescript-eslint/no-explicit-any */
//Probally should share this file

/**
 * Describes just any function
 */
export type Fn = (...args: any) => any;

export type OverLoadFunctions<FunctionType> = FunctionType extends {
	(...args: infer A1): infer R1;
	(...args: infer A2): infer R2;
	(...args: infer A3): infer R3;
	(...args: infer A4): infer R4;
	(...args: infer A5): infer R5;
	(...args: infer A6): infer R6;
	(...args: infer A7): infer R7;
	(...args: infer A8): infer R8;
	(...args: infer A9): infer R9;
	(...args: infer A10): infer R10;
}
	?
			| ((...p: A1) => R1)
			| ((...p: A2) => R2)
			| ((...p: A3) => R3)
			| ((...p: A4) => R4)
			| ((...p: A5) => R5)
			| ((...p: A6) => R6)
			| ((...p: A7) => R7)
			| ((...p: A8) => R8)
			| ((...p: A9) => R9)
			| ((...p: A10) => R10)
	: never;

export type ExtractParams<T> = T extends (...args: infer P) => any ? P : never;
