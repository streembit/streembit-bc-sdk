"use strict";
/**
 * Key creation and HD derivation: BIP39 12-word English mnemonic, BIP32 derivation on
 * m/44'/19640701'/<account>'/0/<index>, compressed secp256k1 public keys, 'S' addresses.
 * Implemented with @scure/bip39 and @scure/bip32 (Uint8Array only, no native code).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.STREEMBIT_COIN_TYPE = void 0;
exports.derivationPath = derivationPath;
exports.generateMnemonic = generateMnemonic;
exports.validateMnemonic = validateMnemonic;
exports.normalizeMnemonic = normalizeMnemonic;
exports.seedFromMnemonic = seedFromMnemonic;
exports.deriveFromSeed = deriveFromSeed;
exports.deriveAccount = deriveAccount;
exports.deriveAddressOnly = deriveAddressOnly;
const bip39 = __importStar(require("@scure/bip39"));
const english_js_1 = require("@scure/bip39/wordlists/english.js");
const bip32_1 = require("@scure/bip32");
const encoding_1 = require("./encoding");
const address_1 = require("./address");
/** Streembit coin type (unregistered; SLIP-44 registration is a prerequisite for device apps). */
exports.STREEMBIT_COIN_TYPE = 19640701;
/** 12 words = 128 bits of entropy. */
const MNEMONIC_STRENGTH = 128;
/** BIP44 path; change is always 0 (account model, no change addresses). */
function derivationPath(accountIndex, addressIndex) {
    if (!Number.isInteger(accountIndex) || accountIndex < 0 || !Number.isInteger(addressIndex) || addressIndex < 0) {
        throw new Error('Account and address indexes must be non-negative integers');
    }
    return `m/44'/${exports.STREEMBIT_COIN_TYPE}'/${accountIndex}'/0/${addressIndex}`;
}
/** New 12-word mnemonic from Web Crypto randomness. */
function generateMnemonic() {
    return bip39.generateMnemonic(english_js_1.wordlist, MNEMONIC_STRENGTH);
}
function validateMnemonic(mnemonic) {
    return bip39.validateMnemonic(normalizeMnemonic(mnemonic), english_js_1.wordlist);
}
/** Lower-cases and collapses whitespace so a pasted phrase validates like a typed one. */
function normalizeMnemonic(mnemonic) {
    return String(mnemonic || '').trim().toLowerCase().split(/\s+/).join(' ');
}
/**
 * BIP39 seed (64 bytes). PBKDF2 with 2048 rounds; derive once and keep the seed for the session rather
 * than calling this per address. The optional BIP39 passphrase is part of the seed, not of the wallet file.
 */
function seedFromMnemonic(mnemonic, passphrase = '') {
    const normalized = normalizeMnemonic(mnemonic);
    if (!bip39.validateMnemonic(normalized, english_js_1.wordlist)) {
        throw new Error('Invalid mnemonic phrase');
    }
    return bip39.mnemonicToSeedSync(normalized, passphrase);
}
/** Derive one account/address from a seed. */
function deriveFromSeed(seed, accountIndex = 0, addressIndex = 0) {
    const path = derivationPath(accountIndex, addressIndex);
    const root = bip32_1.HDKey.fromMasterSeed(seed);
    const node = root.derive(path);
    if (!node.privateKey || !node.publicKey) {
        throw new Error('Derived node has no private key');
    }
    const privateKey = (0, encoding_1.bytesToHex)(node.privateKey);
    const publicKey = (0, encoding_1.bytesToHex)(node.publicKey);
    const address = (0, address_1.createUserAddress)(node.publicKey);
    return { path, privateKey, publicKey, address };
}
/** Convenience for one-off use (restore flows, tests). For interactive use derive the seed once. */
function deriveAccount(mnemonic, accountIndex = 0, addressIndex = 0, passphrase = '') {
    return deriveFromSeed(seedFromMnemonic(mnemonic, passphrase), accountIndex, addressIndex);
}
/** Public-only derivation for display and address discovery: no private key is materialised. */
function deriveAddressOnly(seed, accountIndex = 0, addressIndex = 0) {
    const path = derivationPath(accountIndex, addressIndex);
    const node = bip32_1.HDKey.fromMasterSeed(seed).derive(path);
    if (!node.publicKey) {
        throw new Error('Derived node has no public key');
    }
    return { path, publicKey: (0, encoding_1.bytesToHex)(node.publicKey), address: (0, address_1.createUserAddress)(node.publicKey) };
}
