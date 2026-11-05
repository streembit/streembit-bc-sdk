/**
 * Hash functions of the protocol: Blake2b-256, SHA-256, RIPEMD-160, HASH160, double SHA-256 and the
 * transaction salt. Implemented with @noble/hashes (pure JavaScript, audited), so the same code runs in
 * Node, in the browser and in NW.js.
 */

import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { ripemd160 as nobleRipemd160 } from '@noble/hashes/legacy.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { encodeDeterministicJSON, bytesToHex } from './encoding';

/** Blake2b-256, the primary hash of the protocol (32-byte output). */
export function blake2b256(data: Uint8Array): Uint8Array {
    return blake2b(data, { dkLen: 32 });
}

export function sha256(data: Uint8Array): Uint8Array {
    return nobleSha256(data);
}

export function ripemd160(data: Uint8Array): Uint8Array {
    return nobleRipemd160(data);
}

/** HASH160 = RIPEMD160(SHA256(data)), used for address payloads. */
export function hash160(data: Uint8Array): Uint8Array {
    return nobleRipemd160(nobleSha256(data));
}

/** SHA256(SHA256(data)), used for the Base58Check checksum. */
export function doubleHash256(data: Uint8Array): Uint8Array {
    return nobleSha256(nobleSha256(data));
}

/** Transaction salt: first 16 bytes (32 hex chars) of Blake2b-256 over the deterministic JSON of the input. */
export function createSalt(saltData: string): string {
    const encoded = encodeDeterministicJSON(saltData);
    const hash = blake2b256(encoded);
    return bytesToHex(hash).substring(0, 32);
}
