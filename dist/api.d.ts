/**
 * Client of the Accountable Node's public HTTP API. Entry point: streembit-bc-sdk/api.
 *
 * The paths and response shapes are the node's public routes (node/src/api/rest/routes/public in the
 * blockchain repository), kept in one place so that a change is made here, and only here. Every response
 * is checked for the fields a wallet needs; a response of another shape is reported as an error instead
 * of producing a wrong transaction. The client carries only the calls a wallet makes today; the node
 * answers more (GET /api/v1/transactions/:txid, and the asset and blockCount record fields) that are added
 * here with their first caller.
 *
 *   GET  /api/v1/status                              -> { chainId, version, network, height }
 *   GET  /api/v1/accounts/:address                   -> { address, balance, sequence }
 *                                                       a valid address always answers; 0 and 0 when the
 *                                                       chain has not seen it
 *   GET  /api/v1/accounts/:address/transactions      -> { address, transactions: TransactionRecord[] }
 *                                                       newest first, ?limit= up to 50, default 20
 *   GET  /api/v1/contracts/:cid                      -> { cid, codeHash, sandboxHash, location }
 *                                                       of the active version
 *   POST /api/v1/transactions  (body: txToString(tx), canonical JSON) -> { txid, status }
 *                                                       200 status included: the engine wrote the block;
 *                                                       202 status pending: still processing when the
 *                                                       node's wait ended; 400 when rejected
 *
 * Two addresses. The node address (configureApi) is the Accountable Node itself: submission and contract
 * metadata always go there. The read address (configureReadApi) is a read mirror that serves status,
 * account and history with the same paths and shapes, so that wallet and explorer reads do not load the
 * node; while no read address is configured, reads go to the node address, so a consumer that calls
 * configureApi only sees no change.
 *
 * Sequence rule: a transaction is built from the node's state, never from the read address. The mirror
 * can be a block or two behind the node, and a quick second send built on its sequence would reuse a
 * sequence and be rejected. Code that builds a transaction reads fetchStatus('node') and
 * fetchAccount(address, 'node'); balances, history and the status display use the read address.
 *
 * A browser wallet calls the API from another origin, so the node answers with CORS headers for the
 * origins in its rest.corsOrigins configuration (GET and POST with a JSON body, including the preflight),
 * and the read mirror answers its GET routes with Access-Control-Allow-Origin: *.
 *
 * fetch and AbortController only; runs in Node, in the browser and in NW.js.
 *
 * An error answer is { error: <ErrorCode>, message, details } with a 4xx or 5xx status. request() turns
 * it into an ApiError whose message is the node's message, code the node's error, details its details
 * and status the HTTP status. A request that did not reach the server, an answer that is not JSON or
 * an answer without a required field is an ApiError with an empty code, and its message names the address
 * it called: "the node API at <url>" or "the read API at <url>".
 */
export interface ChainStatus {
    chainId: number;
    version: number;
    network: string;
    height: number;
    /** Hash of the tip block, '' on an empty chain; two addresses on the same chain report the same tip at the same height */
    tip: string;
}
export interface AccountInfo {
    address: string;
    /** decimal string */
    balance: string;
    /** the account's current sequence; the next transaction uses sequence + 1 */
    sequence: number;
}
export interface ContractMeta {
    cid: string;
    codeHash: string;
    sandboxHash: string;
    location: string;
}
export interface TransactionRecord {
    txid: string;
    type: string;
    from: string;
    to: string;
    amount: string;
    timestamp: number;
    method?: string;
    status?: string;
}
export interface SubmitResult {
    txid: string;
    /** included: the engine wrote the block (200); pending: still processing when the node's wait ended (202) */
    status: 'included' | 'pending';
}
export declare class ApiError extends Error {
    /** HTTP status of the answer; 0 when the request did not reach the node. */
    readonly status: number;
    /** The node's error code, an ErrorCode name such as ERR_INSUFFICIENT_BALANCE; empty when the node sent none. */
    readonly code: string;
    /** The node's details object, when it sent one. */
    readonly details: unknown;
    constructor(message: string, status?: number, code?: string, details?: unknown);
}
/** Which address a call goes to: the Accountable Node, or the read address (the node while none is configured). */
export type ApiAddress = 'node' | 'read';
/** Base URL of the node API, without a trailing slash. Reads use it too while no read address is configured. */
export declare function configureApi(url: string): void;
/** Base URL of the read API (a read mirror), without a trailing slash; an empty string sends reads to the node again. */
export declare function configureReadApi(url: string): void;
/** The node address. */
export declare function apiBaseUrl(): string;
/** The read address, or the node address while no read address is configured. */
export declare function readApiBaseUrl(): string;
/**
 * Chain id, protocol version, network name and height. From the read address by default; code that builds a
 * transaction passes 'node' (see the sequence rule above).
 */
export declare function fetchStatus(from?: ApiAddress): Promise<ChainStatus>;
/**
 * Balance and current sequence of an address; an unknown address is answered as balance 0, sequence 0. From
 * the read address by default; the sequence of a transaction being built is read with 'node' (see the
 * sequence rule above).
 */
export declare function fetchAccount(address: string, from?: ApiAddress): Promise<AccountInfo>;
/** Most recent transactions of an address, newest first. From the read address. */
export declare function fetchTransactions(address: string, limit?: number): Promise<TransactionRecord[]>;
/** The contract metadata a call transaction must carry: what the node reads from acct/<cid>/meta. From the node address. */
export declare function fetchContract(cid: string): Promise<ContractMeta>;
/** Submit a signed transaction (the JSON txToString produces) to the node address. */
export declare function submitTransaction(txJson: string): Promise<SubmitResult>;
//# sourceMappingURL=api.d.ts.map