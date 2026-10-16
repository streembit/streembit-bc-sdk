/**
 * The wallet core against the committed vectors and against independent implementations.
 *
 *   npm test
 *
 * tests/wallet-vectors.json is written by `npm run vectors` (scripts/vectors.ts) from implementations that
 * do not share code with src/: bip39, bip32 and tiny-secp256k1 for keys, node:crypto (OpenSSL) for SHA-256,
 * RIPEMD-160, ECDSA, scrypt and AES-256-GCM, and blakejs for Blake2b. The tests here also call those
 * libraries directly on fresh values. The protocol constants and transaction
 * types are not compared: the SDK imports them from streembit-bc-types, as the node does.
 *
 * Optional: WALLET_TEST_MNEMONIC and WALLET_TEST_ADDRESS (account 0, index 0, as printed by the CLI
 * wallet) compare this implementation with a real wallet.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createVerify, createPublicKey, ECDH, scryptSync } from 'node:crypto';
import path from 'node:path';

import { mnemonicToSeedSync } from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import type { TransferTransaction, ContractCallTransaction } from 'streembit-bc-types';

import * as W from '../src';

interface Vectors {
    generatedBy: { repository: string; version: string; generatedAt: string };
    chainId: number;
    version: number;
    mnemonic: string;
    accounts: Array<{ path: string; privateKey: string; publicKey: string; address: string }>;
    contractAddress: { cid32: string; address: string };
    encoding: { json: string };
    hashes: { input: string; blake2b256: string; sha256: string; ripemd160: string; hash160: string; doubleSha256: string };
    salt: { input: string; salt: string };
    signature: { dataHex: string; privateKey: string; publicKey: string; signature: string };
    transfer: { tx: TransferTransaction; preimageHex: string; txid: string };
    contractCall: { tx: ContractCallTransaction; preimageHex: string; txid: string };
    walletFile: { password: string; mnemonic: string; payload: W.EncryptedPayload };
}

const vectors = JSON.parse(readFileSync(path.join(__dirname, 'wallet-vectors.json'), 'utf8')) as Vectors;
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** tiny-secp256k1 verifies a DER signature over SHA-256 of the data. */
function tinyVerifies(dataHex: string, signatureDerHex: string, publicKeyHex: string): boolean {
    const der = Buffer.from(signatureDerHex, 'hex');
    // DER: 30 len 02 rlen r 02 slen s
    const rLen = der[3];
    const r = der.subarray(4, 4 + rLen);
    const sLen = der[5 + rLen];
    const s = der.subarray(6 + rLen, 6 + rLen + sLen);
    const compact = Buffer.concat([pad32(r), pad32(s)]);
    return ecc.verify(createHash('sha256').update(Buffer.from(dataHex, 'hex')).digest(), Buffer.from(publicKeyHex, 'hex'), compact);
}

function pad32(part: Buffer): Buffer {
    const trimmed = part[0] === 0 && part.length > 32 ? part.subarray(1) : part;
    return Buffer.concat([Buffer.alloc(32 - trimmed.length), trimmed]);
}

/** OpenSSL verifies the DER signature over SHA-256 of the data, as the node's createVerify path does. */
function opensslVerifies(dataHex: string, signatureDerHex: string, publicKeyHex: string): boolean {
    const uncompressed = ECDH.convertKey(Buffer.from(publicKeyHex, 'hex'), 'secp256k1', 'hex', 'buffer', 'uncompressed') as Buffer;
    const key = createPublicKey({
        key: { kty: 'EC', crv: 'secp256k1', x: uncompressed.subarray(1, 33).toString('base64url'), y: uncompressed.subarray(33, 65).toString('base64url') },
        format: 'jwk'
    });
    return createVerify('SHA256').update(Buffer.from(dataHex, 'hex')).verify(key, Buffer.from(signatureDerHex, 'hex'));
}

