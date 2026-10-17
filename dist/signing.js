"use strict";
/**
 * secp256k1 signing: SHA-256 of the data, ECDSA with @noble/curves, DER output, low-S, RFC 6979 nonce
 * hedged with extra entropy (RFC 6979 section 3.6).
 *
 * verify() accepts high-S signatures as well, so that signatures produced by OpenSSL, which emits high-S
 * about half of the time, verify too.
 *
 * Everything that signs goes through the Signer interface: the in-memory SoftwareSigner or a hardware
 * device. SoftwareSigner holds the private key for the lifetime of the object; create one for one action
 * and dispose it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SoftwareSigner = void 0;
exports.sign = sign;
exports.verify = verify;
exports.getPublicKey = getPublicKey;
exports.generateKeyPair = generateKeyPair;
exports.validateKeyPair = validateKeyPair;
const secp256k1_js_1 = require("@noble/curves/secp256k1.js");
const hashing_1 = require("./hashing");
const encoding_1 = require("./encoding");
const address_1 = require("./address");
/** Sign raw data (hex) with a private key (hex). Returns the DER-encoded ECDSA signature as hex. */
function sign(dataHex, privateKeyHex) {
    if (typeof privateKeyHex !== 'string' || privateKeyHex.length !== 64) {
        throw new Error('Private key must be 64 hex characters (32 bytes)');
    }
    const digest = (0, hashing_1.sha256)((0, encoding_1.hexToBytes)(dataHex));
    const compact = secp256k1_js_1.secp256k1.sign(digest, (0, encoding_1.hexToBytes)(privateKeyHex), { prehash: false, lowS: true, extraEntropy: true });
    const der = secp256k1_js_1.secp256k1.Signature.fromBytes(compact, 'compact').toBytes('der');
    return (0, encoding_1.bytesToHex)(der);
}
/** Verify a DER signature (hex) over raw data (hex) with a compressed public key (hex). */
function verify(dataHex, signatureHex, publicKeyHex) {
    try {
        const publicKey = (0, encoding_1.hexToBytes)(publicKeyHex);
        if (publicKey.length !== 33) {
            return false;
        }
        const digest = (0, hashing_1.sha256)((0, encoding_1.hexToBytes)(dataHex));
        return secp256k1_js_1.secp256k1.verify((0, encoding_1.hexToBytes)(signatureHex), digest, publicKey, { prehash: false, format: 'der', lowS: false });
    }
    catch {
        return false;
    }
}
/** Compressed public key (66 hex) from a private key (64 hex). */
function getPublicKey(privateKeyHex) {
    if (typeof privateKeyHex !== 'string' || privateKeyHex.length !== 64) {
        throw new Error('Private key must be 64 hex characters (32 bytes)');
    }
    return (0, encoding_1.bytesToHex)(secp256k1_js_1.secp256k1.getPublicKey((0, encoding_1.hexToBytes)(privateKeyHex), true));
}
/** New random key pair, both as hex. */
function generateKeyPair() {
    const privateKey = secp256k1_js_1.secp256k1.utils.randomSecretKey();
    return { privateKey: (0, encoding_1.bytesToHex)(privateKey), publicKey: (0, encoding_1.bytesToHex)(secp256k1_js_1.secp256k1.getPublicKey(privateKey, true)) };
}
/** Sign-and-verify self test of a key pair; false on a malformed key, throws when signing itself fails. */
function validateKeyPair(publicKeyHex, privateKeyHex) {
    if (typeof privateKeyHex !== 'string' || privateKeyHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(privateKeyHex)) {
        return false;
    }
    if (typeof publicKeyHex !== 'string' || publicKeyHex.length !== 66 || !/^[0-9a-fA-F]+$/.test(publicKeyHex)) {
        return false;
    }
    const payloadHex = (0, encoding_1.bytesToHex)((0, encoding_1.utf8ToBytes)('validateKeyPair-test'));
    let signatureHex;
    try {
        signatureHex = sign(payloadHex, privateKeyHex);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`validateKeyPair failed to sign self-test payload with NODE_PRIVATE_KEY: ${message}`);
    }
    return verify(payloadHex, signatureHex, publicKeyHex);
}
/** In-memory signer over a private key. Call dispose() as soon as the signing action is complete. */
class SoftwareSigner {
    privateKey;
    publicKey;
    address;
    constructor(privateKeyHex) {
        if (typeof privateKeyHex !== 'string' || privateKeyHex.length !== 64) {
            throw new Error('Private key must be 64 hex characters (32 bytes)');
        }
        this.privateKey = privateKeyHex;
        this.publicKey = getPublicKey(privateKeyHex);
        this.address = (0, address_1.createUserAddress)(this.publicKey);
    }
    async sign(dataHex) {
        if (!this.privateKey) {
            throw new Error('Signer has been disposed');
        }
        return sign(dataHex, this.privateKey);
    }
    /** Drops the key reference. JavaScript cannot guarantee the bytes are erased; this limits the window. */
    dispose() {
        this.privateKey = '';
    }
}
exports.SoftwareSigner = SoftwareSigner;
