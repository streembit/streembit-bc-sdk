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
 * parameter set opens with any client. The derivation yields to the event loop while it runs, so a page
 * stays responsive; it takes a few hundred milliseconds at the default cost.
 */
import type { WalletMetadata } from './metadata';
export declare const WALLET_VERSION = 1;
export declare const WALLET_KDF = "scrypt";
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
export declare const DEFAULT_SCRYPT_PARAMS: Readonly<ScryptParams>;
export declare const PASSWORD_MIN_LENGTH = 12;
/** Minimum 12 characters with a lowercase letter, an uppercase letter, a digit and a special character. */
export declare function validatePassword(password: string): PasswordValidation;
/** The AES-256 key: scrypt of the password and salt with the given parameters. */
export declare function deriveKey(password: string, salt: Uint8Array, params: ScryptParams): Promise<Uint8Array<ArrayBuffer>>;
/** Encrypt a string with a password. */
export declare function aesEncryptScrypt(data: string, password: string, params?: Readonly<ScryptParams>): Promise<EncryptedPayload>;
/** Decrypt a payload produced by aesEncryptScrypt with any parameter set. */
export declare function aesDecryptScrypt(encryptedData: EncryptedPayload, password: string): Promise<string>;
/** Build a wallet.json document from a mnemonic; the phrase is validated and stored in its canonical form. */
export declare function createWalletFile(mnemonic: string, password: string, options: WalletFileOptions): Promise<WalletData>;
/** Build a wallet.json document around a raw private key, for an officer's recorded key. Same layout and cipher as the mnemonic file; the payload is {"privateKey"}. */
export declare function createKeyFile(privateKeyHex: string, password: string, options: WalletFileOptions): Promise<WalletData>;
/** Open a key file and return the private key (64 hex). */
export declare function openKeyFile(walletData: WalletData, password: string): Promise<string>;
/** Open a wallet.json document and return the mnemonic. */
export declare function openWalletFile(walletData: WalletData, password: string): Promise<string>;
/** Re-encrypt a wallet file under a new password, keeping network, createdAt and metadata. */
export declare function changeWalletPassword(walletData: WalletData, currentPassword: string, newPassword: string, kdfParams?: Readonly<ScryptParams>): Promise<WalletData>;
//# sourceMappingURL=walletfile.d.ts.map