/**
 * Off-chain contract statements: the canonical string, signing and verification, and the sale acceptance of the
 * external payment contract built on them. The contract verifies the same hex through the sandbox's crypto.verify,
 * which is the SDK's verify, so a statement that verifies here verifies there.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    contractStatementPreimage, contractStatementHex, signContractStatement, verifyContractStatement,
    signSaleAcceptance, verifySaleAcceptance, generateKeyPair, createUserAddress, verify, bytesToHex, utf8ToBytes
} from '../src/index';
import { SALE_ACCEPTANCE_KIND } from 'streembit-bc-types';

const CID = 'CPd1chaxHif6L8Bswd3hvJpaB1ywbQpe2V';

describe('contract statements', () => {
    it('builds the canonical string with the kind, chain id, contract id and the fields in order', () => {
        const preimage = contractStatementPreimage({ kind: 'TEST-KIND', chainId: 1337, cid: CID, fields: ['a', 'b', 'c'] });
        assert.equal(preimage, `TEST-KIND|1337|${CID}|a|b|c`);
        assert.equal(contractStatementHex({ kind: 'TEST-KIND', chainId: 1337, cid: CID, fields: ['a'] }), bytesToHex(utf8ToBytes(`TEST-KIND|1337|${CID}|a`)));
    });

    it('refuses a field with the separator, an empty field and a bad chain id', () => {
        assert.throws(() => contractStatementPreimage({ kind: 'K', chainId: 1337, cid: CID, fields: ['x|y'] }), /must not contain/);
        assert.throws(() => contractStatementPreimage({ kind: 'K', chainId: 1337, cid: CID, fields: [''] }), /required/);
        assert.throws(() => contractStatementPreimage({ kind: 'K', chainId: 0, cid: CID, fields: ['a'] }), /chainId/);
    });

    it('signs with a key that is one of the fields and verifies; any changed field fails', () => {
        const key = generateKeyPair();
        const signed = signContractStatement({ kind: 'TEST-KIND', chainId: 1337, cid: CID, fields: ['vote', key.publicKey, 'yes'] }, key.privateKey);
        assert.equal(signed.publicKey, key.publicKey);
        assert.equal(verifyContractStatement(signed), true);
        assert.equal(verifyContractStatement({ ...signed, fields: ['vote', key.publicKey, 'no'] }), false);
        assert.equal(verifyContractStatement({ ...signed, chainId: 1 }), false);
        assert.equal(verifyContractStatement({ ...signed, cid: 'C' + CID.slice(1) + 'x' }), false);
        assert.equal(verifyContractStatement({ ...signed, kind: 'OTHER' }), false);
        // the plain verify over the same hex is what the contract calls through the sandbox
        assert.equal(verify(contractStatementHex(signed), signed.signature, key.publicKey), true);
    });

    it('refuses to sign when the signer key is not among the fields', () => {
        const key = generateKeyPair();
        assert.throws(() => signContractStatement({ kind: 'K', chainId: 1337, cid: CID, fields: ['a'] }, key.privateKey), /must be one of the statement fields/);
    });
});

describe('sale acceptance', () => {
    const refund = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

    it('derives the buyer address from the key, builds the contract string and verifies', () => {
        const buyer = generateKeyPair();
        const saleId = 'ab'.repeat(32);
        const signed = signSaleAcceptance({ chainId: 1337, cid: CID, saleId, btcRefundAddress: refund }, buyer.privateKey);
        assert.equal(signed.buyerPublicKey, buyer.publicKey);
        assert.equal(signed.buyerAddress, createUserAddress(buyer.publicKey));
        assert.equal(verifySaleAcceptance(signed), true);
        const expected = `${SALE_ACCEPTANCE_KIND}|1337|${CID}|${saleId}|${signed.buyerAddress}|${buyer.publicKey}|${refund}`;
        assert.equal(verify(bytesToHex(utf8ToBytes(expected)), signed.signature, buyer.publicKey), true);
    });

    it('refuses an acceptance whose credited address is not the key address, or whose fields changed', () => {
        const buyer = generateKeyPair();
        const other = generateKeyPair();
        const signed = signSaleAcceptance({ chainId: 1337, cid: CID, saleId: 'cd'.repeat(32), btcRefundAddress: refund }, buyer.privateKey);
        assert.equal(verifySaleAcceptance({ ...signed, buyerAddress: createUserAddress(other.publicKey) }), false);
        assert.equal(verifySaleAcceptance({ ...signed, btcRefundAddress: refund.toUpperCase() }), false);
        assert.equal(verifySaleAcceptance({ ...signed, saleId: 'ef'.repeat(32) }), false);
        assert.equal(verifySaleAcceptance({ ...signed, signature: signed.signature.replace(/.$/, c => (c === '0' ? '1' : '0')) }), false);
    });
});
