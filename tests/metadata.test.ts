import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as M from '../src/metadata';

describe('wallet metadata', () => {
    it('an empty metadata tracks account 0 index 0 only', () => {
        assert.deepEqual(M.trackedAccounts(undefined), [0]);
        assert.deepEqual(M.trackedAccounts({}), [0]);
        assert.equal(M.lastUsedIndex({}, 0), -1);
        assert.deepEqual(M.knownAddressIndexes({}), [{ accountIndex: 0, addressIndex: 0 }]);
        assert.equal(M.addressSearchBound({}, 0), M.ADDRESS_GAP_LIMIT);
    });

    it('hands out consecutive indexes per account and records the last used account', () => {
        const first = M.withNextAddress(undefined, 0);
        assert.equal(first.addressIndex, 0);
        const second = M.withNextAddress(first.metadata, 0);
        assert.equal(second.addressIndex, 1);
        const other = M.withNextAddress(second.metadata, 3);
        assert.equal(other.addressIndex, 0);
        assert.equal(other.metadata.lastUsedAccount, 3);
        assert.deepEqual(other.metadata.lastUsedAddress, { 0: 1, 3: 0 });
        assert.deepEqual(M.trackedAccounts(other.metadata), [0, 3]);
        assert.deepEqual(M.knownAddressIndexes(other.metadata), [
            { accountIndex: 0, addressIndex: 0 },
            { accountIndex: 0, addressIndex: 1 },
            { accountIndex: 3, addressIndex: 0 }
        ]);
        assert.equal(M.addressSearchBound(other.metadata, 0), 1 + M.ADDRESS_GAP_LIMIT);
        assert.throws(() => M.withNextAddress(other.metadata, -1));
    });

    it('sets, reads and removes labels and extends the tracked range when indexes are given', () => {
        const labelled = M.withAddressLabel(undefined, 'SAddress', '  savings  ', 0, 4);
        assert.equal(M.addressLabel(labelled, 'SAddress'), 'savings');
        assert.deepEqual(labelled.lastUsedAddress, { 0: 4 });
        const kept = M.withAddressLabel(labelled, 'SAddress', 'savings', 0, 2);
        assert.deepEqual(kept.lastUsedAddress, { 0: 4 });
        const cleared = M.withAddressLabel(kept, 'SAddress', '');
        assert.equal(M.addressLabel(cleared, 'SAddress'), undefined);
        assert.equal(cleared.addressLabels, undefined);
        assert.deepEqual(cleared.lastUsedAddress, { 0: 4 });
        const none = M.withAddressLabel({}, 'SAddress');
        assert.deepEqual(none, {});
    });

    it('does not mutate its input', () => {
        const input: M.WalletMetadata = { lastUsedAddress: { 0: 1 }, addressLabels: { SAddress: 'x' } };
        const snapshot = JSON.stringify(input);
        M.withNextAddress(input, 0);
        M.withAddressLabel(input, 'SAddress', '');
        assert.equal(JSON.stringify(input), snapshot);
    });
});
