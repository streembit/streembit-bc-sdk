"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAmount = validateAmount;
exports.generateSalt = generateSalt;
exports.serializeForSigning = serializeForSigning;
exports.computeTxId = computeTxId;
exports.serializeForAttestation = serializeForAttestation;
exports.pendingTxId = pendingTxId;
exports.buildTransferTx = buildTransferTx;
exports.buildContractCallTx = buildContractCallTx;
exports.getTxSignatures = getTxSignatures;
exports.signTransaction = signTransaction;
exports.validateTransactionAddressOwnership = validateTransactionAddressOwnership;
exports.combineTxWithSigs = combineTxWithSigs;
exports.validateTransactionSignatures = validateTransactionSignatures;
exports.txToString = txToString;
const decimal_js_1 = require("decimal.js");
const streembit_bc_types_1 = require("streembit-bc-types");
const encoding_1 = require("./encoding");
const hashing_1 = require("./hashing");
const address_1 = require("./address");
const signing_1 = require("./signing");
/** Decimal arithmetic as the node's decimal service configures it. */
const Dec = decimal_js_1.Decimal.clone({ precision: 40, rounding: decimal_js_1.Decimal.ROUND_HALF_UP });
/** Positive decimal amount, optionally within [minAmount, maxAmount]. */
function validateAmount(amount, options) {
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
    }
    catch {
        return false;
    }
}
/** Fresh salt for a transaction: createSalt over the time, random bytes and the sender (32 hex chars). */
function generateSalt(from) {
    return (0, hashing_1.createSalt)(JSON.stringify({ t: Date.now(), r: (0, encoding_1.bytesToHex)((0, encoding_1.randomBytes)(16)), from }));
}
/** Hex of the deterministic JSON of the transaction without signature, validatorAttestations and fee. */
function serializeForSigning(tx) {
    const txCopy = { ...tx };
    delete txCopy.signature;
    delete txCopy.validatorAttestations;
    delete txCopy.fee;
    return (0, encoding_1.encodeDeterministicJSON)(txCopy, { asHex: true });
}
function txIdPayload(tx) {
    const payload = {
        version: tx.version,
        chainid: tx.chainId,
        type: tx.type,
        from: tx.from,
        to: tx.to,
        amount: tx.amount,
        asset: tx.asset
    };
    if (tx.type === streembit_bc_types_1.TxType.CONTRACT_CALL) {
        const callTx = tx;
        payload.method = callTx.method;
        payload.data = callTx.data;
    }
    return JSON.stringify(payload, Object.keys(payload).sort());
}
/** txid of a signed transaction. 64 hex chars. */
function computeTxId(tx) {
    const image = (0, encoding_1.concat)((0, encoding_1.utf8ToBytes)(String(tx.chainId)), (0, encoding_1.utf8ToBytes)(String(tx.timestamp)), (0, encoding_1.utf8ToBytes)(txIdPayload(tx)), (0, encoding_1.utf8ToBytes)(JSON.stringify(tx.signature)), (0, encoding_1.utf8ToBytes)(tx.salt), (0, encoding_1.utf8ToBytes)(String(tx.sequence)));
    return (0, encoding_1.bytesToHex)((0, hashing_1.blake2b256)(image));
}
/** Attestation preimage: Blake2b-256(chainId || txid || from || sequence) as hex. */
function serializeForAttestation(tx, txid) {
    const preimage = (0, encoding_1.concat)((0, encoding_1.utf8ToBytes)(String(tx.chainId)), (0, encoding_1.hexToBytes)(txid), (0, encoding_1.utf8ToBytes)(tx.from), (0, encoding_1.utf8ToBytes)(String(tx.sequence)));
    return (0, encoding_1.bytesToHex)((0, hashing_1.blake2b256)(preimage));
}
/** Id of a transaction waiting for signatures: Blake2b-256 of the exact bytes the signers sign. */
function pendingTxId(unsignedTx) {
    return (0, encoding_1.bytesToHex)((0, hashing_1.blake2b256)((0, encoding_1.hexToBytes)(serializeForSigning(unsignedTx))));
}
/** Unsigned transfer with the fee placeholder the node expects (fee.to is set by the engine). */
function buildTransferTx(p) {
    if (p.asset !== streembit_bc_types_1.AssetId.SBRIT && p.asset !== streembit_bc_types_1.AssetId.SSC) {
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
        type: streembit_bc_types_1.TxType.TRANSFER,
        from: p.from,
        to: p.to,
        amount: p.amount,
        asset: p.asset,
        sequence: p.sequence,
        timestamp: p.timestamp ?? Date.now(),
        salt: p.salt ?? generateSalt(p.from),
        fee: { amount: p.asset === streembit_bc_types_1.AssetId.SBRIT ? streembit_bc_types_1.SBRIT_FEE_AMOUNT : streembit_bc_types_1.SSC_FEE_AMOUNT, asset: p.asset, to: '' },
        signature: [],
        validatorAttestations: []
    };
}
/** Unsigned contract call, as the node's ContractCallTxCreator assembles it. */
function buildContractCallTx(p) {
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
        let callAmount;
        try {
            callAmount = new Dec(p.amount);
        }
        catch {
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
        type: streembit_bc_types_1.TxType.CONTRACT_CALL,
        from: p.from,
        to: p.to,
        amount: p.amount || '0',
        asset: streembit_bc_types_1.AssetId.SBRIT,
        sequence: p.sequence,
        timestamp: p.timestamp ?? Date.now(),
        salt: p.salt ?? generateSalt(p.from),
        fee: { amount: streembit_bc_types_1.SBRIT_FEE_AMOUNT, asset: streembit_bc_types_1.AssetId.SBRIT, to: '' },
        signature: [],
        validatorAttestations: [],
        data: p.data === undefined ? '' : (0, encoding_1.encodeDeterministicJSON)(p.data, { asHex: true }),
        method: p.method,
        codeHash: p.codeHash,
        sandboxHash: p.sandboxHash,
        cid: p.to,
        location: p.location ?? streembit_bc_types_1.ContractLocation.FS
    };
}
/** Detached signatures of the signers over the transaction's signing preimage. */
async function getTxSignatures(tx, signers) {
    const dataHex = serializeForSigning(tx);
    const signatures = [];
    for (const signer of signers) {
        signatures.push({ publickey: signer.publicKey, signature: await signer.sign(dataHex) });
    }
    return signatures;
}
/** Sign the transaction with the signers and set tx.signature. As the node's creators, refuses when no signer controls tx.from. */
async function signTransaction(tx, signers) {
    if (signers.length === 0) {
        throw new Error('At least one signer is required');
    }
    if (!signers.some(signer => (0, address_1.publicKeyOwnsAddress)(tx.from, signer.publicKey))) {
        throw new Error(signers.length === 1 ? 'Signer does not control the from address' : `None of the ${signers.length} signers control the from address: ${tx.from}`);
    }
    tx.signature = await getTxSignatures(tx, signers);
    return tx;
}
/** The node's ownership rule: at least one signature's public key controls tx.from. False when there are no signatures. */
function validateTransactionAddressOwnership(tx) {
    if (!tx.signature || !Array.isArray(tx.signature) || tx.signature.length === 0) {
        return false;
    }
    return tx.signature.some(sig => (0, address_1.publicKeyOwnsAddress)(tx.from, sig.publickey));
}
/** Put collected signatures into an unsigned contract call. */
function combineTxWithSigs(tx, signatures) {
    if (signatures.length === 0) {
        throw new Error('At least one signature is required');
    }
    if (tx.type !== streembit_bc_types_1.TxType.CONTRACT_CALL) {
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
function validateTransactionSignatures(tx) {
    if (!tx.signature || !Array.isArray(tx.signature)) {
        return { valid: false, error: 'Missing or invalid signature array' };
    }
    if (tx.signature.length === 0) {
        return { valid: false, error: 'Signature array cannot be empty' };
    }
    if (tx.signature.length > streembit_bc_types_1.MAX_ALLOWED_SIGNATURES) {
        return { valid: false, error: `Signature array cannot have more than ${streembit_bc_types_1.MAX_ALLOWED_SIGNATURES} signatures` };
    }
    const seenPublicKeys = new Set();
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
        if (!(0, signing_1.verify)(dataHex, sig.signature, sig.publickey)) {
            return { valid: false, error: `Signature ${i}: Invalid signature for publickey ${sig.publickey}` };
        }
    }
    return { valid: true };
}
/** JSON the node accepts for submission (plain JSON.stringify). */
function txToString(tx) {
    return JSON.stringify(tx);
}
