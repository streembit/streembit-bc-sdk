/**
 * npm run vectors
 *
 * Writes tests/wallet-vectors.json: the values the wallet core must reproduce byte for byte. Everything
 * that has an implementation outside this package is produced by that implementation, not by src/:
 * keys by bip39, bip32 and tiny-secp256k1; SHA-256, RIPEMD-160, the ECDSA signature, the scrypt key and
 * AES-256-GCM by node:crypto (OpenSSL); Blake2b by blakejs. Only the deterministic JSON and the
 * Base58Check encoding, which exist nowhere else, come from src/.
 *
 * The mnemonic and keys below are public test values. Never use them for anything but tests.
 *
 *   npx tsx scripts/vectors.ts [output path]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createSign, createPrivateKey, createECDH, createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import * as blake from 'blakejs';
import { mnemonicToSeedSync } from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { ADDRESS_PREFIX_USER, ADDRESS_PREFIX_CONTRACT, AssetId, ContractLocation, SBRIT_FEE_AMOUNT, TxType } from 'streembit-bc-types';
import type { Transaction, ContractCallTransaction } from 'streembit-bc-types';

import { encodeDeterministicJSON, base58checkEncode, serializeForSigning, STREEMBIT_COIN_TYPE, DEFAULT_SCRYPT_PARAMS, WALLET_KDF } from '../src';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_PASSWORD = 'Wallet-Vectors#2026';
const CHAIN_ID = 1337;
const VERSION = 1;

const sha256 = (data: Buffer): Buffer => createHash('sha256').update(data).digest();
const ripemd160 = (data: Buffer): Buffer => createHash('ripemd160').update(data).digest();
const hash160 = (data: Buffer): Buffer => ripemd160(sha256(data));
const blake2b256 = (data: Buffer): Buffer => Buffer.from(blake.blake2b(data, undefined, 32));
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

function deriveAccount(seed: Buffer, accountIndex: number, addressIndex: number): { path: string; privateKey: string; publicKey: string; address: string } {
    const derivationPath = `m/44'/${STREEMBIT_COIN_TYPE}'/${accountIndex}'/0/${addressIndex}`;
    const node = BIP32Factory(ecc).fromSeed(seed).derivePath(derivationPath);
    if (!node.privateKey) throw new Error(`[vectors] No private key at ${derivationPath}`);
    const publicKey = Buffer.from(node.publicKey);
    return { path: derivationPath, privateKey: hex(node.privateKey), publicKey: hex(publicKey), address: base58checkEncode(ADDRESS_PREFIX_USER, hash160(publicKey)) };
}

/** HASH160("SB-CID" || chainId LE || cid32) under the contract prefix. */
function contractAddress(chainId: number, cid: Buffer): string {
    const chainIdLE = Buffer.alloc(4);
    chainIdLE.writeUInt32LE(chainId, 0);
    return base58checkEncode(ADDRESS_PREFIX_CONTRACT, hash160(Buffer.concat([Buffer.from('SB-CID', 'utf8'), chainIdLE, cid])));
}

/** OpenSSL ECDSA over SHA-256 of the data, DER output. */
function opensslSign(dataHex: string, privateKeyHex: string): string {
    const privateKeyBuf = Buffer.from(privateKeyHex, 'hex');
    const ecdh = createECDH('secp256k1');
    ecdh.setPrivateKey(privateKeyBuf);
    const pub = ecdh.getPublicKey(null, 'uncompressed');
    const key = createPrivateKey({
        key: { kty: 'EC', crv: 'secp256k1', d: privateKeyBuf.toString('base64url'), x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') },
        format: 'jwk'
    });
    return createSign('SHA256').update(Buffer.from(dataHex, 'hex')).sign(key).toString('hex');
}

/** Blake2b-256 over chainId || timestamp || payload || JSON(signature) || salt || sequence. */
function txid(tx: Transaction): string {
    const payload: Record<string, unknown> = { version: tx.version, chainid: tx.chainId, type: tx.type, from: tx.from, to: tx.to, amount: tx.amount, asset: tx.asset };
    if (tx.type === TxType.CONTRACT_CALL) {
        payload.method = (tx as ContractCallTransaction).method;
        payload.data = (tx as ContractCallTransaction).data;
    }
    const image = Buffer.concat([
        Buffer.from(String(tx.chainId)),
        Buffer.from(String(tx.timestamp)),
        Buffer.from(JSON.stringify(payload, Object.keys(payload).sort())),
        Buffer.from(JSON.stringify(tx.signature)),
        Buffer.from(tx.salt),
        Buffer.from(String(tx.sequence))
    ]);
    return blake2b256(image).toString('hex');
}

function createSalt(saltData: string): string {
    return blake2b256(Buffer.from(encodeDeterministicJSON(saltData))).toString('hex').substring(0, 32);
}

function signedTransaction(tx: Transaction, privateKey: string, publicKey: string): { tx: Transaction; preimageHex: string; txid: string } {
    const preimageHex = serializeForSigning(tx);
    tx.signature = [{ publickey: publicKey, signature: opensslSign(preimageHex, privateKey) }];
    return { tx, preimageHex, txid: txid(tx) };
}

/** A second officer's detached signature over the same preimage, and the pending-store id of the unsigned call. */
function cosigned(call: { tx: Transaction; preimageHex: string; txid: string }, cosigner: { privateKey: string; publicKey: string }): { tx: Transaction; preimageHex: string; txid: string; cosignature: { publickey: string; signature: string }; pendingTxId: string } {
    return {
        ...call,
        cosignature: { publickey: cosigner.publicKey, signature: opensslSign(call.preimageHex, cosigner.privateKey) },
        pendingTxId: blake2b256(Buffer.from(call.preimageHex, 'hex')).toString('hex')
    };
}

/** OpenSSL scrypt with the default parameters and AES-256-GCM. */
function encryptPayload(data: string, password: string): Record<string, unknown> {
    const salt = randomBytes(32);
    const iv = randomBytes(16);
    const params = DEFAULT_SCRYPT_PARAMS;
    const key = scryptSync(password, salt, params.dkLen, { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.r * (params.N + params.p + 1) + 1024 });
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    return { encrypted: encrypted.toString('base64'), salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), kdf: WALLET_KDF, kdfParams: { ...params } };
}

