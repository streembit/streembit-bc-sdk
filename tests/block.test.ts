// Block hash and creator signature against vectors produced by the node's core/block/Block.ts
// (tests/block-vectors.json). The tiny and huge cases carry amounts that decimal.js would print in exponent
// form under its default toExpNeg/toExpPos, so they fail if the decimal configuration regresses.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Block } from 'streembit-bc-types';
import { computeBlockHash, createCreatorSignaturePreimage, getTotalValue, signBlockAsCreator, verifyCreatorSignature } from '../src/block';
import { bytesToHex, blake2b256, encodeU32LE, encodeU64LE } from '../src/index';
import vectors from './block-vectors.json';

interface Vector {
    amounts: string[];
    totalValue: string;
    preimageHex: string;
    preimageHashHex: string;
    blockHash: string;
    signature: string;
    block: Block;
}

const cases = vectors.cases as unknown as Record<string, Vector>;

describe('block hash and creator signature', () => {
    for (const [name, v] of Object.entries(cases)) {
        it(`${name}: total value, preimage, hash and the node's signature match`, () => {
            assert.equal(getTotalValue(v.block), v.totalValue);
            const preimage = createCreatorSignaturePreimage(v.block.header.chainId, v.block.header.timestamp, v.block.transactions, vectors.creatorId);
            assert.equal(bytesToHex(preimage), v.preimageHex);
            assert.equal(bytesToHex(blake2b256(preimage)), v.preimageHashHex);
            assert.equal(computeBlockHash(v.block), v.blockHash);
            assert.equal(v.block.header.creatorApproval.signature, v.signature);
            assert.equal(verifyCreatorSignature(v.block), true);
        });
    }

    it('signs a block so that verifyCreatorSignature accepts it, and rejects tampering', () => {
        const unsigned: Block = { ...cases.plain.block, header: { ...cases.plain.block.header, creatorApproval: { creatorId: '', creatorPubKey: '', signature: '' } } };
        const signed = signBlockAsCreator(unsigned, vectors.creatorId, vectors.publicKey, vectors.privateKey);
        assert.equal(signed.header.creatorApproval.creatorId, vectors.creatorId);
        assert.equal(signed.header.creatorApproval.creatorPubKey, vectors.publicKey);
        assert.equal(verifyCreatorSignature(signed), true);
        assert.equal(computeBlockHash(signed), computeBlockHash(unsigned), 'the creator approval is not part of the hash');

        const otherAmount = { ...signed, transactions: [{ ...signed.transactions[0], amount: '6' }, ...signed.transactions.slice(1)] } as Block;
        assert.equal(verifyCreatorSignature(otherAmount), false);
        const otherCreator = { ...signed, header: { ...signed.header, creatorApproval: { ...signed.header.creatorApproval, creatorId: 'someone' } } };
        assert.equal(verifyCreatorSignature(otherCreator), false);
        const otherKey = { ...signed, header: { ...signed.header, creatorApproval: { ...signed.header.creatorApproval, creatorPubKey: '02' + 'ab'.repeat(32) } } };
        assert.equal(verifyCreatorSignature(otherKey), false);
        assert.equal(verifyCreatorSignature(unsigned), false);
    });

    it('encodes little-endian integers as the node does', () => {
        assert.equal(bytesToHex(encodeU32LE(0x12345678)), '78563412');
        assert.equal(bytesToHex(encodeU32LE(1337)), '39050000');
        assert.equal(bytesToHex(encodeU64LE(BigInt('0x123456789ABCDEF0'))), 'f0debc9a78563412');
        assert.throws(() => encodeU32LE(-1), /valid u32/);
        assert.throws(() => encodeU32LE(0x100000000), /valid u32/);
        assert.throws(() => encodeU64LE(BigInt(-1)), /valid u64/);
    });
});
