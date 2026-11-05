/**
 * Key creation and HD derivation: BIP39 12-word English mnemonic, BIP32 derivation on
 * m/44'/19640701'/<account>'/0/<index>, compressed secp256k1 public keys, 'S' addresses.
 * Implemented with @scure/bip39 and @scure/bip32 (Uint8Array only, no native code).
 */

import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { bytesToHex } from './encoding';
import { createUserAddress } from './address';

/** Streembit coin type (unregistered; SLIP-44 registration is a prerequisite for device apps). */
export const STREEMBIT_COIN_TYPE = 19640701;

/** 12 words = 128 bits of entropy. */
const MNEMONIC_STRENGTH = 128;

export interface DerivedAccount {
    path: string;
    /** 64 hex chars */
    privateKey: string;
    /** 66 hex chars (compressed) */
    publicKey: string;
    /** 'S' address */
    address: string;
}

export interface DerivedAddress {
    path: string;
    publicKey: string;
    address: string;
}

/** BIP44 path; change is always 0 (account model, no change addresses). */
export function derivationPath(accountIndex: number, addressIndex: number): string {
    if (!Number.isInteger(accountIndex) || accountIndex < 0 || !Number.isInteger(addressIndex) || addressIndex < 0) {
        throw new Error('Account and address indexes must be non-negative integers');
    }
    return `m/44'/${STREEMBIT_COIN_TYPE}'/${accountIndex}'/0/${addressIndex}`;
}

/** New 12-word mnemonic from Web Crypto randomness. */
export function generateMnemonic(): string {
    return bip39.generateMnemonic(wordlist, MNEMONIC_STRENGTH);
}

export function validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

/** Lower-cases and collapses whitespace so a pasted phrase validates like a typed one. */
export function normalizeMnemonic(mnemonic: string): string {
    return String(mnemonic || '').trim().toLowerCase().split(/\s+/).join(' ');
}

/**
 * BIP39 seed (64 bytes). PBKDF2 with 2048 rounds; derive once and keep the seed for the session rather
 * than calling this per address. The optional BIP39 passphrase is part of the seed, not of the wallet file.
 */
export function seedFromMnemonic(mnemonic: string, passphrase = ''): Uint8Array {
    const normalized = normalizeMnemonic(mnemonic);
    if (!bip39.validateMnemonic(normalized, wordlist)) {
        throw new Error('Invalid mnemonic phrase');
    }
    return bip39.mnemonicToSeedSync(normalized, passphrase);
}

/** Derive one account/address from a seed. */
export function deriveFromSeed(seed: Uint8Array, accountIndex = 0, addressIndex = 0): DerivedAccount {
    const path = derivationPath(accountIndex, addressIndex);
    const root = HDKey.fromMasterSeed(seed);
    const node = root.derive(path);
    if (!node.privateKey || !node.publicKey) {
        throw new Error('Derived node has no private key');
    }
    const privateKey = bytesToHex(node.privateKey);
    const publicKey = bytesToHex(node.publicKey);
    const address = createUserAddress(node.publicKey);
    return { path, privateKey, publicKey, address };
}

/** Convenience for one-off use (restore flows, tests). For interactive use derive the seed once. */
export function deriveAccount(mnemonic: string, accountIndex = 0, addressIndex = 0, passphrase = ''): DerivedAccount {
    return deriveFromSeed(seedFromMnemonic(mnemonic, passphrase), accountIndex, addressIndex);
}

/** Public-only derivation for display and address discovery: no private key is materialised. */
export function deriveAddressOnly(seed: Uint8Array, accountIndex = 0, addressIndex = 0): DerivedAddress {
    const path = derivationPath(accountIndex, addressIndex);
    const node = HDKey.fromMasterSeed(seed).derive(path);
    if (!node.publicKey) {
        throw new Error('Derived node has no public key');
    }
    return { path, publicKey: bytesToHex(node.publicKey), address: createUserAddress(node.publicKey) };
}
