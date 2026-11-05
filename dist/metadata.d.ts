/**
 * Wallet file metadata: which addresses a wallet has handed out and their labels. Pure functions over the
 * metadata object of wallet.json; the wallet that owns the file decides how the file is stored.
 */
export interface WalletMetadata {
    /** what the sealed payload holds; written by createWalletFile and createKeyFile, never read by the node */
    kind?: 'mnemonic' | 'key';
    lastUsedAccount?: number;
    /** highest address index handed out, per account index */
    lastUsedAddress?: {
        [accountIndex: number]: number;
    };
    addressLabels?: {
        [address: string]: string;
    };
}
export interface KnownAddressIndex {
    accountIndex: number;
    addressIndex: number;
}
/** Address lookup searches past the last tracked index by this many addresses (BIP44 gap limit). */
export declare const ADDRESS_GAP_LIMIT = 20;
/** Account indexes tracked in the metadata; account 0 when none is tracked. */
export declare function trackedAccounts(metadata: WalletMetadata | undefined): number[];
/** Highest address index handed out for an account, or -1 when none. */
export declare function lastUsedIndex(metadata: WalletMetadata | undefined, accountIndex: number): number;
/** All (account, index) pairs handed out so far, account 0 index 0 included. */
export declare function knownAddressIndexes(metadata: WalletMetadata | undefined): KnownAddressIndex[];
/** Last index an address search should visit for an account: the last tracked index plus the gap limit. */
export declare function addressSearchBound(metadata: WalletMetadata | undefined, accountIndex: number): number;
/** The index the next address of an account gets, and the metadata recording it. */
export declare function withNextAddress(metadata: WalletMetadata | undefined, accountIndex: number): {
    metadata: WalletMetadata;
    addressIndex: number;
};
/**
 * Metadata with a label set or, when the label is empty, removed. When the address's indexes are given,
 * the tracked range is extended to include it.
 */
export declare function withAddressLabel(metadata: WalletMetadata | undefined, address: string, label?: string, accountIndex?: number, addressIndex?: number): WalletMetadata;
export declare function addressLabel(metadata: WalletMetadata | undefined, address: string): string | undefined;
//# sourceMappingURL=metadata.d.ts.map