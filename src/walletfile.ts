/**
 * The encrypted wallet file, wallet.json version 1.
 *
 * Layout (WalletData): { version: 1, encrypted, salt, iv, authTag (base64), network, createdAt,
 *   kdf: "scrypt", kdfParams: { N, r, p, dkLen }, metadata }
 * The encrypted payload is the UTF-8 JSON {"mnemonic": "..."}.
 * Key derivation: scrypt (RFC 7914) with the stored parameters; the 32-byte output is the AES key.
 * Cipher: AES-256-GCM, 16-byte IV, 16-byte tag.
 *
 * scrypt runs through @noble/hashes (pure JavaScript, audited) and AES-GCM through Web Crypto, in Node,
 * in the browser and in NW.js. The parameters are read from the file, so a file written with one
 * parameter set opens with any client. The derivation is synchronous and takes a few hundred
 * milliseconds at the default cost; a page that must stay responsive runs it in a Web Worker.
 */

import { scrypt } from '@noble/hashes/scrypt.js';
import { bytesToBase64, base64ToBytes, utf8ToBytes, bytesToUtf8, randomBytes } from './encoding';
import type { WalletMetadata } from './metadata';

export const WALLET_VERSION = 1;
export const WALLET_KDF = 'scrypt';

const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH_BYTES = 16;
const KEY_LENGTH = 32;
const MAX_N = 2 ** 22;

export interface ScryptParams {
    /** CPU and memory cost, a power of two; memory is 128 * r * N bytes */
    N: number;
    /** block size */
    r: number;
    /** parallelism; JavaScript derives the lanes one after another, so it adds time, not strength */
    p: number;
    /** output length in bytes, 32 */
    dkLen: number;
}

/** The sealed payload as stored in the file. */
export interface EncryptedPayload {
    encrypted: string;
    salt: string;
    iv: string;
    authTag: string;
    kdf: typeof WALLET_KDF;
    kdfParams: ScryptParams;
}

/** wallet.json version 1. */
export interface WalletData extends EncryptedPayload {
    version: number;
    network: string;
    createdAt: string;
    metadata: WalletMetadata;
}

export interface WalletFileOptions {
    network: string;
    kdfParams?: ScryptParams;
    metadata?: WalletMetadata;
}

export interface PasswordValidation {
    isValid: boolean;
    error?: string;
}

/** N=2^17, r=8, p=1: 128 MiB, the OWASP minimum for scrypt; about 0.3 s on a desktop CPU. */
export const DEFAULT_SCRYPT_PARAMS: Readonly<ScryptParams> = Object.freeze({
    N: 2 ** 17,
    r: 8,
    p: 1,
    dkLen: KEY_LENGTH
});

export const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+=\-{}[\]|\\:;"'<>,.\/~`])/;

