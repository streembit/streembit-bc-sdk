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
import type { ContractStatement, SignedContractStatement, SignedSaleAcceptance } from 'streembit-bc-types';
/** The canonical string of a statement, the bytes both the signer and the contract hash */
export declare function contractStatementPreimage(statement: ContractStatement): string;
/** The hex the SDK's sign and the sandbox's crypto.verify take: the UTF-8 bytes of the canonical string */
export declare function contractStatementHex(statement: ContractStatement): string;
/** Signs a statement; the signer's public key must be among the fields, where the contract expects it */
export declare function signContractStatement(statement: ContractStatement, privateKeyHex: string): SignedContractStatement;
/** True when the signature verifies with the statement's public key and that key is one of the fields */
export declare function verifyContractStatement(signed: SignedContractStatement): boolean;
export interface SaleAcceptanceFields {
    chainId: number;
    cid: string;
    saleId: string;
    btcRefundAddress: string;
}
/** The buyer signs the acceptance of a sale with the key of the SBRIT address the coins go to */
export declare function signSaleAcceptance(fields: SaleAcceptanceFields, privateKeyHex: string): SignedSaleAcceptance;
/**
 * The seller's wallet checks an imported acceptance before submitting it: the signature verifies with the buyer's
 * key, and the credited address is that key's address.
 */
export declare function verifySaleAcceptance(acceptance: SignedSaleAcceptance): boolean;
//# sourceMappingURL=statement.d.ts.map