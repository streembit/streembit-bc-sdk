/**
 * Client of the public HTTP API of the read mirror and of the Accountable Node. Entry point: streembit-bc-sdk/api.
 *
 * The paths and response shapes are the public routes (node/src/api/rest/routes/public in the
 * blockchain repository), kept in one place so that a change is made here, and only here. Every response
 * is checked for the fields a wallet needs; a response of another shape is reported as an error instead
 * of producing a wrong transaction. The client carries only the calls a wallet makes today; a route is
 * added here with its first caller.
 *
 * Every read goes to the read address, a read mirror. No read goes to the Accountable Node:
 *
 *   GET  /api/v1/status                              -> { chainId, version, network, height }
 *   GET  /api/v1/accounts/:address                   -> { address, balance, sequence }
 *                                                       a valid address always answers; 0 and 0 when the
 *                                                       chain has not seen it
 *   GET  /api/v1/accounts/:address/transactions      -> { address, transactions: TransactionRecord[] }
 *                                                       newest first, ?limit= up to 50, default 20
 *   GET  /api/v1/contracts/:cid                      -> { cid, codeHash, sandboxHash, location }
 *                                                       of the active version
 *   GET  /api/v1/transactions/:txid                  -> TransactionRecord with asset and blockCount; 404 with
 *                                                       details { txid, height } while the mirror does not
 *                                                       have it: not in a block yet, or not mirrored yet
 *   POST /api/v1/transactions/query  (body: { addresses, limit, before }) -> { transactions: WalletTransactionRecord[], next, height }
 *                                                       the history of a whole wallet in one request: the
 *                                                       transactions of the listed addresses merged, newest
 *                                                       first, each transaction once, with balanceChanges: what it
 *                                                       did to each listed address ({ address, role,
 *                                                       change }); limit up to 100,
 *                                                       default 20; before is the next of the previous page.
 *                                                       A read sent as a POST because the address list of an
 *                                                       exchange does not fit a URL
 *   GET  /api/v1/market/price                        -> MarketPrice of the latest trade, a completed SBRIT
 *                                                       sale the Accountable Node settled; 404 with
 *                                                       details { height } while no trade exists
 *   GET  /api/v1/market/trades?limit=&before=        -> { trades: TradeRecord[], next, height }
 *                                                       newest first, limit up to 100, default 20;
 *                                                       before is the next of the previous page
 *
 * The Accountable Node receives one call, the submission of a signed transaction:
 *
 *   POST /api/v1/transactions  (body: txToString(tx), canonical JSON) -> { txid, status }
 *                                                       200 status included: the engine wrote the block;
 *                                                       202 status pending: still processing when the
 *                                                       node's wait ended; 400 when rejected
 *
 * Two addresses, both required. The read address (configureReadApi) is a read mirror; the node address
 * (configureApi) is the Accountable Node. There is no fallback from one to the other: a read while no read
 * address is configured is refused with an error, it is never sent to the node.
 *
 * Sequence rule: a transaction is built from what the read address reports, the chain id, the version and
 * the account's sequence. The mirror can be a block or two behind the node, so the node may refuse the
 * sequence (ERR_INVALID_SEQUENCE) and name the one it expects in details.expected: the transaction is then
 * built and signed again with that sequence and submitted once more. submitWithSequenceRetry does both steps.
 *
 * A browser wallet calls the API from another origin, so the node answers with CORS headers for the
 * origins in its rest.corsOrigins configuration (GET and POST with a JSON body, including the preflight),
 * and the read mirror answers its GET routes with Access-Control-Allow-Origin: *.
 *
 * fetch and AbortController only; runs in Node, in the browser and in NW.js.
 *
 * An error answer is { error: <ErrorCode>, message, details } with a 4xx or 5xx status. request() turns
 * it into an ApiError whose message is the server's message, code the server's error, details its details
 * and status the HTTP status. A request that did not reach the server, an answer that is not JSON or
 * an answer without a required field is an ApiError with an empty code, and its message names the address
 * it called: "the node API at <url>" or "the read API at <url>".
 */
import type { StateDiffRole } from 'streembit-bc-types';
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
    /** the asset of the amount; carried by fetchTransaction */
    asset?: string;
    /** height of the block that holds the transaction; carried by fetchTransaction */
    blockCount?: number;
}
/** One transaction of a wallet's history, with the block that holds it: what fetchWalletTransactions delivers */
export interface WalletTransactionRecord {
    txid: string;
    type: string;
    from: string;
    to: string;
    /** decimal string */
    amount: string;
    asset: string;
    /** ms */
    timestamp: number;
    /** height of the block that holds the transaction */
    blockCount: number;
    /** position of the transaction in its block; blockCount and position order the history and form its paging cursor */
    position: number;
    /** the contract method of a contract call */
    method?: string;
    /** the fee the transaction paid, as the transaction itself carries it; absent for a transaction that pays none (a mint, a bootstrap transaction) */
    fee?: WalletTransactionFee;
    /** what the transaction did to each of the listed addresses it touched, one row per address; from, to and amount do not say it for an address a contract paid or for the attester's fee */
    balanceChanges: WalletBalanceChange[];
}
/** What a transaction did to one address, as the chain's state diff records it and the mirror keeps it */
export interface WalletBalanceChange {
    address: string;
    /** sent: the sender; received: the recipient of a transfer or a mint allocation; contract: any other account the transaction changed; fee: the attester credited the fee */
    role: StateDiffRole;
    /** signed decimal string: the balance after the transaction minus the balance before, e.g. "-1.51" for a sender (amount and fee) or "1.5" */
    change: string;
}
/** The fee of a transaction of a wallet's history: the amount and the asset the sender paid */
export interface WalletTransactionFee {
    /** decimal string */
    amount: string;
    asset: string;
}
export interface WalletTransactionsPage {
    /** newest first; a transaction between two of the listed addresses is here once */
    transactions: WalletTransactionRecord[];
    /** pass back as before for the next older page; null on the last page */
    next: string | null;
    /** the mirror's height. Streembit has no confirmations: a block is final when written, and a transaction the mirror has is final; blockCount says where it is */
    height: number;
}
export interface SubmitResult {
    txid: string;
    /** included: the engine wrote the block (200); pending: still processing when the node's wait ended (202) */
    status: 'included' | 'pending';
}
/** The answer of submitWithSequenceRetry: the node's answer, with the sequence the accepted transaction carries */
export interface SequencedSubmitResult extends SubmitResult {
    /** the sequence of the transaction the node accepted */
    sequence: number;
    /** true when the node refused the first sequence and the transaction was signed and submitted again with the one it named */
    resubmitted: boolean;
}
/**
 * The latest completed trade. price is the seller's stated USD price of one SBRIT, information only; the
 * agreed price is expectedSats satoshi for amount SBRIT.
 */
