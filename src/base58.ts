/**
 * Base58 and Base58Check encoding for Streembit addresses (BigInt arithmetic, Bitcoin alphabet).
 */

import { doubleHash256 } from './hashing';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE = BigInt(ALPHABET.length);

const alphabetMap = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) {
    alphabetMap.set(ALPHABET[i], i);
}

export function base58Encode(data: Uint8Array): string {
    if (data.length === 0) return '';

    let num = BigInt(0);
    for (let i = 0; i < data.length; i++) {
        num = num * BigInt(256) + BigInt(data[i]);
    }

    let encoded = '';
    while (num > BigInt(0)) {
        const remainder = num % BASE;
        num = num / BASE;
        encoded = ALPHABET[Number(remainder)] + encoded;
    }

    for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) {
            encoded = '1' + encoded;
        } else {
            break;
        }
    }

    return encoded;
}

export function base58Decode(str: string): Uint8Array {
    if (str.length === 0) return new Uint8Array(0);

    let num = BigInt(0);
    for (const char of str) {
        const value = alphabetMap.get(char);
        if (value === undefined) {
            throw new Error(`Invalid Base58 character: ${char}`);
        }
        num = num * BASE + BigInt(value);
    }

    const bytes: number[] = [];
    while (num > BigInt(0)) {
        bytes.unshift(Number(num % BigInt(256)));
        num = num / BigInt(256);
    }

    for (const char of str) {
        if (char === '1') {
            bytes.unshift(0);
        } else {
            break;
        }
    }

    return new Uint8Array(bytes);
}

/** [version][payload][4-byte checksum] to Base58. */
export function base58checkEncode(version: number, payload: Uint8Array): string {
    const data = new Uint8Array(1 + payload.length);
    data[0] = version;
    data.set(payload, 1);

    const checksum = doubleHash256(data).slice(0, 4);

    const fullData = new Uint8Array(data.length + 4);
    fullData.set(data);
    fullData.set(checksum, data.length);

    return base58Encode(fullData);
}

/** Verifies the checksum and returns the payload without the version byte. */
export function base58checkDecode(str: string): Uint8Array {
    return base58checkDecodeWithVersion(str).payload;
}

export function base58checkDecodeWithVersion(str: string): { version: number; payload: Uint8Array } {
    const data = base58Decode(str);

    if (data.length < 5) {
        throw new Error('Invalid Base58Check string: too short');
    }

    const version = data[0];
    const payload = data.slice(1, -4);
    const checksum = data.slice(-4);

    const toHash = data.slice(0, -4);
    const expectedChecksum = doubleHash256(toHash).slice(0, 4);

    for (let i = 0; i < 4; i++) {
        if (checksum[i] !== expectedChecksum[i]) {
            throw new Error('Invalid Base58Check checksum');
        }
    }

    return { version, payload };
}