/** Minimum 12 characters with a lowercase letter, an uppercase letter, a digit and a special character. */
export function validatePassword(password: string): PasswordValidation {
    if (!password) {
        return { isValid: false, error: 'Password is required' };
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
        return { isValid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
    }
    if (!PASSWORD_REGEX.test(password)) {
        const missing: string[] = [];
        if (!/[a-z]/.test(password)) missing.push('lowercase letter');
        if (!/[A-Z]/.test(password)) missing.push('uppercase letter');
        if (!/\d/.test(password)) missing.push('number');
        if (!/[@$!%*?&#^()_+=\-{}[\]|\\:;"'<>,.\/~`]/.test(password)) missing.push('special character');
        return { isValid: false, error: `Password must contain at least one ${missing.join(', ')}` };
    }
    return { isValid: true };
}

function validateScryptParams(params: ScryptParams): void {
    if (!params || !Number.isInteger(params.N) || params.N < 2 || params.N > MAX_N || (params.N & (params.N - 1)) !== 0) {
        throw new Error(`scrypt N must be a power of two between 2 and ${MAX_N}`);
    }
    if (!Number.isInteger(params.r) || params.r < 1 || !Number.isInteger(params.p) || params.p < 1) {
        throw new Error('scrypt r and p must be positive integers');
    }
    if (params.dkLen !== KEY_LENGTH) {
        throw new Error(`scrypt dkLen must be ${KEY_LENGTH}`);
    }
}

/** The AES-256 key: scrypt of the password and salt with the given parameters. */
export function deriveKey(password: string, salt: Uint8Array, params: ScryptParams): Uint8Array<ArrayBuffer> {
    validateScryptParams(params);
    const key = scrypt(utf8ToBytes(password), salt, { N: params.N, r: params.r, p: params.p, dkLen: params.dkLen, maxmem: 128 * params.r * (params.N + params.p + 1) + 1024 });
    return new Uint8Array(key);
}

/** Encrypt a string with a password. */
export async function encryptWithPassword(data: string, password: string, params: Readonly<ScryptParams> = DEFAULT_SCRYPT_PARAMS): Promise<EncryptedPayload> {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const keyBytes = deriveKey(password, salt, params);
    const key = await globalThis.crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const sealed = new Uint8Array(await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: TAG_LENGTH_BYTES * 8 },
        key,
        utf8ToBytes(data)
    ));
    const ciphertext = sealed.slice(0, sealed.length - TAG_LENGTH_BYTES);
    const authTag = sealed.slice(sealed.length - TAG_LENGTH_BYTES);
    return {
        encrypted: bytesToBase64(ciphertext),
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        authTag: bytesToBase64(authTag),
        kdf: WALLET_KDF,
        kdfParams: { ...params }
    };
}

/** Decrypt a payload produced by encryptWithPassword with any parameter set. */
export async function decryptWithPassword(encryptedData: EncryptedPayload, password: string): Promise<string> {
    if (encryptedData.kdf !== WALLET_KDF) {
        throw new Error(`Unsupported key derivation: ${encryptedData.kdf}`);
    }
    const ciphertext = base64ToBytes(encryptedData.encrypted);
    const salt = base64ToBytes(encryptedData.salt);
    const iv = base64ToBytes(encryptedData.iv);
    const authTag = base64ToBytes(encryptedData.authTag);
    const keyBytes = deriveKey(password, salt, encryptedData.kdfParams);
    const key = await globalThis.crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const sealed = new Uint8Array(ciphertext.length + authTag.length);
    sealed.set(ciphertext);
    sealed.set(authTag, ciphertext.length);
    let plain: ArrayBuffer;
    try {
        plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: TAG_LENGTH_BYTES * 8 }, key, sealed);
    } catch {
        throw new Error('Decryption failed: wrong password or corrupted wallet file');
    }
    return bytesToUtf8(new Uint8Array(plain));
}

/** Build a wallet.json document from a mnemonic. */
export async function createWalletFile(mnemonic: string, password: string, options: WalletFileOptions): Promise<WalletData> {
    const validation = validatePassword(password);
    if (!validation.isValid) {
        throw new Error(validation.error);
    }
    const enc = await encryptWithPassword(JSON.stringify({ mnemonic }), password, options.kdfParams ?? DEFAULT_SCRYPT_PARAMS);
    return {
        version: WALLET_VERSION,
        encrypted: enc.encrypted,
        salt: enc.salt,
        iv: enc.iv,
        authTag: enc.authTag,
        kdf: enc.kdf,
        kdfParams: enc.kdfParams,
        network: options.network,
        createdAt: new Date().toISOString(),
        metadata: options.metadata ?? {}
    };
}

/** Open a wallet.json document and return the mnemonic. */
export async function openWalletFile(walletData: WalletData, password: string): Promise<string> {
    if (!walletData || walletData.version !== WALLET_VERSION) {
        throw new Error(`Unsupported wallet version: ${walletData && walletData.version}`);
    }
    const decrypted = await decryptWithPassword(walletData, password);
    const { mnemonic } = JSON.parse(decrypted) as { mnemonic?: unknown };
    if (typeof mnemonic !== 'string' || !mnemonic) {
        throw new Error('Wallet file does not contain a mnemonic');
    }
    return mnemonic;
}

/** Re-encrypt a wallet file under a new password, keeping network, createdAt and metadata. */
export async function changeWalletPassword(walletData: WalletData, currentPassword: string, newPassword: string, kdfParams: Readonly<ScryptParams> = DEFAULT_SCRYPT_PARAMS): Promise<WalletData> {
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
        throw new Error(validation.error);
    }
    const mnemonic = await openWalletFile(walletData, currentPassword);
    const enc = await encryptWithPassword(JSON.stringify({ mnemonic }), newPassword, kdfParams);
    return { ...walletData, encrypted: enc.encrypted, salt: enc.salt, iv: enc.iv, authTag: enc.authTag, kdf: enc.kdf, kdfParams: enc.kdfParams };
}