export interface MarketPrice {
    currency: string;
    /** decimal string, USD per SBRIT as the seller stated it */
    price: string;
    /** count of all completed trades */
    trades: number;
    /** ISO time the latest trade closed */
    updated: string;
    /** SBRIT decimal string */
    amount: string;
    expectedSats: number;
    /** decimal string */
    satsPerSbrit: string;
    saleId: string;
    /** block height of the latest trade */
    tradeHeight: number;
    /** the mirror's height */
    height: number;
}
/** One completed trade. usdPriceOfSbrit is the seller's statement, information only. */
export interface TradeRecord {
    saleId: string;
    /** the external-payment contract address */
    cid: string;
    seller: string;
    buyer: string;
    /** SBRIT decimal string */
    amount: string;
    expectedSats: number;
    /** decimal string */
    satsPerSbrit: string;
    /** decimal string */
    usdPriceOfSbrit: string;
    /** ms, when the sale closed */
    closedAt: number;
    /** block height of the trade */
    height: number;
}
export interface TradesPage {
    /** newest first */
    trades: TradeRecord[];
    /** pass back as before for the next older page; null on the last page */
    next: string | null;
    /** the mirror's height */
    height: number;
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
/** Base URL of the node API, without a trailing slash: the Accountable Node, which receives signed transactions and nothing else. */
export declare function configureApi(url: string): void;
/** Base URL of the read API (a read mirror), without a trailing slash. Required: every read goes there, and a read while it is not set is refused. */
export declare function configureReadApi(url: string): void;
/** The node address. */
export declare function apiBaseUrl(): string;
/** The read address; an empty string while none is configured. */
export declare function readApiBaseUrl(): string;
/** Chain id, protocol version, network name and height. From the read address, also for a transaction being built (see the sequence rule above). */
export declare function fetchStatus(): Promise<ChainStatus>;
/**
 * Balance and current sequence of an address; an unknown address is answered as balance 0, sequence 0. From
 * the read address, also for the sequence of a transaction being built (see the sequence rule above).
 */
export declare function fetchAccount(address: string): Promise<AccountInfo>;
/** Most recent transactions of an address, newest first. From the read address. */
export declare function fetchTransactions(address: string, limit?: number): Promise<TransactionRecord[]>;
/**
 * The history of a whole wallet in one request: the transactions of the listed addresses merged, newest first,
 * each transaction once, a page at a time; before is the next of the previous page. From the read address.
 * @param addresses The addresses of the wallet, at least one
 * @param limit Number of transactions of the page, up to 100
 * @param before The next of the previous page, for the page of older transactions
 */
export declare function fetchWalletTransactions(addresses: string[], limit?: number, before?: string): Promise<WalletTransactionsPage>;
/**
 * One transaction by its id, with the height of the block that holds it, or null while the mirror does not have
 * it (the mirror's 404 with details.height: not in a block yet, or not mirrored yet). Any other failure throws,
 * a malformed id and a 404 of an unknown route included. From the read address.
 */
export declare function fetchTransaction(txid: string): Promise<TransactionRecord | null>;
/** The contract metadata a call transaction must carry: the chain's acct/<cid>/meta record of the active version. From the read address, as every read. */
export declare function fetchContract(cid: string): Promise<ContractMeta>;
/**
 * The latest completed trade, or null while no trade exists (the mirror's 404 with details.height). Any other
 * failure throws, a 404 of an unknown route included. From the read address.
 */
export declare function fetchPrice(): Promise<MarketPrice | null>;
/** The newest completed trades, a page at a time; before is the next of the previous page. From the read address. */
export declare function fetchTrades(limit?: number, before?: string): Promise<TradesPage>;
/** Submit a signed transaction (the JSON txToString produces) to the node address. */
export declare function submitTransaction(txJson: string): Promise<SubmitResult>;
/**
 * Submit a transaction built on the sequence the read address reported, and follow the sequence rule when the
 * node refuses it: the read address can be a block or two behind the node, the node then answers
 * ERR_INVALID_SEQUENCE with the sequence it expects in details.expected, and the transaction is built and signed
 * again with that sequence and submitted once more. There is one such second submission, never a loop; any
 * other refusal, and a refusal of the second submission, is thrown as it came.
 * @param sequence The sequence of the first submission: the account's sequence from fetchAccount plus one
 * @param signedTransaction Builds and signs the transaction with the given sequence and returns the JSON txToString produces; called once, or twice when the node names another sequence
 * @returns The node's answer, the sequence the accepted transaction carries and whether it took the second submission
 */
export declare function submitWithSequenceRetry(sequence: number, signedTransaction: (sequence: number) => Promise<string>): Promise<SequencedSubmitResult>;
//# sourceMappingURL=api.d.ts.map