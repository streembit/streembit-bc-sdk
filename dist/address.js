"use strict";
/**
 * Streembit addresses: derivation, validation and the contract identity.
 *
 * User address     = Base58Check(ADDRESS_PREFIX_USER || HASH160(compressed public key))      -> starts with 'S'
 * Contract address = Base58Check(ADDRESS_PREFIX_CONTRACT || HASH160(contract preimage))      -> starts with 'C'
 * The version bytes come from streembit-bc-types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUserAddress = createUserAddress;
exports.createContractAddress = createContractAddress;
exports.encodeContractAddress = encodeContractAddress;
exports.validateAddress = validateAddress;
exports.isUserAddress = isUserAddress;
exports.isContractAddress = isContractAddress;
exports.decodeAddress = decodeAddress;
exports.getAddressType = getAddressType;
exports.publicKeyOwnsAddress = publicKeyOwnsAddress;
const streembit_bc_types_1 = require("streembit-bc-types");
const hashing_1 = require("./hashing");
const base58_1 = require("./base58");
const encoding_1 = require("./encoding");
/** User address from a public key (33-byte compressed or 65-byte uncompressed; wallets always use compressed). */
function createUserAddress(publicKey) {
    const bytes = typeof publicKey === 'string' ? (0, encoding_1.hexToBytes)(publicKey) : publicKey;
    if (bytes.length !== 33 && bytes.length !== 65) {
        throw new Error('Invalid public key length');
    }
    return (0, base58_1.base58checkEncode)(streembit_bc_types_1.ADDRESS_PREFIX_USER, (0, hashing_1.hash160)(bytes));
}
/**
 * Contract address of a deployed contract: HASH160(filePath || deployerPubKey || chainId), chainId as
 * 4 bytes big-endian. The file path is the contract's canonical path under the node's contract folder,
 * so a contract keeps its identity across code upgrades.
 */
function createContractAddress(filePath, deployerPubKey, chainId) {
    if (!filePath || filePath.trim().length === 0) {
        throw new Error('File path is required to derive contract address');
    }
    if (!filePath.startsWith('dist/node/smart-contracts/')) {
        throw new Error(`Contract path must start with dist/node/smart-contracts/ - got: ${filePath}`);
    }
    if (!deployerPubKey || deployerPubKey.length !== 66) {
        throw new Error('Deployer public key must be 66 hex characters (33 bytes compressed)');
    }
    if (!Number.isInteger(chainId) || chainId < 0 || chainId > 0xffffffff) {
        throw new Error('chainId must be an unsigned 32-bit integer');
    }
    const chainIdBytes = new Uint8Array(4);
    new DataView(chainIdBytes.buffer).setUint32(0, chainId, false);
    const preimage = (0, encoding_1.concat)((0, encoding_1.utf8ToBytes)(filePath), (0, encoding_1.hexToBytes)(deployerPubKey), chainIdBytes);
    return (0, base58_1.base58checkEncode)(streembit_bc_types_1.ADDRESS_PREFIX_CONTRACT, (0, hashing_1.hash160)(preimage));
}
/**
 * Contract address from a 32-byte contract id: HASH160("SB-CID" || chainId || cid32), chainId as
 * 4 bytes little-endian.
 */
function encodeContractAddress(chainId, cid) {
    if (!Number.isInteger(chainId) || chainId < 0 || chainId > 0xffffffff) {
        throw new Error('chainId must be an unsigned 32-bit integer');
    }
    const chainIdBytes = new Uint8Array(4);
    new DataView(chainIdBytes.buffer).setUint32(0, chainId, true);
    const preimage = (0, encoding_1.concat)((0, encoding_1.utf8ToBytes)('SB-CID'), chainIdBytes, cid);
    return (0, base58_1.base58checkEncode)(streembit_bc_types_1.ADDRESS_PREFIX_CONTRACT, (0, hashing_1.hash160)(preimage));
}
/** Base58Check with a known version byte and a 20-byte payload. */
function validateAddress(address) {
    try {
        const rawData = (0, base58_1.base58Decode)(address);
        if (rawData.length < 25)
            return false;
        const version = rawData[0];
        if (version !== streembit_bc_types_1.ADDRESS_PREFIX_USER && version !== streembit_bc_types_1.ADDRESS_PREFIX_CONTRACT)
            return false;
        const payload = (0, base58_1.base58checkDecode)(address);
        return payload.length === 20;
    }
    catch {
        return false;
    }
}
function isUserAddress(address) {
    try {
        const rawData = (0, base58_1.base58Decode)(address);
        if (rawData.length < 25)
            return false;
        if (rawData[0] !== streembit_bc_types_1.ADDRESS_PREFIX_USER)
            return false;
        const payload = (0, base58_1.base58checkDecode)(address);
        return payload.length === 20;
    }
    catch {
        return false;
    }
}
function isContractAddress(address) {
    try {
        const rawData = (0, base58_1.base58Decode)(address);
        if (rawData.length < 25)
            return false;
        if (rawData[0] !== streembit_bc_types_1.ADDRESS_PREFIX_CONTRACT)
            return false;
        const payload = (0, base58_1.base58checkDecode)(address);
        return payload.length === 20;
    }
    catch {
        return false;
    }
}
/** Type and HASH160 payload of a valid address; throws on an invalid one. */
function decodeAddress(address) {
    const { version, payload } = (0, base58_1.base58checkDecodeWithVersion)(address);
    if (payload.length !== 20) {
        throw new Error('Invalid address payload length');
    }
    if (version === streembit_bc_types_1.ADDRESS_PREFIX_USER) {
        return { type: 'user', hash: payload };
    }
    if (version === streembit_bc_types_1.ADDRESS_PREFIX_CONTRACT) {
        return { type: 'contract', hash: payload };
    }
    throw new Error(`Unknown address version: 0x${version.toString(16)}`);
}
function getAddressType(address) {
    try {
        return decodeAddress(address).type;
    }
    catch {
        return 'invalid';
    }
}
/**
 * True when the compressed public key (hex) derives to the address. The node enforces the same rule on
 * every transaction, so a wallet checks it before signing.
 */
function publicKeyOwnsAddress(address, publicKeyHex) {
    if (!publicKeyHex || publicKeyHex.length !== 66) {
        return false;
    }
    try {
        return createUserAddress(publicKeyHex) === address;
    }
    catch {
        return false;
    }
}
