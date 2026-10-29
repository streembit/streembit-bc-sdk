"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTotalValue = getTotalValue;
exports.computeAttestationHash = computeAttestationHash;
exports.createCreatorSignaturePreimage = createCreatorSignaturePreimage;
exports.computeBlockHash = computeBlockHash;
exports.signBlockAsCreator = signBlockAsCreator;
exports.verifyCreatorSignature = verifyCreatorSignature;
const decimal_1 = require("./decimal");
const encoding_1 = require("./encoding");
const hashing_1 = require("./hashing");
const signing_1 = require("./signing");
const transaction_1 = require("./transaction");
function getTotalValueFromTransactions(transactions) {
    let total = new decimal_1.Dec(0);
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
function getTotalValue(block) {
    return getTotalValueFromTransactions(block.transactions);
}
/** Blake2b-256 of the deterministic JSON of the set attestation, signature included. 64 hex chars. */
function computeAttestationHash(attestation) {
    return (0, encoding_1.bytesToHex)((0, hashing_1.blake2b256)((0, encoding_1.encodeDeterministicJSON)(attestation)));
}
/** The bytes the creator signs the hash of: chainId || timestamp || txids || total value || creatorId || parentHash || attestation hash. */
function createCreatorSignaturePreimage(chainId, timestamp, transactions, creatorId, parentHash, attestation) {
    const txsConcatId = transactions.map(tx => (0, transaction_1.computeTxId)(tx)).join('');
    const totalValue = getTotalValueFromTransactions(transactions);
    return (0, encoding_1.concat)((0, encoding_1.encodeU32LE)(chainId), (0, encoding_1.encodeU64LE)(BigInt(timestamp)), (0, encoding_1.utf8ToBytes)(txsConcatId), (0, encoding_1.utf8ToBytes)(totalValue), (0, encoding_1.utf8ToBytes)(creatorId), (0, encoding_1.hexToBytes)(parentHash), (0, encoding_1.hexToBytes)(computeAttestationHash(attestation)));
}
/** Block hash: Blake2b-256 over the deterministic JSON of chainId, version, txRoot, timestamp, parentHash and attestation. 64 hex chars. */
function computeBlockHash(block) {
    const obj = {
        chainId: block.header.chainId,
        version: block.header.version,
        txRoot: block.header.txRoot,
        timestamp: block.header.timestamp,
        parentHash: block.header.parentHash,
        attestation: block.header.attestation
    };
    return (0, encoding_1.bytesToHex)((0, hashing_1.blake2b256)((0, encoding_1.encodeDeterministicJSON)(obj)));
}
function creatorSignatureHashHex(block, creatorId) {
    const h = block.header;
    return (0, encoding_1.bytesToHex)((0, hashing_1.blake2b256)(createCreatorSignaturePreimage(h.chainId, h.timestamp, block.transactions, creatorId, h.parentHash, h.attestation)));
}
/** A copy of the block with the creator approval set: creatorId, the creator's public key and its signature. */
function signBlockAsCreator(block, creatorId, publicKey, privateKey) {
    const signature = (0, signing_1.sign)(creatorSignatureHashHex(block, creatorId), privateKey);
    const creatorApproval = { creatorId, creatorPubKey: publicKey, signature };
    const header = { ...block.header, creatorApproval };
    return { header, transactions: block.transactions };
}
/** True when the creator approval's signature verifies with its own creatorPubKey over the block's preimage. */
function verifyCreatorSignature(block) {
    const approval = block.header.creatorApproval;
    if (!approval || !approval.signature || !approval.creatorPubKey) {
        return false;
    }
    return (0, signing_1.verify)(creatorSignatureHashHex(block, approval.creatorId), approval.signature, approval.creatorPubKey);
}