async function main(): Promise<void> {
    const outputPath = path.resolve(process.cwd(), process.argv[2] ?? path.join('tests', 'wallet-vectors.json'));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as { name: string; version: string };

    const seed = mnemonicToSeedSync(TEST_MNEMONIC, '');
    const accounts = [deriveAccount(seed, 0, 0), deriveAccount(seed, 0, 1), deriveAccount(seed, 1, 0)];
    const sender = accounts[0];
    const recipient = accounts[1];
    const cid32 = 'ef'.repeat(32);
    const contract = contractAddress(CHAIN_ID, Buffer.from(cid32, 'hex'));

    const encodingInput = { z: 1, a: { d: 'x', c: [3, { b: 2, a: 1 }] }, u: undefined, big: 10n };
    const hashInput = 'streembit hashing vector';
    const hashBytes = Buffer.from(hashInput, 'utf8');
    const signatureDataHex = Buffer.from('{"a":1}', 'utf8').toString('hex');

    const transfer = signedTransaction({
        version: VERSION,
        chainId: CHAIN_ID,
        type: TxType.TRANSFER,
        from: sender.address,
        to: recipient.address,
        amount: '12.5',
        asset: AssetId.SBRIT,
        sequence: 1,
        timestamp: 1760000000000,
        salt: createSalt('wallet-vectors transfer'),
        fee: { amount: SBRIT_FEE_AMOUNT, asset: AssetId.SBRIT, to: '' },
        signature: [],
        validatorAttestations: []
    } as unknown as Transaction, sender.privateKey, sender.publicKey);

    const contractCall = cosigned(signedTransaction({
        version: VERSION,
        chainId: CHAIN_ID,
        type: TxType.CONTRACT_CALL,
        from: sender.address,
        to: contract,
        amount: '0',
        asset: AssetId.SBRIT,
        sequence: 2,
        timestamp: 1760000001000,
        salt: createSalt('wallet-vectors contract call'),
        fee: { amount: SBRIT_FEE_AMOUNT, asset: AssetId.SBRIT, to: '' },
        signature: [],
        validatorAttestations: [],
        data: encodeDeterministicJSON({ validatorId: 'v1' }, { asHex: true }),
        method: 'register',
        codeHash: 'ab'.repeat(32),
        sandboxHash: 'cd'.repeat(32),
        cid: contract,
        location: ContractLocation.FS
    } as unknown as Transaction, sender.privateKey, sender.publicKey), recipient);

    const vectors = {
        generatedBy: { repository: pkg.name, version: pkg.version, generatedAt: new Date().toISOString() },
        chainId: CHAIN_ID,
        version: VERSION,
        mnemonic: TEST_MNEMONIC,
        accounts,
        contractAddress: { cid32, address: contract },
        encoding: { input: { z: 1, a: { d: 'x', c: [3, { b: 2, a: 1 }] }, big: '10n' }, note: 'input.big is the BigInt 10n and input.u is undefined in the encoder call', json: encodeDeterministicJSON(encodingInput, { asString: true }) },
        hashes: {
            input: hashInput,
            blake2b256: blake2b256(hashBytes).toString('hex'),
            sha256: sha256(hashBytes).toString('hex'),
            ripemd160: ripemd160(hashBytes).toString('hex'),
            hash160: hash160(hashBytes).toString('hex'),
            doubleSha256: sha256(sha256(hashBytes)).toString('hex')
        },
        salt: { input: 'wallet-vectors salt', salt: createSalt('wallet-vectors salt') },
        signature: { dataHex: signatureDataHex, privateKey: sender.privateKey, publicKey: sender.publicKey, signature: opensslSign(signatureDataHex, sender.privateKey) },
        transfer,
        contractCall,
        walletFile: {
            password: TEST_PASSWORD,
            mnemonic: TEST_MNEMONIC,
            payload: encryptPayload(JSON.stringify({ mnemonic: TEST_MNEMONIC }), TEST_PASSWORD),
            keyPayload: encryptPayload(JSON.stringify({ privateKey: sender.privateKey }), TEST_PASSWORD)
        }
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(vectors, null, 2) + '\n');
    console.log(`[vectors] Wrote ${path.relative(process.cwd(), outputPath)} for ${pkg.name} ${pkg.version}`);
}

main().catch((err: unknown) => {
    console.error(`[vectors] Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
