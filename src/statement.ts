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

import { SALE_ACCEPTANCE_KIND } from 'streembit-bc-types';
import type { ContractStatement, SignedContractStatement, SignedSaleAcceptance } from 'streembit-bc-types';
import { sign, verify, getPublicKey } from './signing';
import { createUserAddress } from './address';
import { bytesToHex, utf8ToBytes } from './encoding';

const COMPRESSED_PUBLIC_KEY = /^[0-9a-fA-F]{66}$/;

function requireField(name: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} is required`);
    }
    if (value.includes('|')) {
        throw new Error(`${name} must not contain '|'`);
    }
    return value;
}

/** The canonical string of a statement, the bytes both the signer and the contract hash */
export function contractStatementPreimage(statement: ContractStatement): string {
    const kind = requireField('kind', statement.kind);
    if (!Number.isInteger(statement.chainId) || statement.chainId <= 0) {
        throw new Error('chainId must be a positive integer');
    }
    const cid = requireField('cid', statement.cid);
    const fields = statement.fields.map((field, index) => requireField(`fields[${index}]`, field));
    return [kind, String(statement.chainId), cid, ...fields].join('|');
}

/** The hex the SDK's sign and the sandbox's crypto.verify take: the UTF-8 bytes of the canonical string */
export function contractStatementHex(statement: ContractStatement): string {
    return bytesToHex(utf8ToBytes(contractStatementPreimage(statement)));
}

/** Signs a statement; the signer's public key must be among the fields, where the contract expects it */
export function signContractStatement(statement: ContractStatement, privateKeyHex: string): SignedContractStatement {
    const publicKey = getPublicKey(privateKeyHex);
    if (!statement.fields.includes(publicKey)) {
        throw new Error('The signer public key must be one of the statement fields');
    }
    const signature = sign(contractStatementHex(statement), privateKeyHex);
    return { kind: statement.kind, chainId: statement.chainId, cid: statement.cid, fields: [...statement.fields], publicKey, signature };
}

/** True when the signature verifies with the statement's public key and that key is one of the fields */
export function verifyContractStatement(signed: SignedContractStatement): boolean {
    try {
        if (!COMPRESSED_PUBLIC_KEY.test(signed.publicKey) || !signed.fields.includes(signed.publicKey)) {
            return false;
        }
        return verify(contractStatementHex(signed), signed.signature, signed.publicKey);
    } catch {
        return false;
    }
}

// ============================================================================
// The sale acceptance of the external payment contract
// Fields, in the contract's order: saleId, buyerAddress, buyerPublicKey, btcRefundAddress.
// Strict rule: buyerAddress is the address of buyerPublicKey; the SDK derives it and never takes one.
// ============================================================================

export interface SaleAcceptanceFields {
    chainId: number;
    cid: string;
    saleId: string;
    btcRefundAddress: string;
}

function acceptanceStatement(acceptance: SignedSaleAcceptance | (SaleAcceptanceFields & { buyerAddress: string; buyerPublicKey: string })): ContractStatement {
    return {
        kind: SALE_ACCEPTANCE_KIND,
        chainId: acceptance.chainId,
        cid: acceptance.cid,
        fields: [acceptance.saleId, acceptance.buyerAddress, acceptance.buyerPublicKey, acceptance.btcRefundAddress]
    };
}

/** The buyer signs the acceptance of a sale with the key of the SBRIT address the coins go to */
export function signSaleAcceptance(fields: SaleAcceptanceFields, privateKeyHex: string): SignedSaleAcceptance {
    const buyerPublicKey = getPublicKey(privateKeyHex);
    const buyerAddress = createUserAddress(buyerPublicKey);
    const acceptance = { ...fields, buyerAddress, buyerPublicKey };
    const signed = signContractStatement(acceptanceStatement(acceptance), privateKeyHex);
    return { chainId: fields.chainId, cid: fields.cid, saleId: fields.saleId, buyerAddress, buyerPublicKey, btcRefundAddress: fields.btcRefundAddress, signature: signed.signature };
}

/**
 * The seller's wallet checks an imported acceptance before submitting it: the signature verifies with the buyer's
 * key, and the credited address is that key's address.
 */
export function verifySaleAcceptance(acceptance: SignedSaleAcceptance): boolean {
    try {
        if (createUserAddress(acceptance.buyerPublicKey) !== acceptance.buyerAddress) {
            return false;
        }
        return verifyContractStatement({ ...acceptanceStatement(acceptance), publicKey: acceptance.buyerPublicKey, signature: acceptance.signature });
    } catch {
        return false;
    }
}
