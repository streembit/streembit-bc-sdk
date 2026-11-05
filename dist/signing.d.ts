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
export declare function sign(dataHex: string, privateKeyHex: string): string;
/** Verify a DER signature (hex) over raw data (hex) with a compressed public key (hex). */
export declare function verify(dataHex: string, signatureHex: string, publicKeyHex: string): boolean;
/** Compressed public key (66 hex) from a private key (64 hex). */
export declare function getPublicKey(privateKeyHex: string): string;
/** New random key pair, both as hex. */
export declare function generateKeyPair(): {
    privateKey: string;
    publicKey: string;
};
/** Sign-and-verify self test of a key pair; false on a malformed key, throws when signing itself fails. */
export declare function validateKeyPair(publicKeyHex: string, privateKeyHex: string): boolean;
/** In-memory signer over a private key. Call dispose() as soon as the signing action is complete. */
export declare class SoftwareSigner implements Signer {
    private privateKey;
    readonly publicKey: string;
    readonly address: string;
    constructor(privateKeyHex: string);
    sign(dataHex: string): Promise<string>;
    /** Drops the key reference. JavaScript cannot guarantee the bytes are erased; this limits the window. */
    dispose(): void;
}
//# sourceMappingURL=signing.d.ts.map