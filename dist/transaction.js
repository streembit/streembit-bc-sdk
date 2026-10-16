"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAmount = validateAmount;
exports.generateSalt = generateSalt;
exports.serializeForSigning = serializeForSigning;
exports.computeTxId = computeTxId;
exports.serializeForAttestation = serializeForAttestation;
exports.buildTransferTx = buildTransferTx;
exports.buildContractCallTx = buildContractCallTx;
exports.signTransaction = signTransaction;
exports.txToString = txToString;
const streembit_bc_types_1 = require("streembit-bc-types");
const encoding_1 = require("./encoding");
const hashing_1 = require("./hashing");
const address_1 = require("./address");
/** Positive decimal string, up to 8 fractional digits (the node's transfer minimum is 0.00000001). */
const AMOUNT_RE = /^(0|[1-9]\d*)(\.\d{1,8})?$/;
function validateAmount(amount) {
    if (typeof amount !== 'string' || !AMOUNT_RE.test(amount)) {
        return false;
    }
    return amount.replace(/[.0]/g, '').length > 0;
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
    const image = (0, encoding_1.concatBytes)((0, encoding_1.utf8ToBytes)(String(tx.chainId)), (0, encoding_1.utf8ToBytes)(String(tx.timestamp)), (0, encoding_1.utf8ToBytes)(txIdPayload(tx)), (0, encoding_1.utf8ToBytes)(JSON.stringify(tx.signature)), (0, encoding_1.utf8ToBytes)(tx.salt), (0, encoding_1.utf8ToBytes)(String(tx.sequence)));
    return (0, encoding_1.bytesToHex)((0, hashing_1.blake2b256)(image));
}
/** Attestation preimage: Blake2b-256(chainId || txid || from || sequence) as hex. */
function serializeForAttestation(tx, txid) {
    const preimage = (0, encoding_1.concatBytes)((0, encoding_1.utf8ToBytes)(String(tx.chainId)), (0, encoding_1.hexToBytes)(txid), (0, encoding_1.utf8ToBytes)(tx.from), (0, encoding_1.utf8ToBytes)(String(tx.sequence)));
    return (0, encoding_1.bytesToHex)((0, hashing_1.blake2b256)(preimage));
}
/** Unsigned SBRIT transfer with the fee placeholder the node expects (fee.to is set by the engine). */
function buildTransferTx(p) {
    if (!Number.isInteger(p.chainId) || !Number.isInteger(p.version)) {
        throw new Error('chainId and version must be integers');
    }
    if (!(0, address_1.validateAddress)(p.from) || !(0, address_1.isUserAddress)(p.from)) {
        throw new Error('Invalid from address');
    }
    if (!(0, address_1.validateAddress)(p.to)) {
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
        type: streembit_bc_types_1.TxType.TRANSFER,
        from: p.from,
        to: p.to,
        amount: p.amount,
        asset: streembit_bc_types_1.AssetId.SBRIT,
        sequence: p.sequence,
        timestamp: p.timestamp ?? Date.now(),
        salt: p.salt ?? generateSalt(p.from),
        fee: { amount: streembit_bc_types_1.SBRIT_FEE_AMOUNT, asset: streembit_bc_types_1.AssetId.SBRIT, to: '' },
        signature: [],
        validatorAttestations: []
    };
}
/** Unsigned single-signer contract call. */
function buildContractCallTx(p) {
    if (!Number.isInteger(p.chainId) || !Number.isInteger(p.version)) {
        throw new Error('chainId and version must be integers');
    }
    if (!(0, address_1.validateAddress)(p.from) || !(0, address_1.isUserAddress)(p.from)) {
        throw new Error('Invalid from address');
    }
    if (!(0, address_1.validateAddress)(p.to) || !(0, address_1.isContractAddress)(p.to)) {
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
        type: streembit_bc_types_1.TxType.CONTRACT_CALL,
        from: p.from,
        to: p.to,
        amount,
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
/**
 * Sign an unsigned transfer or contract call with a signer. Checks that the signer controls tx.from before
 * signing, as the node will. Returns the same object with signature set.
 */
async function signTransaction(tx, signer) {
    if (!(0, address_1.publicKeyOwnsAddress)(tx.from, signer.publicKey)) {
        throw new Error('Signer does not control the from address');
    }
    const dataHex = serializeForSigning(tx);
    const signature = await signer.sign(dataHex);
    tx.signature = [{ publickey: signer.publicKey, signature }];
    return tx;
}
/** JSON the node accepts for submission (plain JSON.stringify). */
function txToString(tx) {
    return JSON.stringify(tx);
}
