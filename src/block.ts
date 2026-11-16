/**
 * Block hash and the creator's block signature, as the node's core/block/Block.ts defines them.
 *
 * Block hash: Blake2b-256 of the deterministic JSON of chainId, version, txRoot, timestamp, parentHash and the
 * set attestation. The creator approval is excluded, so the hash is fixed before the block is signed.
 * Creator signature preimage: chainId (u32 LE) || timestamp (u64 LE) || concatenated txids || total value
 * || creatorId || parentHash (32 bytes) || attestation hash (32 bytes); the creator signs Blake2b-256 of it
 * with the SDK's sign(), so the signature is DER over SHA-256 of that hash.
 * Attestation hash: Blake2b-256 of the deterministic JSON of the header's set attestation, signature included,
 * so the creator's signature covers the validator's verdicts and signature.
 * Total value: the sum of the non-zero transaction amounts as a decimal string, "0" when there is none.
 *
 * The Merkle transaction root is not here; the node computes and verifies it. The set attestation preimage
 * the validator signs is the node's, built from the SDK primitives.
 */

import type { Block, BlockHeader, CreatorApproval, SetAttestation, Transaction } from 'streembit-bc-types';
import { Dec } from './decimal';
import { encodeDeterministicJSON, bytesToHex, hexToBytes, concat, utf8ToBytes, encodeU32LE, encodeU64LE } from './encoding';
import { blake2b256 } from './hashing';
import { sign, verify } from './signing';
import { computeTxId } from './transaction';

function getTotalValueFromTransactions(transactions: Transaction[]): string {
    let total = new Dec(0);
    let any = false;
    for (const tx of transactions) {
        if (tx.amount && tx.amount !== '0') {
            total = total.plus(tx.amount);
            any = true;
        }
    }
    return any ? total.toString() : '0';
}

/** Sum of the block's non-zero transaction amounts as a decimal string; "0" when every amount is zero. */
export function getTotalValue(block: Block): string {
    return getTotalValueFromTransactions(block.transactions);
}

/** Blake2b-256 of the deterministic JSON of the set attestation, signature included. 64 hex chars. */
export function computeAttestationHash(attestation: SetAttestation): string {
    return bytesToHex(blake2b256(encodeDeterministicJSON(attestation)));
}

/** The bytes the creator signs the hash of: chainId || timestamp || txids || total value || creatorId || parentHash || attestation hash. */
export function createCreatorSignaturePreimage(chainId: number, timestamp: number, transactions: Transaction[], creatorId: string, parentHash: string, attestation: SetAttestation): Uint8Array {
    const txsConcatId = transactions.map(tx => computeTxId(tx)).join('');
    const totalValue = getTotalValueFromTransactions(transactions);
    return concat(
        encodeU32LE(chainId),
        encodeU64LE(BigInt(timestamp)),
        utf8ToBytes(txsConcatId),
        utf8ToBytes(totalValue),
        utf8ToBytes(creatorId),
        hexToBytes(parentHash),
        hexToBytes(computeAttestationHash(attestation))
    );
}

/** Block hash: Blake2b-256 over the deterministic JSON of chainId, version, txRoot, timestamp, parentHash and attestation. 64 hex chars. */
export function computeBlockHash(block: Block): string {
    const obj = {
        chainId: block.header.chainId,
        version: block.header.version,
        txRoot: block.header.txRoot,
        timestamp: block.header.timestamp,
        parentHash: block.header.parentHash,
        attestation: block.header.attestation
    };
    return bytesToHex(blake2b256(encodeDeterministicJSON(obj)));
}

function creatorSignatureHashHex(block: Block, creatorId: string): string {
    const h = block.header;
    return bytesToHex(blake2b256(createCreatorSignaturePreimage(h.chainId, h.timestamp, block.transactions, creatorId, h.parentHash, h.attestation)));
}

/** A copy of the block with the creator approval set: creatorId, the creator's public key and its signature. */
export function signBlockAsCreator(block: Block, creatorId: string, publicKey: string, privateKey: string): Block {
    const signature = sign(creatorSignatureHashHex(block, creatorId), privateKey);
    const creatorApproval: CreatorApproval = { creatorId, creatorPubKey: publicKey, signature };
    const header: BlockHeader = { ...block.header, creatorApproval };
    return { header, transactions: block.transactions };
}

/** True when the creator approval's signature verifies with its own creatorPubKey over the block's preimage. */
export function verifyCreatorSignature(block: Block): boolean {
    const approval = block.header.creatorApproval;
    if (!approval || !approval.signature || !approval.creatorPubKey) {
        return false;
    }
    return verify(creatorSignatureHashHex(block, approval.creatorId), approval.signature, approval.creatorPubKey);
}
