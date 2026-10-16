"use strict";
/**
 * Hash functions of the protocol: Blake2b-256, SHA-256, RIPEMD-160, HASH160, double SHA-256 and the
 * transaction salt. Implemented with @noble/hashes (pure JavaScript, audited), so the same code runs in
 * Node, in the browser and in NW.js.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.blake2b256 = blake2b256;
exports.sha256 = sha256;
exports.ripemd160 = ripemd160;
exports.hash160 = hash160;
exports.doubleHash256 = doubleHash256;
exports.createSalt = createSalt;
const sha2_js_1 = require("@noble/hashes/sha2.js");
const legacy_js_1 = require("@noble/hashes/legacy.js");
const blake2_js_1 = require("@noble/hashes/blake2.js");
const encoding_1 = require("./encoding");
/** Blake2b-256, the primary hash of the protocol (32-byte output). */
function blake2b256(data) {
    return (0, blake2_js_1.blake2b)(data, { dkLen: 32 });
}
function sha256(data) {
    return (0, sha2_js_1.sha256)(data);
}
function ripemd160(data) {
    return (0, legacy_js_1.ripemd160)(data);
}
/** HASH160 = RIPEMD160(SHA256(data)), used for address payloads. */
function hash160(data) {
    return (0, legacy_js_1.ripemd160)((0, sha2_js_1.sha256)(data));
}
/** SHA256(SHA256(data)), used for the Base58Check checksum. */
function doubleHash256(data) {
    return (0, sha2_js_1.sha256)((0, sha2_js_1.sha256)(data));
}
/** Transaction salt: first 16 bytes (32 hex chars) of Blake2b-256 over the deterministic JSON of the input. */
function createSalt(saltData) {
    const encoded = (0, encoding_1.encodeDeterministicJSON)(saltData);
    const hash = blake2b256(encoded);
    return (0, encoding_1.bytesToHex)(hash).substring(0, 32);
}
