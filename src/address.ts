/**
 * Streembit addresses: derivation, validation and the contract identity.
 *
 * User address     = Base58Check(ADDRESS_PREFIX_USER || HASH160(compressed public key))      -> starts with 'S'
 * Contract address = Base58Check(ADDRESS_PREFIX_CONTRACT || HASH160(contract preimage))      -> starts with 'C'
 * The version bytes come from streembit-bc-types.
 */

import { ADDRESS_PREFIX_USER, ADDRESS_PREFIX_CONTRACT } from 'streembit-bc-types';
import { hash160 } from './hashing';
import { base58Decode, base58checkDecode, base58checkEncode, base58checkDecodeWithVersion } from './base58';
import { hexToBytes, utf8ToBytes, concat } from './encoding';
import { bech32, bech32m } from '@scure/base';

export type AddressType = 'user' | 'contract';

/** User address from a public key (33-byte compressed or 65-byte uncompressed; wallets always use compressed). */
export function createUserAddress(publicKey: Uint8Array | string): string {
    const bytes = typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey;
    if (bytes.length !== 33 && bytes.length !== 65) {
        throw new Error('Invalid public key length');
    }
    return base58checkEncode(ADDRESS_PREFIX_USER, hash160(bytes));
}

/**
 * Contract address of a deployed contract: HASH160(filePath || deployerPubKey || chainId), chainId as
 * 4 bytes big-endian. The file path is the contract's canonical path under the node's contract folder,
 * so a contract keeps its identity across code upgrades.
 */
export function createContractAddress(filePath: string, deployerPubKey: string, chainId: number): string {
    if (!filePath || filePath.trim().length === 0) {
        throw new Error('File path is required to derive contract address');
    }
    if (!filePath.startsWith('dist/node/smart-contracts/')) {
        throw new Error(`Contract path must start with dist/node/smart-contracts/ - got: ${filePath}`);
    }
    if (!deployerPubKey || deployerPubKey.length !== 66) {
        throw new Error('Deployer public key must be 66 hex characters (33 bytes compressed)');
    }
    if (!Number.isInteger(chainId) || chainId < 0 || chainId > 0xffffffff) {
        throw new Error('chainId must be an unsigned 32-bit integer');
    }
    const chainIdBytes = new Uint8Array(4);
    new DataView(chainIdBytes.buffer).setUint32(0, chainId, false);
    const preimage = concat(utf8ToBytes(filePath), hexToBytes(deployerPubKey), chainIdBytes);
    return base58checkEncode(ADDRESS_PREFIX_CONTRACT, hash160(preimage));
}

/**
 * Contract address from a 32-byte contract id: HASH160("SB-CID" || chainId || cid32), chainId as
 * 4 bytes little-endian.
 */
export function encodeContractAddress(chainId: number, cid: Uint8Array): string {
    if (!Number.isInteger(chainId) || chainId < 0 || chainId > 0xffffffff) {
        throw new Error('chainId must be an unsigned 32-bit integer');
    }
    const chainIdBytes = new Uint8Array(4);
    new DataView(chainIdBytes.buffer).setUint32(0, chainId, true);
    const preimage = concat(utf8ToBytes('SB-CID'), chainIdBytes, cid);
    return base58checkEncode(ADDRESS_PREFIX_CONTRACT, hash160(preimage));
}

/** Base58Check with a known version byte and a 20-byte payload. */
export function validateAddress(address: string): boolean {
    try {
        const rawData = base58Decode(address);
        if (rawData.length < 25) return false;
        const version = rawData[0];
        if (version !== ADDRESS_PREFIX_USER && version !== ADDRESS_PREFIX_CONTRACT) return false;
        const payload = base58checkDecode(address);
        return payload.length === 20;
    } catch {
        return false;
    }
}

export function isUserAddress(address: string): boolean {
    try {
        const rawData = base58Decode(address);
        if (rawData.length < 25) return false;
        if (rawData[0] !== ADDRESS_PREFIX_USER) return false;
        const payload = base58checkDecode(address);
        return payload.length === 20;
    } catch {
        return false;
    }
}

