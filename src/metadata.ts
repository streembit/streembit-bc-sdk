/**
 * Wallet file metadata: which addresses a wallet has handed out and their labels. Pure functions over the
 * metadata object of wallet.json; the wallet that owns the file decides how the file is stored.
 */

export interface WalletMetadata {
    /** what the sealed payload holds; written by createWalletFile and createKeyFile, never read by the node */
    kind?: 'mnemonic' | 'key';
    lastUsedAccount?: number;
    /** highest address index handed out, per account index */
    lastUsedAddress?: { [accountIndex: number]: number };
    addressLabels?: { [address: string]: string };
}

export interface KnownAddressIndex {
    accountIndex: number;
    addressIndex: number;
}

/** Address lookup searches past the last tracked index by this many addresses (BIP44 gap limit). */
export const ADDRESS_GAP_LIMIT = 20;

/** Account indexes tracked in the metadata; account 0 when none is tracked. */
export function trackedAccounts(metadata: WalletMetadata | undefined): number[] {
    const accounts = new Set<number>(Object.keys(metadata?.lastUsedAddress || {}).map(Number));
    if (accounts.size === 0) {
        accounts.add(0);
    }
    return Array.from(accounts).sort((a, b) => a - b);
}

/** Highest address index handed out for an account, or -1 when none. */
export function lastUsedIndex(metadata: WalletMetadata | undefined, accountIndex: number): number {
    const value = metadata?.lastUsedAddress?.[accountIndex];
    return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : -1;
}

/** All (account, index) pairs handed out so far, account 0 index 0 included. */
export function knownAddressIndexes(metadata: WalletMetadata | undefined): KnownAddressIndex[] {
    const result: KnownAddressIndex[] = [];
    for (const accountIndex of trackedAccounts(metadata)) {
        const highest = Math.max(0, lastUsedIndex(metadata, accountIndex));
        for (let addressIndex = 0; addressIndex <= highest; addressIndex++) {
            result.push({ accountIndex, addressIndex });
        }
    }
    return result;
}

/** Last index an address search should visit for an account: the last tracked index plus the gap limit. */
export function addressSearchBound(metadata: WalletMetadata | undefined, accountIndex: number): number {
    return Math.max(0, lastUsedIndex(metadata, accountIndex)) + ADDRESS_GAP_LIMIT;
}

/** The index the next address of an account gets, and the metadata recording it. */
export function withNextAddress(metadata: WalletMetadata | undefined, accountIndex: number): { metadata: WalletMetadata; addressIndex: number } {
    if (!Number.isInteger(accountIndex) || accountIndex < 0) {
        throw new Error('Account index must be a non-negative integer');
    }
    const addressIndex = lastUsedIndex(metadata, accountIndex) + 1;
    return {
        metadata: {
            ...(metadata || {}),
            lastUsedAddress: { ...(metadata?.lastUsedAddress || {}), [accountIndex]: addressIndex }
        },
        addressIndex
    };
}

/**
 * Metadata with a label set or, when the label is empty, removed. When the address's indexes are given,
 * the tracked range is extended to include it.
 */
export function withAddressLabel(metadata: WalletMetadata | undefined, address: string, label?: string, accountIndex?: number, addressIndex?: number): WalletMetadata {
    const updated: WalletMetadata = { ...(metadata || {}) };

    const lastUsed = { ...(metadata?.lastUsedAddress || {}) };
    if (accountIndex !== undefined && addressIndex !== undefined && addressIndex > lastUsedIndex(metadata, accountIndex)) {
        lastUsed[accountIndex] = addressIndex;
    }
    if (Object.keys(lastUsed).length > 0) {
        updated.lastUsedAddress = lastUsed;
    } else {
        delete updated.lastUsedAddress;
    }

    const labels = { ...(metadata?.addressLabels || {}) };
    const trimmed = label?.trim();
    if (trimmed) {
        labels[address] = trimmed;
    } else {
        delete labels[address];
    }
    if (Object.keys(labels).length > 0) {
        updated.addressLabels = labels;
    } else {
        delete updated.addressLabels;
    }

    return updated;
}

export function addressLabel(metadata: WalletMetadata | undefined, address: string): string | undefined {
    return metadata?.addressLabels?.[address];
}
