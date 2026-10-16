/**
 * Base58 and Base58Check encoding for Streembit addresses (BigInt arithmetic, Bitcoin alphabet).
 */
export declare function base58Encode(data: Uint8Array): string;
export declare function base58Decode(str: string): Uint8Array;
/** [version][payload][4-byte checksum] to Base58. */
export declare function base58checkEncode(version: number, payload: Uint8Array): string;
/** Verifies the checksum and returns the payload without the version byte. */
export declare function base58checkDecode(str: string): Uint8Array;
export declare function base58checkDecodeWithVersion(str: string): {
    version: number;
    payload: Uint8Array;
};
//# sourceMappingURL=base58.d.ts.map