export function isContractAddress(address: string): boolean {
    try {
        const rawData = base58Decode(address);
        if (rawData.length < 25) return false;
        if (rawData[0] !== ADDRESS_PREFIX_CONTRACT) return false;
        const payload = base58checkDecode(address);
        return payload.length === 20;
    } catch {
        return false;
    }
}

/** Type and HASH160 payload of a valid address; throws on an invalid one. */
export function decodeAddress(address: string): { type: AddressType; hash: Uint8Array } {
    const { version, payload } = base58checkDecodeWithVersion(address);
    if (payload.length !== 20) {
        throw new Error('Invalid address payload length');
    }
    if (version === ADDRESS_PREFIX_USER) {
        return { type: 'user', hash: payload };
    }
    if (version === ADDRESS_PREFIX_CONTRACT) {
        return { type: 'contract', hash: payload };
    }
    throw new Error(`Unknown address version: 0x${version.toString(16)}`);
}

export function getAddressType(address: string): AddressType | 'invalid' {
    try {
        return decodeAddress(address).type;
    } catch {
        return 'invalid';
    }
}

/**
 * True when the compressed public key (hex) derives to the address. The node enforces the same rule on
 * every transaction, so a wallet checks it before signing.
 */
export function publicKeyOwnsAddress(address: string, publicKeyHex: string): boolean {
    if (!publicKeyHex || publicKeyHex.length !== 66) {
        return false;
    }
    try {
        return createUserAddress(publicKeyHex) === address;
    } catch {
        return false;
    }
}

// ============================================================================
// Bitcoin address format check, for the external payment contract (the Accountable Node settles SBRIT
// sales against Bitcoin payments). Syntax only: a well-formed address of the given network, nothing about
// who controls it. Legacy addresses are Base58Check with the network's P2PKH or P2SH version byte and a
// 20-byte payload (BIP 13); segwit addresses are bech32 for witness version 0 (BIP 173) and bech32m for
// versions 1 to 16 (BIP 350).
// ============================================================================

export type BitcoinNetwork = 'mainnet' | 'testnet' | 'regtest';

const BITCOIN_LEGACY_VERSIONS: Record<BitcoinNetwork, number[]> = {
    mainnet: [0x00, 0x05],
    testnet: [0x6f, 0xc4],
    regtest: [0x6f, 0xc4]
};

const BITCOIN_HRP: Record<BitcoinNetwork, string> = {
    mainnet: 'bc',
    testnet: 'tb',
    regtest: 'bcrt'
};

function isSegwitAddress(address: string, hrp: string): boolean {
    const lower = address.toLowerCase();
    if (address !== lower && address !== address.toUpperCase()) {
        return false;
    }
    if (!lower.startsWith(`${hrp}1`)) {
        return false;
    }
    let version: number;
    let program: Uint8Array;
    try {
        const decoded = bech32.decode(lower, 90);
        if (decoded.prefix !== hrp || decoded.words.length === 0) {
            return false;
        }
        version = decoded.words[0];
        if (version !== 0) {
            return false;
        }
        program = bech32.fromWords(decoded.words.slice(1));
        return program.length === 20 || program.length === 32;
    } catch {
        // not bech32: a witness version above 0 is bech32m
    }
    try {
        const decoded = bech32m.decode(lower, 90);
        if (decoded.prefix !== hrp || decoded.words.length === 0) {
            return false;
        }
        version = decoded.words[0];
        if (version < 1 || version > 16) {
            return false;
        }
        program = bech32m.fromWords(decoded.words.slice(1));
        return program.length >= 2 && program.length <= 40;
    } catch {
        return false;
    }
}

/** True when the string is a well-formed Bitcoin address of the network: legacy Base58Check, bech32 or bech32m. */
export function isBitcoinAddress(address: string, network: BitcoinNetwork): boolean {
    if (typeof address !== 'string' || address.length === 0 || address.length > 90) {
        return false;
    }
    const hrp = BITCOIN_HRP[network];
    const versions = BITCOIN_LEGACY_VERSIONS[network];
    if (!hrp || !versions) {
        return false;
    }
    if (address.toLowerCase().startsWith(`${hrp}1`)) {
        return isSegwitAddress(address, hrp);
    }
    try {
        const { version, payload } = base58checkDecodeWithVersion(address);
        return payload.length === 20 && versions.includes(version);
    } catch {
        return false;
    }
}
