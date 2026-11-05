/**
 * Key creation and HD derivation: BIP39 12-word English mnemonic, BIP32 derivation on
 * m/44'/19640701'/<account>'/0/<index>, compressed secp256k1 public keys, 'S' addresses.
 * Implemented with @scure/bip39 and @scure/bip32 (Uint8Array only, no native code).
 */
/** Streembit coin type (unregistered; SLIP-44 registration is a prerequisite for device apps). */
export declare const STREEMBIT_COIN_TYPE = 19640701;
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
export declare function derivationPath(accountIndex: number, addressIndex: number): string;
/** New 12-word mnemonic from Web Crypto randomness. */
export declare function generateMnemonic(): string;
export declare function validateMnemonic(mnemonic: string): boolean;
/** Lower-cases and collapses whitespace so a pasted phrase validates like a typed one. */
export declare function normalizeMnemonic(mnemonic: string): string;
/**
 * BIP39 seed (64 bytes). PBKDF2 with 2048 rounds; derive once and keep the seed for the session rather
 * than calling this per address. The optional BIP39 passphrase is part of the seed, not of the wallet file.
 */
export declare function seedFromMnemonic(mnemonic: string, passphrase?: string): Uint8Array;
/** Derive one account/address from a seed. */
export declare function deriveFromSeed(seed: Uint8Array, accountIndex?: number, addressIndex?: number): DerivedAccount;
/** Convenience for one-off use (restore flows, tests). For interactive use derive the seed once. */
export declare function deriveAccount(mnemonic: string, accountIndex?: number, addressIndex?: number, passphrase?: string): DerivedAccount;
/** Public-only derivation for display and address discovery: no private key is materialised. */
export declare function deriveAddressOnly(seed: Uint8Array, accountIndex?: number, addressIndex?: number): DerivedAddress;
//# sourceMappingURL=keys.d.ts.map