describe(`Wallet core against the vectors (${vectors.generatedBy.repository} ${vectors.generatedBy.version})`, () => {

    describe('encoding', () => {
        it('deterministic JSON equals the vector (sorted keys, undefined dropped, BigInt as "<n>n")', () => {
            const input = { z: 1, a: { d: 'x', c: [3, { b: 2, a: 1 }] }, u: undefined, big: 10n };
            assert.equal(W.encodeDeterministicJSON(input, { asString: true }), vectors.encoding.json);
        });

        it('hex and base64 round trips match Buffer', () => {
            assert.equal(W.bytesToHex(W.hexToBytes('00ff10')), '00ff10');
            const bytes = new Uint8Array([0, 1, 2, 3, 250, 254, 255]);
            assert.equal(W.bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
            assert.equal(hex(W.base64ToBytes(W.bytesToBase64(bytes))), hex(bytes));
            assert.throws(() => W.hexToBytes('abc'));
        });
    });

    describe('hashing', () => {
        const data = W.utf8ToBytes(vectors.hashes.input);

        it('blake2b256, sha256, ripemd160, hash160 and double sha256 equal the vectors', () => {
            assert.equal(hex(W.blake2b256(data)), vectors.hashes.blake2b256);
            assert.equal(hex(W.sha256(data)), vectors.hashes.sha256);
            assert.equal(hex(W.ripemd160(data)), vectors.hashes.ripemd160);
            assert.equal(hex(W.hash160(data)), vectors.hashes.hash160);
            assert.equal(hex(W.doubleHash256(data)), vectors.hashes.doubleSha256);
        });

        it('sha256 and ripemd160 of fresh data equal node:crypto', () => {
            const fresh = W.randomBytes(64);
            assert.equal(hex(W.sha256(fresh)), createHash('sha256').update(fresh).digest('hex'));
            assert.equal(hex(W.ripemd160(fresh)), createHash('ripemd160').update(fresh).digest('hex'));
        });

        it('createSalt equals the vector', () => {
            assert.equal(W.createSalt(vectors.salt.input), vectors.salt.salt);
        });
    });

    describe('keys and addresses', () => {
        it('derives the vector accounts from the vector mnemonic', () => {
            const seed = W.seedFromMnemonic(vectors.mnemonic);
            for (const expected of vectors.accounts) {
                const m = /^m\/44'\/\d+'\/(\d+)'\/0\/(\d+)$/.exec(expected.path);
                assert.ok(m, `unexpected path ${expected.path}`);
                const account = W.deriveFromSeed(seed, Number(m[1]), Number(m[2]));
                assert.deepEqual(account, expected);
                assert.equal(W.deriveAddressOnly(seed, Number(m[1]), Number(m[2])).address, expected.address);
            }
        });

        it('a fresh mnemonic derives like bip39, bip32 and tiny-secp256k1', () => {
            const mnemonic = W.generateMnemonic();
            assert.equal(mnemonic.split(' ').length, 12);
            assert.ok(W.validateMnemonic(mnemonic));
            assert.ok(W.validateMnemonic('  ' + mnemonic.toUpperCase().replace(/ /g, '   ') + '\n'));
            const seed = W.seedFromMnemonic(mnemonic);
            const account = W.deriveFromSeed(seed, 0, 0);
            const seedRef = mnemonicToSeedSync(mnemonic, '');
            const ref = BIP32Factory(ecc).fromSeed(seedRef).derivePath(account.path);
            assert.equal(hex(seed), seedRef.toString('hex'));
            assert.equal(Buffer.from(ref.privateKey!).toString('hex'), account.privateKey);
            assert.equal(Buffer.from(ref.publicKey).toString('hex'), account.publicKey);
            assert.ok(account.address.startsWith('S'));
            assert.ok(W.validateAddress(account.address));
            assert.ok(W.isUserAddress(account.address));
            assert.ok(!W.isContractAddress(account.address));
            assert.equal(W.getAddressType(account.address), 'user');
            assert.ok(W.publicKeyOwnsAddress(account.address, account.publicKey));
            assert.notEqual(W.deriveFromSeed(seed, 0, 1).address, account.address);
        });

        it('a user address is Base58Check(prefix || HASH160(pubkey)) computed with node:crypto', () => {
            const account = vectors.accounts[0];
            const h160 = createHash('ripemd160').update(createHash('sha256').update(Buffer.from(account.publicKey, 'hex')).digest()).digest();
            assert.equal(W.base58checkEncode(0x3f, h160), account.address);
            assert.equal(hex(W.decodeAddress(account.address).hash), h160.toString('hex'));
            assert.equal(W.getAddressType('not an address'), 'invalid');
            assert.throws(() => W.decodeAddress('not an address'));
        });

        it('the contract address of a cid32 equals the vector and the contract address of a path is stable', () => {
            const v = vectors.contractAddress;
            const address = W.encodeContractAddress(vectors.chainId, W.hexToBytes(v.cid32));
            assert.equal(address, v.address);
            assert.ok(W.isContractAddress(address));
            assert.equal(W.getAddressType(address), 'contract');
            assert.equal(address, vectors.contractCall.tx.to);

            const deployer = vectors.accounts[0].publicKey;
            const byPath = W.createContractAddress('dist/node/smart-contracts/treasury.js', deployer, vectors.chainId);
            const chainIdBE = Buffer.alloc(4);
            chainIdBE.writeUInt32BE(vectors.chainId, 0);
            const preimage = Buffer.concat([Buffer.from('dist/node/smart-contracts/treasury.js', 'utf8'), Buffer.from(deployer, 'hex'), chainIdBE]);
            const h160 = createHash('ripemd160').update(createHash('sha256').update(preimage).digest()).digest();
            assert.equal(byPath, W.base58checkEncode(0x1c, h160));
            assert.throws(() => W.createContractAddress('node/smart-contracts/treasury.js', deployer, vectors.chainId));
        });

        it('matches a real CLI wallet when WALLET_TEST_MNEMONIC and WALLET_TEST_ADDRESS are set', (t) => {
            if (!process.env.WALLET_TEST_MNEMONIC || !process.env.WALLET_TEST_ADDRESS) {
                t.skip('set WALLET_TEST_MNEMONIC and WALLET_TEST_ADDRESS');
                return;
            }
            assert.equal(W.deriveAccount(process.env.WALLET_TEST_MNEMONIC, 0, 0).address, process.env.WALLET_TEST_ADDRESS);
        });
    });

    describe('signing', () => {
        it('the OpenSSL signature in the vectors verifies here', () => {
            const v = vectors.signature;
            assert.equal(W.getPublicKey(v.privateKey), v.publicKey);
            assert.ok(W.verify(v.dataHex, v.signature, v.publicKey));
        });

        it('a signature made here is low-S DER and verifies under OpenSSL and tiny-secp256k1', () => {
            const v = vectors.signature;
            const signature = W.sign(v.dataHex, v.privateKey);
            assert.match(signature, /^30/);
            assert.ok(W.verify(v.dataHex, signature, v.publicKey));
            assert.ok(opensslVerifies(v.dataHex, signature, v.publicKey));
            assert.ok(tinyVerifies(v.dataHex, signature, v.publicKey));
            assert.ok(tinyVerifies(v.dataHex, v.signature, v.publicKey), 'the OpenSSL signature verifies under tiny-secp256k1 too');
        });

        it('rejects tampered data and the wrong key; generateKeyPair yields a valid pair', () => {
            const v = vectors.signature;
            assert.ok(!W.verify(v.dataHex + '00', v.signature, v.publicKey));
            assert.ok(!W.verify(v.dataHex, v.signature, W.deriveAccount(W.generateMnemonic(), 0, 0).publicKey));
            assert.ok(W.validateKeyPair(v.publicKey, v.privateKey));
            assert.ok(!W.validateKeyPair(v.publicKey, 'ff'.repeat(32)));
            const pair = W.generateKeyPair();
            assert.equal(pair.privateKey.length, 64);
            assert.equal(pair.publicKey.length, 66);
            assert.ok(W.validateKeyPair(pair.publicKey, pair.privateKey));
        });

        it('SoftwareSigner exposes the address, signs, and refuses after dispose', async () => {
            const v = vectors.signature;
            const signer = new W.SoftwareSigner(v.privateKey);
            assert.equal(signer.publicKey, v.publicKey);
            assert.equal(signer.address, vectors.accounts[0].address);
            assert.ok(W.verify(v.dataHex, await signer.sign(v.dataHex), v.publicKey));
            signer.dispose();
            await assert.rejects(signer.sign(v.dataHex));
        });
    });

    describe('transactions', () => {
        it('signing preimage and txid of the vector transfer equal the vectors', () => {
            const v = vectors.transfer;
            assert.equal(W.serializeForSigning(v.tx), v.preimageHex);
            assert.equal(W.computeTxId(v.tx), v.txid);
            assert.ok(W.verify(v.preimageHex, v.tx.signature[0].signature, v.tx.signature[0].publickey));
        });

        it('signing preimage and txid of the vector contract call equal the vectors', () => {
            const v = vectors.contractCall;
            assert.equal(W.serializeForSigning(v.tx), v.preimageHex);
            assert.equal(W.computeTxId(v.tx), v.txid);
            assert.ok(W.verify(v.preimageHex, v.tx.signature[0].signature, v.tx.signature[0].publickey));
        });

        it('builds and signs a transfer that reproduces the vector transfer field by field', async () => {
            const v = vectors.transfer;
            const sender = vectors.accounts[0];
            const tx = W.buildTransferTx({ chainId: v.tx.chainId, version: v.tx.version, from: v.tx.from, to: v.tx.to, amount: v.tx.amount, sequence: v.tx.sequence, timestamp: v.tx.timestamp, salt: v.tx.salt });
            const signer = new W.SoftwareSigner(sender.privateKey);
            await W.signTransaction(tx, signer);
            signer.dispose();
            assert.equal(W.serializeForSigning(tx), v.preimageHex);
            assert.deepEqual({ ...tx, signature: undefined }, { ...v.tx, signature: undefined });
            assert.equal(tx.signature[0].publickey, v.tx.signature[0].publickey);
            assert.equal(W.txToString(tx), JSON.stringify(tx));
        });

        it('builds a contract call that reproduces the vector call field by field', async () => {
            const v = vectors.contractCall;
            const sender = vectors.accounts[0];
            const call = W.buildContractCallTx({ chainId: v.tx.chainId, version: v.tx.version, from: v.tx.from, to: v.tx.to, method: v.tx.method, data: { validatorId: 'v1' }, codeHash: v.tx.codeHash, sandboxHash: v.tx.sandboxHash, sequence: v.tx.sequence, timestamp: v.tx.timestamp, salt: v.tx.salt });
            const signer = new W.SoftwareSigner(sender.privateKey);
            await W.signTransaction(call, signer);
            signer.dispose();
            assert.equal(W.serializeForSigning(call), v.preimageHex);
            assert.equal(W.computeTxId({ ...call, signature: v.tx.signature }), v.txid);
        });

        it('attestation preimage is Blake2b-256(chainId || txid || from || sequence)', () => {
            const v = vectors.transfer;
            const expected = hex(W.blake2b256(Buffer.concat([Buffer.from(String(v.tx.chainId)), Buffer.from(v.txid, 'hex'), Buffer.from(v.tx.from), Buffer.from(String(v.tx.sequence))])));
            assert.equal(W.serializeForAttestation(v.tx, v.txid), expected);
        });

        it('refuses to sign for an address the signer does not own, refuses self-transfer, validates amounts', async () => {
            const from = vectors.accounts[0];
            const to = vectors.accounts[1];
            const signer = new W.SoftwareSigner(from.privateKey);
            await assert.rejects(W.signTransaction(W.buildTransferTx({ chainId: 1337, version: 1, from: to.address, to: from.address, amount: '1', sequence: 1 }), signer));
            signer.dispose();
            assert.throws(() => W.buildTransferTx({ chainId: 1337, version: 1, from: from.address, to: from.address, amount: '1', sequence: 1 }));
            assert.ok(W.validateAmount('0.00000001'));
            assert.ok(W.validateAmount('100'));
            assert.ok(!W.validateAmount('0'));
            assert.ok(!W.validateAmount('1.123456789'));
            assert.ok(!W.validateAmount('-1'));
            assert.ok(!W.validateAmount('1e3'));
        });

        it('refuses a contract call to a user address and encodes a parameterless call with empty data', () => {
            const v = vectors.contractCall.tx;
            const base = { chainId: v.chainId, version: v.version, from: v.from, method: 'query', codeHash: v.codeHash, sandboxHash: v.sandboxHash, sequence: 3 };
            assert.throws(() => W.buildContractCallTx({ ...base, to: vectors.accounts[1].address }));
            assert.ok(W.isContractAddress(v.to));
            assert.equal(W.buildContractCallTx({ ...base, to: v.to }).data, '');
            assert.throws(() => W.buildContractCallTx({ ...base, to: v.to, data: 'abcd' as unknown as Record<string, unknown> }));
        });
    });

    describe('wallet file', () => {
        it('applies the password policy', () => {
            assert.ok(W.validatePassword(vectors.walletFile.password).isValid);
            assert.ok(!W.validatePassword('short').isValid);
            assert.ok(!W.validatePassword('nouppercase#2026').isValid);
            assert.ok(!W.validatePassword('').isValid);
        });

        it('the scrypt key equals OpenSSL scrypt for a fresh salt, and refuses bad parameters', () => {
            const salt = W.randomBytes(32);
            const params = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 };
            const expected = scryptSync('Wallet-File#2026', salt, 32, { N: params.N, r: params.r, p: params.p });
            assert.equal(hex(W.deriveKey('Wallet-File#2026', salt, params)), expected.toString('hex'));
            assert.equal(hex(W.deriveKey('Wallet-File#2026', salt, { ...params, p: 2 })), scryptSync('Wallet-File#2026', salt, 32, { N: params.N, r: 8, p: 2 }).toString('hex'));
            assert.throws(() => W.deriveKey('x', salt, { ...params, N: 1000 }));
            assert.throws(() => W.deriveKey('x', salt, { ...params, dkLen: 16 }));
            assert.throws(() => W.deriveKey('x', salt, { ...params, r: 0 }));
        });

        it('opens the payload encrypted by OpenSSL scrypt and AES-GCM with the default parameters', async () => {
            const v = vectors.walletFile;
            assert.equal(v.payload.kdf, W.WALLET_KDF);
            assert.deepEqual(v.payload.kdfParams, W.DEFAULT_SCRYPT_PARAMS);
            const file: W.WalletData = { version: 1, ...v.payload, network: 'devnet', createdAt: new Date().toISOString(), metadata: {} };
            assert.equal(await W.openWalletFile(file, v.password), v.mnemonic);
        });

        it('file round trip with the default parameters, wrong password and password change', async () => {
            const mnemonic = W.generateMnemonic();
            const password = 'Wallet-File#2026';
            const file = await W.createWalletFile(mnemonic, password, { network: 'devnet' });
            assert.equal(file.version, 1);
            assert.equal(file.kdf, 'scrypt');
            assert.deepEqual(file.kdfParams, W.DEFAULT_SCRYPT_PARAMS);
            assert.equal(await W.openWalletFile(JSON.parse(JSON.stringify(file)) as W.WalletData, password), mnemonic);
            await assert.rejects(W.openWalletFile(file, 'Wrong-Password#2026'));
            await assert.rejects(W.openWalletFile({ ...file, version: 2 }, password));
            await assert.rejects(W.openWalletFile({ ...file, kdf: 'argon2id' as unknown as 'scrypt' }, password));
            const changed = await W.changeWalletPassword(file, password, 'Another-Pass#2027');
            assert.equal(await W.openWalletFile(changed, 'Another-Pass#2027'), mnemonic);
            assert.equal(changed.createdAt, file.createdAt);
        });
    });
});
