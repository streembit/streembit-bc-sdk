"use strict";
/**
 * Off-chain contract statements.
 *
 * A party signs a statement about a contract off chain, someone else submits it in a contract call, and the
 * contract verifies the signature through the sandbox's crypto.verify over the same canonical string. The string
 * is `<kind>|<chainId>|<cid>|<fields joined by |>`, no escaping, so no field may contain '|'; the signer's public
 * key is one of the fields, placed where the contract's own preimage puts it. The chain id and the contract id
 * inside the string mean a statement cannot be replayed on another chain or against another contract.
 *
 * The first kind is the external payment contract's buyer acceptance (design: docs/contracts/external-payment-design.md,
 * section 8, in the blockchain repository): the buyer holds no SBRIT and never sends a transaction; the wallet signs
 * the acceptance, hands it to the seller over a personal channel, and the seller submits it with `accept`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.contractStatementPreimage = contractStatementPreimage;
exports.contractStatementHex = contractStatementHex;
exports.signContractStatement = signContractStatement;
exports.verifyContractStatement = verifyContractStatement;
exports.signSaleAcceptance = signSaleAcceptance;
exports.verifySaleAcceptance = verifySaleAcceptance;
const streembit_bc_types_1 = require("streembit-bc-types");
const signing_1 = require("./signing");
const address_1 = require("./address");
const encoding_1 = require("./encoding");
const COMPRESSED_PUBLIC_KEY = /^[0-9a-fA-F]{66}$/;
function requireField(name, value) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} is required`);
    }
    if (value.includes('|')) {
        throw new Error(`${name} must not contain '|'`);
    }
    return value;
}
/** The canonical string of a statement, the bytes both the signer and the contract hash */
function contractStatementPreimage(statement) {
    const kind = requireField('kind', statement.kind);
    if (!Number.isInteger(statement.chainId) || statement.chainId <= 0) {
        throw new Error('chainId must be a positive integer');
    }
    const cid = requireField('cid', statement.cid);
    const fields = statement.fields.map((field, index) => requireField(`fields[${index}]`, field));
    return [kind, String(statement.chainId), cid, ...fields].join('|');
}
/** The hex the SDK's sign and the sandbox's crypto.verify take: the UTF-8 bytes of the canonical string */
function contractStatementHex(statement) {
    return (0, encoding_1.bytesToHex)((0, encoding_1.utf8ToBytes)(contractStatementPreimage(statement)));
}
/** Signs a statement; the signer's public key must be among the fields, where the contract expects it */
function signContractStatement(statement, privateKeyHex) {
    const publicKey = (0, signing_1.getPublicKey)(privateKeyHex);
    if (!statement.fields.includes(publicKey)) {
        throw new Error('The signer public key must be one of the statement fields');
    }
    const signature = (0, signing_1.sign)(contractStatementHex(statement), privateKeyHex);
    return { kind: statement.kind, chainId: statement.chainId, cid: statement.cid, fields: [...statement.fields], publicKey, signature };
}
/** True when the signature verifies with the statement's public key and that key is one of the fields */
function verifyContractStatement(signed) {
    try {
        if (!COMPRESSED_PUBLIC_KEY.test(signed.publicKey) || !signed.fields.includes(signed.publicKey)) {
            return false;
        }
        return (0, signing_1.verify)(contractStatementHex(signed), signed.signature, signed.publicKey);
    }
    catch {
        return false;
    }
}
function acceptanceStatement(acceptance) {
    return {
        kind: streembit_bc_types_1.SALE_ACCEPTANCE_KIND,
        chainId: acceptance.chainId,
        cid: acceptance.cid,
        fields: [acceptance.saleId, acceptance.buyerAddress, acceptance.buyerPublicKey, acceptance.btcRefundAddress]
    };
}
/** The buyer signs the acceptance of a sale with the key of the SBRIT address the coins go to */
function signSaleAcceptance(fields, privateKeyHex) {
    const buyerPublicKey = (0, signing_1.getPublicKey)(privateKeyHex);
    const buyerAddress = (0, address_1.createUserAddress)(buyerPublicKey);
    const acceptance = { ...fields, buyerAddress, buyerPublicKey };
    const signed = signContractStatement(acceptanceStatement(acceptance), privateKeyHex);
    return { chainId: fields.chainId, cid: fields.cid, saleId: fields.saleId, buyerAddress, buyerPublicKey, btcRefundAddress: fields.btcRefundAddress, signature: signed.signature };
}
/**
 * The seller's wallet checks an imported acceptance before submitting it: the signature verifies with the buyer's
 * key, and the credited address is that key's address.
 */
function verifySaleAcceptance(acceptance) {
    try {
        if ((0, address_1.createUserAddress)(acceptance.buyerPublicKey) !== acceptance.buyerAddress) {
            return false;
        }
        return verifyContractStatement({ ...acceptanceStatement(acceptance), publicKey: acceptance.buyerPublicKey, signature: acceptance.signature });
    }
    catch {
        return false;
    }
}
