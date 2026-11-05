/**
 * Hash functions of the protocol: Blake2b-256, SHA-256, RIPEMD-160, HASH160, double SHA-256 and the
 * transaction salt. Implemented with @noble/hashes (pure JavaScript, audited), so the same code runs in
 * Node, in the browser and in NW.js.
 */
/** Blake2b-256, the primary hash of the protocol (32-byte output). */
export declare function blake2b256(data: Uint8Array): Uint8Array;
export declare function sha256(data: Uint8Array): Uint8Array;
export declare function ripemd160(data: Uint8Array): Uint8Array;
/** HASH160 = RIPEMD160(SHA256(data)), used for address payloads. */
export declare function hash160(data: Uint8Array): Uint8Array;
/** SHA256(SHA256(data)), used for the Base58Check checksum. */
export declare function doubleHash256(data: Uint8Array): Uint8Array;
/** Transaction salt: first 16 bytes (32 hex chars) of Blake2b-256 over the deterministic JSON of the input. */
export declare function createSalt(saltData: string): string;
//# sourceMappingURL=hashing.d.ts.map