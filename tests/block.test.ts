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
            const h = v.block.header;
            const preimage = createCreatorSignaturePreimage(h.chainId, h.timestamp, v.block.transactions, vectors.creatorId, h.parentHash, h.attestation);
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

        // parentHash and the set attestation are under both the hash and the creator signature
        const otherParent = { ...signed, header: { ...signed.header, parentHash: 'ab'.repeat(32) } };
        assert.notEqual(computeBlockHash(otherParent), computeBlockHash(signed));
        assert.equal(verifyCreatorSignature(otherParent), false);
        const flipped = { ...signed.header.attestation, verdicts: signed.header.attestation.verdicts.map((d, i) => (i === 0 ? { ...d, valid: !d.valid } : d)) };
        const otherVerdict = { ...signed, header: { ...signed.header, attestation: flipped } };
        assert.notEqual(computeBlockHash(otherVerdict), computeBlockHash(signed));
        assert.equal(verifyCreatorSignature(otherVerdict), false);
        const otherAttester = { ...signed, header: { ...signed.header, attestation: { ...signed.header.attestation, signature: 'ff' + signed.header.attestation.signature.slice(2) } } };
        assert.notEqual(computeBlockHash(otherAttester), computeBlockHash(signed));
        assert.equal(verifyCreatorSignature(otherAttester), false);
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
