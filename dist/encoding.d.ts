/**
 * Deterministic encoding.
 *
 * The bytes a wallet signs and hashes must be identical to the bytes the node signs and hashes.
 * Every function here defines those bytes; the node and every wallet use this module.
 *
 * Web APIs only (TextEncoder, TextDecoder, Web Crypto, String.prototype.normalize); runs in Node,
 * in the browser and in NW.js.
 */
export interface EncodeJSONOptions {
    asString?: boolean;
    asHex?: boolean;
}
/** Canonical string to UTF-8 bytes: rejects BOM and NUL, NFC-normalizes, LF line endings. */
export declare function encodeDeterministic(input: string): Uint8Array;
/** Canonical UTF-8 bytes to string. */
export declare function decodeDeterministic(bytes: Uint8Array): string;
/**
 * Deterministic JSON: keys sorted at every level, BigInt as "<digits>n", undefined dropped,
 * no whitespace. The signing preimage, the contract call data and the transaction salt are built with it.
 */
export declare function encodeDeterministicJSON(obj: unknown): Uint8Array;
export declare function encodeDeterministicJSON(obj: unknown, options: {
    asString: true;
} | {
    asHex: true;
}): string;
export declare function decodeDeterministicJSON(data: Uint8Array): unknown;
/** Lowercase hex. */
export declare function bytesToHex(bytes: Uint8Array): string;
export declare function hexToBytes(hex: string): Uint8Array<ArrayBuffer>;
export declare function utf8ToBytes(str: string): Uint8Array<ArrayBuffer>;
export declare function bytesToUtf8(bytes: Uint8Array): string;
export declare function concatBytes(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer>;
/** Standard base64 with padding, as Node's Buffer.toString('base64') produces. */
export declare function bytesToBase64(bytes: Uint8Array): string;
export declare function base64ToBytes(b64: string): Uint8Array<ArrayBuffer>;
/** Cryptographically secure random bytes from Web Crypto (globalThis.crypto in Node and in browsers). */
export declare function randomBytes(length: number): Uint8Array<ArrayBuffer>;
//# sourceMappingURL=encoding.d.ts.map