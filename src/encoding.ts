/**
 * Deterministic encoding.
 *
 * The bytes a wallet signs and hashes must be identical to the bytes the node signs and hashes.
 * Every function here defines those bytes; the node and every wallet use this module.
 *
 * Web APIs only (TextEncoder, TextDecoder, Web Crypto, String.prototype.normalize); runs in Node,
 * in the browser and in NW.js.
 */

const HEX = '0123456789abcdef';

export interface EncodeJSONOptions {
    asString?: boolean;
    asHex?: boolean;
}

/** Canonical string to UTF-8 bytes: rejects BOM and NUL, NFC-normalizes, LF line endings. */
export function encodeDeterministic(input: string): Uint8Array {
    if (input.length > 0 && input.charCodeAt(0) === 0xfeff) {
        throw new Error('BOM not allowed');
    }
    if (input.indexOf('\0') !== -1) {
        throw new Error('Binary NULL not allowed');
    }
    let normalized = input.normalize('NFC');
    normalized = normalized.replace(/\r\n?/g, '\n');
    return new TextEncoder().encode(normalized);
}

/** Canonical UTF-8 bytes to string. */
export function decodeDeterministic(bytes: Uint8Array): string {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.indexOf('\0') !== -1) {
        throw new Error('Binary NULL not allowed');
    }
    return text.normalize('NFC');
}

function bigIntReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'bigint') {
        return value.toString() + 'n';
    }
    return value;
}

function bigIntReviver(_key: string, value: unknown): unknown {
    if (typeof value === 'string' && /^\d+n$/.test(value)) {
        return BigInt(value.slice(0, -1));
    }
    return value;
}

function sortObjectKeys(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(sortObjectKeys);
    }
    if (typeof obj === 'object') {
        const source = obj as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        const keys = Object.keys(source).sort();
        for (const key of keys) {
            sorted[key] = sortObjectKeys(source[key]);
        }
        return sorted;
    }
    return obj;
}

/**
 * Deterministic JSON: keys sorted at every level, BigInt as "<digits>n", undefined dropped,
 * no whitespace. The signing preimage, the contract call data and the transaction salt are built with it.
 */
export function encodeDeterministicJSON(obj: unknown): Uint8Array;
export function encodeDeterministicJSON(obj: unknown, options: { asString: true } | { asHex: true }): string;
export function encodeDeterministicJSON(obj: unknown, options?: EncodeJSONOptions): Uint8Array | string {
    const sorted = sortObjectKeys(obj);
    const json = JSON.stringify(sorted, bigIntReplacer);
    const bytes = new TextEncoder().encode(json);
    if (options && options.asString) {
        return bytesToUtf8(bytes);
    }
    if (options && options.asHex) {
        return bytesToHex(bytes);
    }
    return bytes;
}

export function decodeDeterministicJSON(data: Uint8Array): unknown {
    const json = new TextDecoder().decode(data);
    return JSON.parse(json, bigIntReviver);
}

/** Lowercase hex. */
export function bytesToHex(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        out += HEX[b >>> 4] + HEX[b & 0x0f];
    }
    return out;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
        throw new Error('Invalid hex string');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

export function utf8ToBytes(str: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(str);
}

export function bytesToUtf8(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

/** Standard base64 with padding, as Node's Buffer.toString('base64') produces. */
export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** Cryptographically secure random bytes from Web Crypto (globalThis.crypto in Node and in browsers). */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(length);
    globalThis.crypto.getRandomValues(out);
    return out;
}
