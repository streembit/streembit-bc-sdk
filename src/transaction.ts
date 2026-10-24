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

import type { Decimal } from 'decimal.js';
import { Dec } from './decimal';
import { TxType, AssetId, SBRIT_FEE_AMOUNT, SSC_FEE_AMOUNT, ContractLocation, MAX_ALLOWED_SIGNATURES } from 'streembit-bc-types';
import type { Transaction, TransferTransaction, ContractCallTransaction, TransactionSignature } from 'streembit-bc-types';
import { encodeDeterministicJSON, bytesToHex, concat, utf8ToBytes, hexToBytes, randomBytes } from './encoding';
import { blake2b256, createSalt } from './hashing';
import { publicKeyOwnsAddress } from './address';
import { verify } from './signing';
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
export function validateAmount(amount: string, options?: { minAmount?: string; maxAmount?: string }): boolean {
    try {
        const amt = new Dec(amount);
        if (amt.isNegative() || amt.isZero()) {
            return false;
        }
        if (options?.minAmount) {
            if (amt.lessThan(new Dec(options.minAmount))) {
                return false;
            }
        }
        if (options?.maxAmount) {
            if (amt.greaterThan(new Dec(options.maxAmount))) {
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

/** Fresh salt for a transaction: createSalt over the time, random bytes and the sender (32 hex chars). */
export function generateSalt(from: string): string {
    return createSalt(JSON.stringify({ t: Date.now(), r: bytesToHex(randomBytes(16)), from }));
}

/** Hex of the deterministic JSON of the transaction without signature, validatorAttestations and fee. */
export function serializeForSigning(tx: Transaction): string {
    const txCopy: Record<string, unknown> = { ...tx };
    delete txCopy.signature;
    delete txCopy.validatorAttestations;
    delete txCopy.fee;
    return encodeDeterministicJSON(txCopy, { asHex: true });
}

function txIdPayload(tx: Transaction): string {
    const payload: Record<string, unknown> = {
        version: tx.version,
        chainid: tx.chainId,
        type: tx.type,
        from: tx.from,
        to: tx.to,
        amount: tx.amount,
        asset: tx.asset
    };
    if (tx.type === TxType.CONTRACT_CALL) {
        const callTx = tx as ContractCallTransaction;
        payload.method = callTx.method;
        payload.data = callTx.data;
    }
    return JSON.stringify(payload, Object.keys(payload).sort());
}

/** txid of a signed transaction. 64 hex chars. */
export function computeTxId(tx: Transaction): string {
    const image = concat(
        utf8ToBytes(String(tx.chainId)),
        utf8ToBytes(String(tx.timestamp)),
        utf8ToBytes(txIdPayload(tx)),
        utf8ToBytes(JSON.stringify(tx.signature)),
        utf8ToBytes(tx.salt),
        utf8ToBytes(String(tx.sequence))
    );
    return bytesToHex(blake2b256(image));
}

/** Attestation preimage: Blake2b-256(chainId || txid || from || sequence) as hex. */
export function serializeForAttestation(tx: Pick<Transaction, 'chainId' | 'from' | 'sequence'>, txid: string): string {
    const preimage = concat(
        utf8ToBytes(String(tx.chainId)),
        hexToBytes(txid),
        utf8ToBytes(tx.from),
        utf8ToBytes(String(tx.sequence))
    );
    return bytesToHex(blake2b256(preimage));
}

/** Id of a transaction waiting for signatures: Blake2b-256 of the exact bytes the signers sign. */
export function pendingTxId(unsignedTx: ContractCallTransaction): string {
    return bytesToHex(blake2b256(hexToBytes(serializeForSigning(unsignedTx))));
}

/** Unsigned transfer with the fee placeholder the node expects (fee.to is set by the engine). */
export function buildTransferTx(p: TransferParams): TransferTransaction {
    if (p.asset !== AssetId.SBRIT && p.asset !== AssetId.SSC) {
        throw new Error('Invalid or missing asset');
    }
    if (!p.from || p.from.length === 0) {
        throw new Error('Invalid or missing from field');
    }
    if (!p.to || p.to.length === 0) {
        throw new Error('Invalid or missing to field');
    }
    if (!p.amount || p.amount.length === 0) {
        throw new Error('Invalid or missing amount field');
    }
    if (!validateAmount(p.amount)) {
        throw new Error('Amount must be a positive number in string format');
    }
    return {
        version: p.version,
        chainId: p.chainId,
        type: TxType.TRANSFER,
        from: p.from,
        to: p.to,
        amount: p.amount,
        asset: p.asset,
        sequence: p.sequence,
        timestamp: p.timestamp ?? Date.now(),
        salt: p.salt ?? generateSalt(p.from),
        fee: { amount: p.asset === AssetId.SBRIT ? SBRIT_FEE_AMOUNT : SSC_FEE_AMOUNT, asset: p.asset, to: '' },
        signature: [],
        validatorAttestations: []
    };
}

/** Unsigned contract call, as the node's ContractCallTxCreator assembles it. */
export function buildContractCallTx(p: ContractCallParams): ContractCallTransaction {
    if (!p.from || p.from.length === 0) {
        throw new Error('Invalid or missing from field');
    }
    if (!p.to || p.to.length === 0) {
        throw new Error('Invalid or missing to field');
    }
    if (!p.method || p.method.trim().length === 0) {
        throw new Error('Contract method name is required');
    }
    if (p.data !== undefined && p.data !== null && typeof p.data === 'string') {
        throw new Error('Contract call data must be a plain object with field names');
    }
    if (p.amount !== undefined && p.amount !== null && p.amount !== '') {
        let callAmount: Decimal;
        try {
            callAmount = new Dec(p.amount);
        } catch {
            throw new Error('Invalid amount format');
        }
        if (callAmount.lt('0')) {
            throw new Error('Amount cannot be negative');
        }
    }
    if (!p.codeHash || p.codeHash.trim().length === 0) {
        throw new Error(`Invalid or missing codeHash for contract at address: ${p.to}`);
    }
    if (!p.sandboxHash || p.sandboxHash.trim().length === 0) {
        throw new Error(`Invalid or missing sandboxHash for contract at address: ${p.to}`);
    }
    return {
        version: p.version,
        chainId: p.chainId,
        type: TxType.CONTRACT_CALL,
        from: p.from,
        to: p.to,
        amount: p.amount || '0',
        asset: AssetId.SBRIT,
        sequence: p.sequence,
        timestamp: p.timestamp ?? Date.now(),
        salt: p.salt ?? generateSalt(p.from),
        fee: { amount: SBRIT_FEE_AMOUNT, asset: AssetId.SBRIT, to: '' },
        signature: [],
        validatorAttestations: [],
        data: p.data === undefined ? '' : encodeDeterministicJSON(p.data, { asHex: true }),
        method: p.method,
        codeHash: p.codeHash,
        sandboxHash: p.sandboxHash,
        cid: p.to,
        location: p.location ?? ContractLocation.FS
    };
}

/** Detached signatures of the signers over the transaction's signing preimage. */
export async function getTxSignatures(tx: Transaction, signers: Signer[]): Promise<TransactionSignature[]> {
    const dataHex = serializeForSigning(tx);
    const signatures: TransactionSignature[] = [];
    for (const signer of signers) {
        signatures.push({ publickey: signer.publicKey, signature: await signer.sign(dataHex) });
    }
    return signatures;
}

/** Sign the transaction with the signers and set tx.signature. As the node's creators, refuses when no signer controls tx.from. */
export async function signTransaction<T extends Transaction>(tx: T, signers: Signer[]): Promise<T> {
    if (signers.length === 0) {
        throw new Error('At least one signer is required');
    }
    if (!signers.some(signer => publicKeyOwnsAddress(tx.from, signer.publicKey))) {
        throw new Error(signers.length === 1 ? 'Signer does not control the from address' : `None of the ${signers.length} signers control the from address: ${tx.from}`);
    }
    tx.signature = await getTxSignatures(tx, signers);
    return tx;
}

/** The node's ownership rule: at least one signature's public key controls tx.from. False when there are no signatures. */
export function validateTransactionAddressOwnership(tx: Transaction): boolean {
    if (!tx.signature || !Array.isArray(tx.signature) || tx.signature.length === 0) {
        return false;
    }
    return tx.signature.some(sig => publicKeyOwnsAddress(tx.from, sig.publickey));
}

/** Put collected signatures into an unsigned contract call. */
export function combineTxWithSigs(tx: ContractCallTransaction, signatures: TransactionSignature[]): ContractCallTransaction {
    if (signatures.length === 0) {
        throw new Error('At least one signature is required');
    }
    if (tx.type !== TxType.CONTRACT_CALL) {
        throw new Error('Transaction is not a contract call transaction');
    }
    if (!tx.from || typeof tx.from !== 'string') {
        throw new Error('Invalid or missing from address');
    }
    if (!tx.to || typeof tx.to !== 'string') {
        throw new Error('Invalid or missing to address');
    }
    if (!tx.method || typeof tx.method !== 'string') {
        throw new Error('Invalid or missing method');
    }
    if (!tx.data || typeof tx.data !== 'string') {
        throw new Error('Invalid or missing data');
    }
    if (tx.sequence === undefined || typeof tx.sequence !== 'number') {
        throw new Error('Invalid or missing sequence');
    }
    if (!tx.timestamp || typeof tx.timestamp !== 'number') {
        throw new Error('Invalid or missing timestamp');
    }
    if (!tx.salt || typeof tx.salt !== 'string') {
        throw new Error('Invalid or missing salt');
    }
    if (!tx.cid || typeof tx.cid !== 'string') {
        throw new Error('Invalid or missing contract ID');
    }
    if (!tx.location) {
        throw new Error('Invalid or missing location');
    }
    for (const parsedSig of signatures) {
        if (!parsedSig.publickey || typeof parsedSig.publickey !== 'string') {
            throw new Error('Invalid signature: missing or invalid publickey');
        }
        if (!parsedSig.signature || typeof parsedSig.signature !== 'string') {
            throw new Error('Invalid signature: missing or invalid signature');
        }
    }
    return { ...tx, signature: signatures, validatorAttestations: [] };
}

/** The node's signature rules: non-empty, at most MAX_ALLOWED_SIGNATURES, unique public keys, every signature verifies over the preimage. */
export function validateTransactionSignatures(tx: Transaction): SignatureValidationResult {
    if (!tx.signature || !Array.isArray(tx.signature)) {
        return { valid: false, error: 'Missing or invalid signature array' };
    }
    if (tx.signature.length === 0) {
        return { valid: false, error: 'Signature array cannot be empty' };
    }
    if (tx.signature.length > MAX_ALLOWED_SIGNATURES) {
        return { valid: false, error: `Signature array cannot have more than ${MAX_ALLOWED_SIGNATURES} signatures` };
    }
    const seenPublicKeys = new Set<string>();
    for (let i = 0; i < tx.signature.length; i++) {
        const sig = tx.signature[i];
        if (!sig.publickey || !sig.signature) {
            return { valid: false, error: `Signature ${i}: Missing publickey or signature` };
        }
        if (seenPublicKeys.has(sig.publickey)) {
            return { valid: false, error: `Duplicate signature: publickey ${sig.publickey} appears multiple times` };
        }
        seenPublicKeys.add(sig.publickey);
    }
    const dataHex = serializeForSigning(tx);
    for (let i = 0; i < tx.signature.length; i++) {
        const sig = tx.signature[i];
        if (!verify(dataHex, sig.signature, sig.publickey)) {
            return { valid: false, error: `Signature ${i}: Invalid signature for publickey ${sig.publickey}` };
        }
    }
    return { valid: true };
}

/** Deterministic JSON the node accepts for submission */
export function txToString(tx: Transaction): string {
    return encodeDeterministicJSON(tx, { asString: true });
}
