/**
 * Transaction building, signing, signing preimage, txid and attestation preimage.
 *
 * Chain state is passed in: the caller supplies chainId, version and the sender's next sequence, which a
 * wallet obtains from the Accountable Node API (./api). Contract calls also need the contract's codeHash,
 * sandboxHash and location from the API (the node reads them from acct/<cid>/meta).
 *
 * Signing preimage (serializeForSigning): the deterministic JSON of the transaction without signature,
 * validatorAttestations and fee, as hex.
 * txid: Blake2b-256 over chainId || timestamp || payload || JSON(signature) || salt || sequence.
 *
 * Multisig: getTxSignatures produces the detached signatures of several signers over the same preimage,
 * combineTxWithSigs puts collected signatures into the unsigned transaction, validateTransactionSignatures
 * applies the node's signature rules, pendingTxId is the identity of a transaction waiting for signatures.
 * The signature threshold and the policy of who may co-sign belong to the target contract and the node.
 *
 * The transaction types and the protocol constants come from streembit-bc-types; nothing is redeclared here.
 */
import { AssetId, ContractLocation } from 'streembit-bc-types';
import type { Transaction, TransferTransaction, ContractCallTransaction, TransactionSignature } from 'streembit-bc-types';
import type { Signer } from './signing';
export interface TransferParams {
    chainId: number;
    version: number;
    /** 'S' address */
    from: string;
    /** 'S' or 'C' address */
    to: string;
    /** decimal string */
    amount: string;
    /** SBRIT or SSC; the fee is charged in the same asset */
    asset: AssetId;
    /** the sender's next sequence (current + 1) */
    sequence: number;
    /** defaults to Date.now() */
    timestamp?: number;
    /** defaults to generateSalt(from) */
    salt?: string;
}
export interface ContractCallParams {
    chainId: number;
    version: number;
    /** 'S' address */
    from: string;
    /** contract 'C' address (also the cid) */
    to: string;
    method: string;
    /** method parameters, encoded as deterministic JSON hex; omit for a method without parameters (data is then ''); null encodes as JSON null */
    data?: Record<string, unknown> | null;
    /** from the contract metadata */
    codeHash: string;
    /** from the contract metadata */
    sandboxHash: string;
    /** from the contract metadata; defaults to ContractLocation.FS */
    location?: ContractLocation;
    /** defaults to '0' */
    amount?: string;
    sequence: number;
    timestamp?: number;
    salt?: string;
}
export interface SignatureValidationResult {
    valid: boolean;
    error?: string;
}
/** Positive decimal amount, optionally within [minAmount, maxAmount]. */
export declare function validateAmount(amount: string, options?: {
    minAmount?: string;
    maxAmount?: string;
}): boolean;
/** Fresh salt for a transaction: createSalt over the time, random bytes and the sender (32 hex chars). */
export declare function generateSalt(from: string): string;
/** Hex of the deterministic JSON of the transaction without signature, validatorAttestations and fee. */
export declare function serializeForSigning(tx: Transaction): string;
/** txid of a signed transaction. 64 hex chars. */
export declare function computeTxId(tx: Transaction): string;
/** Attestation preimage: Blake2b-256(chainId || txid || from || sequence) as hex. */
export declare function serializeForAttestation(tx: Pick<Transaction, 'chainId' | 'from' | 'sequence'>, txid: string): string;
/** Id of a transaction waiting for signatures: Blake2b-256 of the exact bytes the signers sign. */
export declare function pendingTxId(unsignedTx: ContractCallTransaction): string;
/** Unsigned transfer with the fee placeholder the node expects (fee.to is set by the engine). */
export declare function buildTransferTx(p: TransferParams): TransferTransaction;
/** Unsigned contract call, as the node's ContractCallTxCreator assembles it. */
export declare function buildContractCallTx(p: ContractCallParams): ContractCallTransaction;
/** Detached signatures of the signers over the transaction's signing preimage. */
export declare function getTxSignatures(tx: Transaction, signers: Signer[]): Promise<TransactionSignature[]>;
/** Sign the transaction with the signers and set tx.signature. As the node's creators, refuses when no signer controls tx.from. */
export declare function signTransaction<T extends Transaction>(tx: T, signers: Signer[]): Promise<T>;
/** The node's ownership rule: at least one signature's public key controls tx.from. False when there are no signatures. */
export declare function validateTransactionAddressOwnership(tx: Transaction): boolean;
/** Put collected signatures into an unsigned contract call. */
export declare function combineTxWithSigs(tx: ContractCallTransaction, signatures: TransactionSignature[]): ContractCallTransaction;
/** The node's signature rules: non-empty, at most MAX_ALLOWED_SIGNATURES, unique public keys, every signature verifies over the preimage. */
export declare function validateTransactionSignatures(tx: Transaction): SignatureValidationResult;
/** JSON the node accepts for submission (plain JSON.stringify). */
export declare function txToString(tx: Transaction): string;
//# sourceMappingURL=transaction.d.ts.map