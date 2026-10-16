/**
 * secp256k1 signing: SHA-256 of the data, ECDSA with @noble/curves, DER output, low-S.
 *
 * verify() accepts high-S signatures as well, so that signatures produced by OpenSSL, which emits high-S
 * about half of the time, verify too.
 *
 * Everything that signs goes through the Signer interface: the in-memory SoftwareSigner or a hardware
 * device. SoftwareSigner holds the private key for the lifetime of the object; create one for one action
 * and dispose it.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from './hashing';
import { bytesToHex, hexToBytes, utf8ToBytes } from './encoding';
import { createUserAddress } from './address';

/** Anything that can sign for an address: the in-memory SoftwareSigner or a hardware device. */
export interface Signer {
    /** 66 hex chars, compressed */
    readonly publicKey: string;
    /** 'S' address derived from publicKey */
    readonly address: string;
    /** DER signature as hex over the raw data (hex) */
    sign(dataHex: string): Promise<string>;
}

/** Sign raw data (hex) with a private key (hex). Returns the DER-encoded ECDSA signature as hex. */
export function sign(dataHex: string, privateKeyHex: string): string {
    if (typeof privateKeyHex !== 'string' || privateKeyHex.length !== 64) {
        throw new Error('Private key must be 64 hex characters (32 bytes)');
    }
    const digest = sha256(hexToBytes(dataHex));
    const compact = secp256k1.sign(digest, hexToBytes(privateKeyHex), { prehash: false, lowS: true });
    const der = secp256k1.Signature.fromBytes(compact, 'compact').toBytes('der');
    return bytesToHex(der);
}

/** Verify a DER signature (hex) over raw data (hex) with a compressed public key (hex). */
export function verify(dataHex: string, signatureHex: string, publicKeyHex: string): boolean {
    try {
        const publicKey = hexToBytes(publicKeyHex);
        if (publicKey.length !== 33) {
            return false;
        }
        const digest = sha256(hexToBytes(dataHex));
        return secp256k1.verify(hexToBytes(signatureHex), digest, publicKey, { prehash: false, format: 'der', lowS: false });
    } catch {
        return false;
    }
}

/** Compressed public key (66 hex) from a private key (64 hex). */
export function getPublicKey(privateKeyHex: string): string {
    if (typeof privateKeyHex !== 'string' || privateKeyHex.length !== 64) {
        throw new Error('Private key must be 64 hex characters (32 bytes)');
    }
    return bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKeyHex), true));
}

/** New random key pair, both as hex. */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
    const privateKey = secp256k1.utils.randomSecretKey();
    return { privateKey: bytesToHex(privateKey), publicKey: bytesToHex(secp256k1.getPublicKey(privateKey, true)) };
}

/** Sign-and-verify self test of a key pair. */
export function validateKeyPair(publicKeyHex: string, privateKeyHex: string): boolean {
    if (typeof privateKeyHex !== 'string' || privateKeyHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(privateKeyHex)) {
        return false;
    }
    if (typeof publicKeyHex !== 'string' || publicKeyHex.length !== 66 || !/^[0-9a-fA-F]+$/.test(publicKeyHex)) {
        return false;
    }
    const payloadHex = bytesToHex(utf8ToBytes('validateKeyPair-test'));
    try {
        const signatureHex = sign(payloadHex, privateKeyHex);
        return verify(payloadHex, signatureHex, publicKeyHex);
    } catch {
        return false;
    }
}

/** In-memory signer over a private key. Call dispose() as soon as the signing action is complete. */
export class SoftwareSigner implements Signer {
    private privateKey: string;
    public readonly publicKey: string;
    public readonly address: string;

    constructor(privateKeyHex: string) {
        if (typeof privateKeyHex !== 'string' || privateKeyHex.length !== 64) {
            throw new Error('Private key must be 64 hex characters (32 bytes)');
        }
        this.privateKey = privateKeyHex;
        this.publicKey = getPublicKey(privateKeyHex);
        this.address = createUserAddress(this.publicKey);
    }

    public async sign(dataHex: string): Promise<string> {
        if (!this.privateKey) {
            throw new Error('Signer has been disposed');
        }
        return sign(dataHex, this.privateKey);
    }

    /** Drops the key reference. JavaScript cannot guarantee the bytes are erased; this limits the window. */
    public dispose(): void {
        this.privateKey = '';
    }
}
