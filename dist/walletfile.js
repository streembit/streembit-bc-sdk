"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PASSWORD_MIN_LENGTH = exports.DEFAULT_SCRYPT_PARAMS = exports.WALLET_KDF = exports.WALLET_VERSION = void 0;
exports.validatePassword = validatePassword;
exports.deriveKey = deriveKey;
exports.encryptWithPassword = encryptWithPassword;
exports.decryptWithPassword = decryptWithPassword;
exports.createWalletFile = createWalletFile;
exports.openWalletFile = openWalletFile;
exports.changeWalletPassword = changeWalletPassword;
const scrypt_js_1 = require("@noble/hashes/scrypt.js");
const encoding_1 = require("./encoding");
exports.WALLET_VERSION = 1;
exports.WALLET_KDF = 'scrypt';
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH_BYTES = 16;
const KEY_LENGTH = 32;
const MAX_N = 2 ** 22;
/** N=2^17, r=8, p=1: 128 MiB, the OWASP minimum for scrypt; about 0.3 s on a desktop CPU. */
exports.DEFAULT_SCRYPT_PARAMS = Object.freeze({
    N: 2 ** 17,
    r: 8,
    p: 1,
    dkLen: KEY_LENGTH
});
exports.PASSWORD_MIN_LENGTH = 12;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_+=\-{}[\]|\\:;"'<>,.\/~`])/;
/** Minimum 12 characters with a lowercase letter, an uppercase letter, a digit and a special character. */
function validatePassword(password) {
    if (!password) {
        return { isValid: false, error: 'Password is required' };
    }
    if (password.length < exports.PASSWORD_MIN_LENGTH) {
        return { isValid: false, error: `Password must be at least ${exports.PASSWORD_MIN_LENGTH} characters` };
    }
    if (!PASSWORD_REGEX.test(password)) {
        const missing = [];
        if (!/[a-z]/.test(password))
            missing.push('lowercase letter');
        if (!/[A-Z]/.test(password))
            missing.push('uppercase letter');
        if (!/\d/.test(password))
            missing.push('number');
        if (!/[@$!%*?&#^()_+=\-{}[\]|\\:;"'<>,.\/~`]/.test(password))
            missing.push('special character');
        return { isValid: false, error: `Password must contain at least one ${missing.join(', ')}` };
    }
    return { isValid: true };
}
function validateScryptParams(params) {
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
function deriveKey(password, salt, params) {
    validateScryptParams(params);
    const key = (0, scrypt_js_1.scrypt)((0, encoding_1.utf8ToBytes)(password), salt, { N: params.N, r: params.r, p: params.p, dkLen: params.dkLen, maxmem: 128 * params.r * (params.N + params.p + 1) + 1024 });
    return new Uint8Array(key);
}
/** Encrypt a string with a password. */
async function encryptWithPassword(data, password, params = exports.DEFAULT_SCRYPT_PARAMS) {
    const salt = (0, encoding_1.randomBytes)(SALT_LENGTH);
    const iv = (0, encoding_1.randomBytes)(IV_LENGTH);
    const keyBytes = deriveKey(password, salt, params);
    const key = await globalThis.crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const sealed = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: TAG_LENGTH_BYTES * 8 }, key, (0, encoding_1.utf8ToBytes)(data)));
    const ciphertext = sealed.slice(0, sealed.length - TAG_LENGTH_BYTES);
    const authTag = sealed.slice(sealed.length - TAG_LENGTH_BYTES);
    return {
        encrypted: (0, encoding_1.bytesToBase64)(ciphertext),
        salt: (0, encoding_1.bytesToBase64)(salt),
        iv: (0, encoding_1.bytesToBase64)(iv),
        authTag: (0, encoding_1.bytesToBase64)(authTag),
        kdf: exports.WALLET_KDF,
        kdfParams: { ...params }
    };
}
/** Decrypt a payload produced by encryptWithPassword with any parameter set. */
async function decryptWithPassword(encryptedData, password) {
    if (encryptedData.kdf !== exports.WALLET_KDF) {
        throw new Error(`Unsupported key derivation: ${encryptedData.kdf}`);
    }
    const ciphertext = (0, encoding_1.base64ToBytes)(encryptedData.encrypted);
    const salt = (0, encoding_1.base64ToBytes)(encryptedData.salt);
    const iv = (0, encoding_1.base64ToBytes)(encryptedData.iv);
    const authTag = (0, encoding_1.base64ToBytes)(encryptedData.authTag);
    const keyBytes = deriveKey(password, salt, encryptedData.kdfParams);
    const key = await globalThis.crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const sealed = new Uint8Array(ciphertext.length + authTag.length);
    sealed.set(ciphertext);
    sealed.set(authTag, ciphertext.length);
    let plain;
    try {
        plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: TAG_LENGTH_BYTES * 8 }, key, sealed);
    }
    catch {
        throw new Error('Decryption failed: wrong password or corrupted wallet file');
    }
    return (0, encoding_1.bytesToUtf8)(new Uint8Array(plain));
}
/** Build a wallet.json document from a mnemonic. */
async function createWalletFile(mnemonic, password, options) {
    const validation = validatePassword(password);
    if (!validation.isValid) {
        throw new Error(validation.error);
    }
    const enc = await encryptWithPassword(JSON.stringify({ mnemonic }), password, options.kdfParams ?? exports.DEFAULT_SCRYPT_PARAMS);
    return {
        version: exports.WALLET_VERSION,
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
async function openWalletFile(walletData, password) {
    if (!walletData || walletData.version !== exports.WALLET_VERSION) {
        throw new Error(`Unsupported wallet version: ${walletData && walletData.version}`);
    }
    const decrypted = await decryptWithPassword(walletData, password);
    const { mnemonic } = JSON.parse(decrypted);
    if (typeof mnemonic !== 'string' || !mnemonic) {
        throw new Error('Wallet file does not contain a mnemonic');
    }
    return mnemonic;
}
/** Re-encrypt a wallet file under a new password, keeping network, createdAt and metadata. */
async function changeWalletPassword(walletData, currentPassword, newPassword, kdfParams = exports.DEFAULT_SCRYPT_PARAMS) {
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
        throw new Error(validation.error);
    }
    const mnemonic = await openWalletFile(walletData, currentPassword);
    const enc = await encryptWithPassword(JSON.stringify({ mnemonic }), newPassword, kdfParams);
    return { ...walletData, encrypted: enc.encrypted, salt: enc.salt, iv: enc.iv, authTag: enc.authTag, kdf: enc.kdf, kdfParams: enc.kdfParams };
}
