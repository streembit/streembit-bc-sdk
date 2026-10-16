/**
 * Transaction building, signing preimage, txid and attestation preimage.
 *
 * Chain state is passed in: the caller supplies chainId, version and the sender's next sequence, which a
 * wallet obtains from the Accountable Node API (./api). Contract calls also need the contract's codeHash,
 * sandboxHash and location from the API (the node reads them from acct/<cid>/meta).
 *
 * Signing preimage (serializeForSigning): the deterministic JSON of the transaction without signature,
 * validatorAttestations and fee, as hex.
 * txid: Blake2b-256 over chainId || timestamp || payload || JSON(signature) || salt || sequence.
 *
 * The transaction types and the protocol constants come from streembit-bc-types; nothing is redeclared here.
 */
import { ContractLocation } from 'streembit-bc-types';
import type { Transaction, TransferTransaction, ContractCallTransaction } from 'streembit-bc-types';
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
    /** identifier matching /^[a-zA-Z_][a-zA-Z0-9_]*$/ */
    method: string;
    /** method parameters, encoded as deterministic JSON hex; omit for a method without parameters (data is then '') */
    data?: Record<string, unknown>;
    /** from the contract metadata */
    codeHash: string;
    /** from the contract metadata */
    sandboxHash: string;
    /** defaults to ContractLocation.FS */
    location?: ContractLocation;
    /** defaults to '0' */
    amount?: string;
    sequence: number;
    timestamp?: number;
    salt?: string;
}
export declare function validateAmount(amount: string): boolean;
/** Fresh salt for a transaction: createSalt over the time, random bytes and the sender (32 hex chars). */
export declare function generateSalt(from: string): string;
/** Hex of the deterministic JSON of the transaction without signature, validatorAttestations and fee. */
export declare function serializeForSigning(tx: Transaction): string;
/** txid of a signed transaction. 64 hex chars. */
export declare function computeTxId(tx: Transaction): string;
/** Attestation preimage: Blake2b-256(chainId || txid || from || sequence) as hex. */
export declare function serializeForAttestation(tx: Pick<Transaction, 'chainId' | 'from' | 'sequence'>, txid: string): string;
/** Unsigned SBRIT transfer with the fee placeholder the node expects (fee.to is set by the engine). */
export declare function buildTransferTx(p: TransferParams): TransferTransaction;
/** Unsigned single-signer contract call. */
export declare function buildContractCallTx(p: ContractCallParams): ContractCallTransaction;
/**
 * Sign an unsigned transfer or contract call with a signer. Checks that the signer controls tx.from before
 * signing, as the node will. Returns the same object with signature set.
 */
export declare function signTransaction<T extends TransferTransaction | ContractCallTransaction>(tx: T, signer: Pick<Signer, 'publicKey' | 'sign'>): Promise<T>;
/** JSON the node accepts for submission (plain JSON.stringify). */
export declare function txToString(tx: Transaction): string;
//# sourceMappingURL=transaction.d.ts.map