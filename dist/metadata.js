"use strict";
/**
 * Wallet file metadata: which addresses a wallet has handed out and their labels. Pure functions over the
 * metadata object of wallet.json; the wallet that owns the file decides how the file is stored.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADDRESS_GAP_LIMIT = void 0;
exports.trackedAccounts = trackedAccounts;
exports.lastUsedIndex = lastUsedIndex;
exports.knownAddressIndexes = knownAddressIndexes;
exports.addressSearchBound = addressSearchBound;
exports.withNextAddress = withNextAddress;
exports.withAddressLabel = withAddressLabel;
exports.addressLabel = addressLabel;
/** Address lookup searches past the last tracked index by this many addresses (BIP44 gap limit). */
exports.ADDRESS_GAP_LIMIT = 20;
/** Account indexes tracked in the metadata; account 0 when none is tracked. */
function trackedAccounts(metadata) {
    const accounts = new Set(Object.keys(metadata?.lastUsedAddress || {}).map(Number));
    if (accounts.size === 0) {
        accounts.add(0);
    }
    return Array.from(accounts).sort((a, b) => a - b);
}
/** Highest address index handed out for an account, or -1 when none. */
function lastUsedIndex(metadata, accountIndex) {
    const value = metadata?.lastUsedAddress?.[accountIndex];
    return Number.isInteger(value) && value >= 0 ? value : -1;
}
/** All (account, index) pairs handed out so far, account 0 index 0 included. */
function knownAddressIndexes(metadata) {
    const result = [];
    for (const accountIndex of trackedAccounts(metadata)) {
        const highest = Math.max(0, lastUsedIndex(metadata, accountIndex));
        for (let addressIndex = 0; addressIndex <= highest; addressIndex++) {
            result.push({ accountIndex, addressIndex });
        }
    }
    return result;
}
/** Last index an address search should visit for an account: the last tracked index plus the gap limit. */
function addressSearchBound(metadata, accountIndex) {
    return Math.max(0, lastUsedIndex(metadata, accountIndex)) + exports.ADDRESS_GAP_LIMIT;
}
/** The index the next address of an account gets, and the metadata recording it. */
function withNextAddress(metadata, accountIndex) {
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
function withAddressLabel(metadata, address, label, accountIndex, addressIndex) {
    const updated = { ...(metadata || {}) };
    const lastUsed = { ...(metadata?.lastUsedAddress || {}) };
    if (accountIndex !== undefined && addressIndex !== undefined && addressIndex > lastUsedIndex(metadata, accountIndex)) {
        lastUsed[accountIndex] = addressIndex;
    }
    if (Object.keys(lastUsed).length > 0) {
        updated.lastUsedAddress = lastUsed;
    }
    else {
        delete updated.lastUsedAddress;
    }
    const labels = { ...(metadata?.addressLabels || {}) };
    const trimmed = label?.trim();
    if (trimmed) {
        labels[address] = trimmed;
    }
    else {
        delete labels[address];
    }
    if (Object.keys(labels).length > 0) {
        updated.addressLabels = labels;
    }
    else {
        delete updated.addressLabels;
    }
    return updated;
}
function addressLabel(metadata, address) {
    return metadata?.addressLabels?.[address];
}
