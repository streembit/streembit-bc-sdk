/**
 * Client of the Accountable Node's public HTTP API. Entry point: streembit-bc-sdk/api.
 *
 * The node does not publish this API yet (October 2026). The paths and response shapes below are the
 * wallets' requirements of it, kept in one place so that they are adjusted here, and only here, once the
 * node's routes exist. Every response is checked for the fields a wallet needs; a response of another
 * shape is reported as an error instead of producing a wrong transaction.
 *
 *   GET  /api/v1/status                              -> { chainId, version, network, height }
 *   GET  /api/v1/accounts/:address                   -> { address, balance, sequence }
 *   GET  /api/v1/accounts/:address/transactions      -> { transactions: TransactionRecord[] }
 *   GET  /api/v1/contracts/:cid                      -> { cid, codeHash, sandboxHash, location }
 *   POST /api/v1/transactions  (body: the signed tx) -> { txid }
 *
 * A browser wallet calls the API from another origin, so the node must answer with CORS headers that
 * allow it (Access-Control-Allow-Origin for GET and POST with a JSON body, including the preflight).
 *
 * fetch and AbortController only; runs in Node, in the browser and in NW.js.
 *
 *   An error answer is { error: <ErrorCode>, message, details } with a 4xx or 5xx status. request() turns
 *   it into an ApiError whose message is the node's message, code the node's error, details its details
 *   and status the HTTP status. A request that did not reach the node, or an answer that is not JSON,
 *   is an ApiError with an empty code.
 */
export interface ChainStatus {
    chainId: number;
    version: number;
    network: string;
    height: number;
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
/** Base URL of the node API, without a trailing slash. */
export declare function configureApi(url: string): void;
export declare function apiBaseUrl(): string;
/** Chain id, protocol version and network name; the values every transaction and wallet file carries. */
export declare function fetchStatus(): Promise<ChainStatus>;
/** Balance and current sequence of an address. An unknown address is reported as balance 0, sequence 0 by the node. */
export declare function fetchAccount(address: string): Promise<AccountInfo>;
/** Most recent transactions of an address, newest first. */
export declare function fetchTransactions(address: string, limit?: number): Promise<TransactionRecord[]>;
/** The contract metadata a call transaction must carry: what the node reads from acct/<cid>/meta. */
export declare function fetchContract(cid: string): Promise<ContractMeta>;
/** Submit a signed transaction (the JSON txToString produces). */
export declare function submitTransaction(txJson: string): Promise<SubmitResult>;
//# sourceMappingURL=api.d.ts.map