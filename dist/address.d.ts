/**
 * Streembit addresses: derivation, validation and the contract identity.
 *
 * User address     = Base58Check(ADDRESS_PREFIX_USER || HASH160(compressed public key))      -> starts with 'S'
 * Contract address = Base58Check(ADDRESS_PREFIX_CONTRACT || HASH160(contract preimage))      -> starts with 'C'
 * The version bytes come from streembit-bc-types.
 */
export type AddressType = 'user' | 'contract';
/** User address from a public key (33-byte compressed or 65-byte uncompressed; wallets always use compressed). */
export declare function createUserAddress(publicKey: Uint8Array | string): string;
/**
 * Contract address of a deployed contract: HASH160(filePath || deployerPubKey || chainId), chainId as
 * 4 bytes big-endian. The file path is the contract's canonical path under the node's contract folder,
 * so a contract keeps its identity across code upgrades.
 */
export declare function createContractAddress(filePath: string, deployerPubKey: string, chainId: number): string;
/**
 * Contract address from a 32-byte contract id: HASH160("SB-CID" || chainId || cid32), chainId as
 * 4 bytes little-endian.
 */
export declare function encodeContractAddress(chainId: number, cid: Uint8Array): string;
/** Base58Check with a known version byte and a 20-byte payload. */
export declare function validateAddress(address: string): boolean;
export declare function isUserAddress(address: string): boolean;
export declare function isContractAddress(address: string): boolean;
/** Type and HASH160 payload of a valid address; throws on an invalid one. */
export declare function decodeAddress(address: string): {
    type: AddressType;
    hash: Uint8Array;
};
export declare function getAddressType(address: string): AddressType | 'invalid';
/**
 * True when the compressed public key (hex) derives to the address. The node enforces the same rule on
 * every transaction, so a wallet checks it before signing.
 */
export declare function publicKeyOwnsAddress(address: string, publicKeyHex: string): boolean;
export type BitcoinNetwork = 'mainnet' | 'testnet' | 'regtest';
/** True when the string is a well-formed Bitcoin address of the network: legacy Base58Check, bech32 or bech32m. */
export declare function isBitcoinAddress(address: string, network: BitcoinNetwork): boolean;
//# sourceMappingURL=address.d.ts.map