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
import type { Block, SetAttestation, Transaction } from 'streembit-bc-types';
/** Sum of the block's non-zero transaction amounts as a decimal string; "0" when every amount is zero. */
export declare function getTotalValue(block: Block): string;
/** Blake2b-256 of the deterministic JSON of the set attestation, signature included. 64 hex chars. */
export declare function computeAttestationHash(attestation: SetAttestation): string;
/** The bytes the creator signs the hash of: chainId || timestamp || txids || total value || creatorId || parentHash || attestation hash. */
export declare function createCreatorSignaturePreimage(chainId: number, timestamp: number, transactions: Transaction[], creatorId: string, parentHash: string, attestation: SetAttestation): Uint8Array;
/** Block hash: Blake2b-256 over the deterministic JSON of chainId, version, txRoot, timestamp, parentHash and attestation. 64 hex chars. */
export declare function computeBlockHash(block: Block): string;
/** A copy of the block with the creator approval set: creatorId, the creator's public key and its signature. */
export declare function signBlockAsCreator(block: Block, creatorId: string, publicKey: string, privateKey: string): Block;
/** True when the creator approval's signature verifies with its own creatorPubKey over the block's preimage. */
export declare function verifyCreatorSignature(block: Block): boolean;
//# sourceMappingURL=block.d.ts.map