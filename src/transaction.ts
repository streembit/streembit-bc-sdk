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

import { TxType, AssetId, SBRIT_FEE_AMOUNT, ContractLocation } from 'streembit-bc-types';
import type { Transaction, TransferTransaction, ContractCallTransaction } from 'streembit-bc-types';
import { encodeDeterministicJSON, bytesToHex, concatBytes, utf8ToBytes, hexToBytes, randomBytes } from './encoding';
import { blake2b256, createSalt } from './hashing';
import { validateAddress, isUserAddress, isContractAddress, publicKeyOwnsAddress } from './address';
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

/** Positive decimal string, up to 8 fractional digits (the node's transfer minimum is 0.00000001). */
const AMOUNT_RE = /^(0|[1-9]\d*)(\.\d{1,8})?$/;

export function validateAmount(amount: string): boolean {
    if (typeof amount !== 'string' || !AMOUNT_RE.test(amount)) {
        return false;
    }
    return amount.replace(/[.0]/g, '').length > 0;
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
    const image = concatBytes(
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
    const preimage = concatBytes(
        utf8ToBytes(String(tx.chainId)),
        hexToBytes(txid),
        utf8ToBytes(tx.from),
        utf8ToBytes(String(tx.sequence))
    );
    return bytesToHex(blake2b256(preimage));
}

/** Unsigned SBRIT transfer with the fee placeholder the node expects (fee.to is set by the engine). */
export function buildTransferTx(p: TransferParams): TransferTransaction {
    if (!Number.isInteger(p.chainId) || !Number.isInteger(p.version)) {
        throw new Error('chainId and version must be integers');
    }
    if (!validateAddress(p.from) || !isUserAddress(p.from)) {
        throw new Error('Invalid from address');
    }
    if (!validateAddress(p.to)) {
        throw new Error('Invalid to address');
    }
    if (p.from === p.to) {
        throw new Error('Self-transfer not allowed');
    }
    if (!validateAmount(p.amount)) {
        throw new Error('Amount must be a positive decimal string with up to 8 decimal places');
    }
    if (!Number.isInteger(p.sequence) || p.sequence <= 0) {
        throw new Error('Sequence must be a positive integer');
    }
    return {
        version: p.version,
        chainId: p.chainId,
        type: TxType.TRANSFER,
        from: p.from,
        to: p.to,
        amount: p.amount,
        asset: AssetId.SBRIT,
        sequence: p.sequence,
        timestamp: p.timestamp ?? Date.now(),
        salt: p.salt ?? generateSalt(p.from),
        fee: { amount: SBRIT_FEE_AMOUNT, asset: AssetId.SBRIT, to: '' },
        signature: [],
        validatorAttestations: []
    };
}

/** Unsigned single-signer contract call. */
export function buildContractCallTx(p: ContractCallParams): ContractCallTransaction {
    if (!Number.isInteger(p.chainId) || !Number.isInteger(p.version)) {
        throw new Error('chainId and version must be integers');
    }
    if (!validateAddress(p.from) || !isUserAddress(p.from)) {
        throw new Error('Invalid from address');
    }
    if (!validateAddress(p.to) || !isContractAddress(p.to)) {
        throw new Error('Invalid contract address');
    }
    if (typeof p.method !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.method)) {
        throw new Error('Invalid method name');
    }
    // data may be omitted for a parameterless method and is then the empty string; when present it must be a plain object.
    if (p.data !== undefined && (p.data === null || typeof p.data !== 'object' || Array.isArray(p.data))) {
        throw new Error('Contract call data must be a plain object');
    }
    if (!p.codeHash || !p.sandboxHash) {
        throw new Error('codeHash and sandboxHash are required');
    }
    if (!Number.isInteger(p.sequence) || p.sequence <= 0) {
        throw new Error('Sequence must be a positive integer');
    }
    const amount = p.amount ?? '0';
    if (amount !== '0' && !validateAmount(amount)) {
        throw new Error('Invalid amount');
    }
    return {
        version: p.version,
        chainId: p.chainId,
        type: TxType.CONTRACT_CALL,
        from: p.from,
        to: p.to,
        amount,
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

/**
 * Sign an unsigned transfer or contract call with a signer. Checks that the signer controls tx.from before
 * signing, as the node will. Returns the same object with signature set.
 */
export async function signTransaction<T extends TransferTransaction | ContractCallTransaction>(tx: T, signer: Pick<Signer, 'publicKey' | 'sign'>): Promise<T> {
    if (!publicKeyOwnsAddress(tx.from, signer.publicKey)) {
        throw new Error('Signer does not control the from address');
    }
    const dataHex = serializeForSigning(tx);
    const signature = await signer.sign(dataHex);
    tx.signature = [{ publickey: signer.publicKey, signature }];
    return tx;
}

/** JSON the node accepts for submission (plain JSON.stringify). */
export function txToString(tx: Transaction): string {
    return JSON.stringify(tx);
}
