
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
 * The Accountable Node receives the submission of a signed transaction:
 *
 *   POST /api/v1/transactions  (body: txToString(tx), canonical JSON) -> { txid, status }
 *                                                       200 status included: the engine wrote the block;
 *                                                       202 status pending: still processing when the
 *                                                       node's wait ended; 400 when rejected
 *
 * and the collection of the signatures of a multisig contract call. The requests waiting for signatures are
 * kept by the Accountable Node alone, not on the chain, so a mirror cannot serve them: these five calls go to
 * the node address. Every POST body is canonical JSON, the node refuses any other with ERR_NONCANONICAL_JSON:
 *
 *   POST /api/v1/multisig  (body: { unsignedTx, signature })  -> { record, submission? }
 *                                                       parks an unsigned contract call with its sender's own
 *                                                       signature; one open request per sender, it expires one
 *                                                       hour after the transaction's timestamp
 *   GET  /api/v1/multisig?signer=<public key>&status=   -> { records: PendingMultisigTx[] }
 *                                                       the requests in which the key is an authorised signer
 *   GET  /api/v1/multisig/:id                           -> { record }; 404 when unknown
 *   POST /api/v1/multisig/:id/signatures  (body: { signature }) -> { record, submission? }
 *   POST /api/v1/multisig/:id/submit  (body: {})        -> { record, submission }
 *                                                       the retry of a submission that failed
 *                                                       submission is present when the threshold was reached:
 *                                                       submitted, stale (request again) or failed (retry)
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

import { ErrorCode } from 'streembit-bc-types';
import type { StateDiffRole, ContractCallTransaction, TransactionSignature, PendingMultisigTx, PendingMultisigStatus, PendingMultisigSignature, MultisigCreateRequest, MultisigSignatureUpload, MultisigSubmission, MultisigSignatureResponse, MultisigSubmitResponse } from 'streembit-bc-types';
import { encodeDeterministicJSON } from './encoding';


const ENDPOINTS = {
    status: () => '/api/v1/status',
    account: (address: string) => `/api/v1/accounts/${encodeURIComponent(address)}`,
    transactions: (address: string, limit: number) => `/api/v1/accounts/${encodeURIComponent(address)}/transactions?limit=${limit}`,
    transaction: (txid: string) => `/api/v1/transactions/${encodeURIComponent(txid)}`,
    transactionsQuery: () => '/api/v1/transactions/query',
    contract: (cid: string) => `/api/v1/contracts/${encodeURIComponent(cid)}`,
    submit: () => '/api/v1/transactions',
    multisig: (signer?: string, status?: string) => `/api/v1/multisig${signer ? `?signer=${encodeURIComponent(signer)}${status ? `&status=${encodeURIComponent(status)}` : ''}` : ''}`,
    multisigRequest: (id: string) => `/api/v1/multisig/${encodeURIComponent(id)}`,
    multisigSignatures: (id: string) => `/api/v1/multisig/${encodeURIComponent(id)}/signatures`,
    multisigSubmit: (id: string) => `/api/v1/multisig/${encodeURIComponent(id)}/submit`,
    price: () => '/api/v1/market/price',
    trades: (limit: number, before?: string) => `/api/v1/market/trades?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`
};

const REQUEST_TIMEOUT_MS = 10000;

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

export class ApiError extends Error {
    /** HTTP status of the answer; 0 when the request did not reach the node. */
    public readonly status: number;
    /** The node's error code, an ErrorCode name such as ERR_INSUFFICIENT_BALANCE; empty when the node sent none. */
    public readonly code: string;
    /** The node's details object, when it sent one. */
    public readonly details: unknown;

    constructor(message: string, status = 0, code = '', details?: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

/** Which address a call goes to: the read address for every read, the Accountable Node for the submission of a transaction. */
type ApiAddress = 'node' | 'read';

let nodeUrl = '';
let readUrl = '';

function trimUrl(url: string): string {
    return String(url || '').replace(/\/+$/, '');
}

/** Base URL of the node API, without a trailing slash: the Accountable Node, which receives signed transactions and nothing else. */
export function configureApi(url: string): void {
    nodeUrl = trimUrl(url);
}

/** Base URL of the read API (a read mirror), without a trailing slash. Required: every read goes there, and a read while it is not set is refused. */
export function configureReadApi(url: string): void {
    readUrl = trimUrl(url);
}

/** The node address. */
export function apiBaseUrl(): string {
    return nodeUrl;
}

/** The read address; an empty string while none is configured. */
export function readApiBaseUrl(): string {
    return readUrl;
}

/** "The node API at <url>" or "The read API at <url>", for the messages of the errors the client raises itself. */
function describeAddress(from: ApiAddress): string {
    return from === 'read' ? `The read API at ${readUrl}` : `The node API at ${nodeUrl}`;
}

async function request<T>(from: ApiAddress, path: string, init: RequestInit, check: (body: unknown) => T): Promise<T> {
    // No fallback between the two addresses: a read without a read address is an error, it is never sent to the node
    const baseUrl = from === 'read' ? readUrl : nodeUrl;
    if (!baseUrl) {
        throw new ApiError(from === 'read' ? 'The read API address is required: set it with configureReadApi. A read is never sent to the Accountable Node.' : 'The node API address is required: set it with configureApi.');
    }
    const where = describeAddress(from);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(baseUrl + path, { ...init, signal: controller.signal, headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
    } catch (err) {
        throw new ApiError(`${where} did not answer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        clearTimeout(timer);
    }
    let body: unknown = null;
    const text = await response.text();
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            throw new ApiError(`${where} returned a response that is not JSON (HTTP ${response.status})`, response.status);
        }
    }
    if (!response.ok) {
        const code = isRecord(body) && typeof body.error === 'string' ? body.error : '';
        const text = isRecord(body) && typeof body.message === 'string' && body.message ? body.message : code || `HTTP ${response.status}`;
        const details = isRecord(body) ? body.details : undefined;
        throw new ApiError(text, response.status, code, details);
    }
    try {
        return check(body);
    } catch (err) {
        // a response of another shape: the check's message, with the address that answered it
        if (err instanceof ApiError && !err.code) throw new ApiError(`${where}: ${err.message}`, response.status);
        throw err;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectString(body: Record<string, unknown>, field: string, where: string): string {
    const value = body[field];
    if (typeof value !== 'string') {
        throw new ApiError(`The response for ${where} has no "${field}" field`);
    }
    return value;
}

function expectNumber(body: Record<string, unknown>, field: string, where: string): number {
    const value = body[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ApiError(`The response for ${where} has no numeric "${field}" field`);
    }
    return value;
}

const BALANCE_CHANGE_ROLES: readonly string[] = ['sent', 'received', 'contract', 'fee'] satisfies StateDiffRole[];

/** The balance changes of one transaction of the wallet history answer: one row per listed address the transaction touched */
function balanceChangesOf(item: Record<string, unknown>): WalletBalanceChange[] {
    const list = item.balanceChanges;
    if (!Array.isArray(list) || list.length === 0) throw new ApiError('The response for wallet transactions has no "balanceChanges" list');
    return list.map(row => {
        if (!isRecord(row)) throw new ApiError('The wallet transactions response holds a balance change that is not an object');
        const role = expectString(row, 'role', 'wallet transactions balanceChanges');
        const change = expectString(row, 'change', 'wallet transactions balanceChanges');
        if (!BALANCE_CHANGE_ROLES.includes(role)) throw new ApiError(`The wallet transactions response holds a balance change with the unknown role "${role}"`);
        if (!/^-?\d+(\.\d+)?$/.test(change)) throw new ApiError(`The wallet transactions response holds a balance change that is not a decimal amount: "${change}"`);
        return { address: expectString(row, 'address', 'wallet transactions balanceChanges'), role: role as StateDiffRole, change };
    });
}

/** Chain id, protocol version, network name and height. From the read address, also for a transaction being built (see the sequence rule above). */
export function fetchStatus(): Promise<ChainStatus> {
    return request('read', ENDPOINTS.status(), { method: 'GET' }, body => {
        if (!isRecord(body)) throw new ApiError('The status response is not an object');
        return {
            chainId: expectNumber(body, 'chainId', 'status'),
            version: expectNumber(body, 'version', 'status'),
            network: expectString(body, 'network', 'status'),
            height: typeof body.height === 'number' ? body.height : 0,
            tip: typeof body.tip === 'string' ? body.tip : ''
        };
    });
}

/**
 * Balance and current sequence of an address; an unknown address is answered as balance 0, sequence 0. From
 * the read address, also for the sequence of a transaction being built (see the sequence rule above).
 */
export function fetchAccount(address: string): Promise<AccountInfo> {
    return request('read', ENDPOINTS.account(address), { method: 'GET' }, body => {
        if (!isRecord(body)) throw new ApiError('The account response is not an object');
        return {
            address: typeof body.address === 'string' ? body.address : address,
            balance: expectString(body, 'balance', 'account'),
            sequence: expectNumber(body, 'sequence', 'account')
        };
    });
}

/** Most recent transactions of an address, newest first. From the read address. */
export function fetchTransactions(address: string, limit = 20): Promise<TransactionRecord[]> {
    return request('read', ENDPOINTS.transactions(address, limit), { method: 'GET' }, body => {
        const list = isRecord(body) ? body.transactions : body;
        if (!Array.isArray(list)) throw new ApiError('The transactions response has no "transactions" list');
        return list.filter(isRecord).map(item => ({
            txid: typeof item.txid === 'string' ? item.txid : '',
            type: typeof item.type === 'string' ? item.type : '',
            from: typeof item.from === 'string' ? item.from : '',
            to: typeof item.to === 'string' ? item.to : '',
            amount: typeof item.amount === 'string' ? item.amount : String(item.amount ?? ''),
            timestamp: typeof item.timestamp === 'number' ? item.timestamp : 0,
            method: typeof item.method === 'string' ? item.method : undefined,
            status: typeof item.status === 'string' ? item.status : undefined
        }));
    });
}

/**
 * The history of a whole wallet in one request: the transactions of the listed addresses merged, newest first,
 * each transaction once, a page at a time; before is the next of the previous page. From the read address.
 * @param addresses The addresses of the wallet, at least one
 * @param limit Number of transactions of the page, up to 100
 * @param before The next of the previous page, for the page of older transactions
 */
export async function fetchWalletTransactions(addresses: string[], limit = 20, before?: string): Promise<WalletTransactionsPage> {
    if (addresses.length === 0) {
        throw new ApiError('The wallet history needs at least one address');
    }
    return request('read', ENDPOINTS.transactionsQuery(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addresses, limit, before }) }, body => {
        if (!isRecord(body) || !Array.isArray(body.transactions)) throw new ApiError('The wallet transactions response has no "transactions" list');
        const transactions = body.transactions.map(item => {
            if (!isRecord(item)) throw new ApiError('The wallet transactions response holds a transaction that is not an object');
            return {
                txid: expectString(item, 'txid', 'wallet transactions'),
                type: expectString(item, 'type', 'wallet transactions'),
                from: expectString(item, 'from', 'wallet transactions'),
                to: expectString(item, 'to', 'wallet transactions'),
                amount: expectString(item, 'amount', 'wallet transactions'),
                asset: expectString(item, 'asset', 'wallet transactions'),
                timestamp: expectNumber(item, 'timestamp', 'wallet transactions'),
                blockCount: expectNumber(item, 'blockCount', 'wallet transactions'),
                position: expectNumber(item, 'position', 'wallet transactions'),
                method: typeof item.method === 'string' ? item.method : undefined,
                // The fee the transaction paid, never a constant of the client; a transaction without a fee has none here either
                fee: isRecord(item.fee) ? { amount: expectString(item.fee, 'amount', 'wallet transactions fee'), asset: expectString(item.fee, 'asset', 'wallet transactions fee') } : undefined,
                balanceChanges: balanceChangesOf(item)
            };
        });
        return { transactions, next: typeof body.next === 'string' ? body.next : null, height: expectNumber(body, 'height', 'wallet transactions') };
    });
}

/**
 * One transaction by its id, with the height of the block that holds it, or null while the mirror does not have
 * it (the mirror's 404 with details.height: not in a block yet, or not mirrored yet). Any other failure throws,
 * a malformed id and a 404 of an unknown route included. From the read address.
 */
export async function fetchTransaction(txid: string): Promise<TransactionRecord | null> {
    try {
        return await request('read', ENDPOINTS.transaction(txid), { method: 'GET' }, body => {
            if (!isRecord(body)) throw new ApiError('The transaction response is not an object');
            return {
                txid: expectString(body, 'txid', 'transaction'),
                type: expectString(body, 'type', 'transaction'),
                from: expectString(body, 'from', 'transaction'),
                to: expectString(body, 'to', 'transaction'),
                amount: expectString(body, 'amount', 'transaction'),
                timestamp: expectNumber(body, 'timestamp', 'transaction'),
                method: typeof body.method === 'string' ? body.method : undefined,
                asset: expectString(body, 'asset', 'transaction'),
                blockCount: expectNumber(body, 'blockCount', 'transaction')
            };
        });
    } catch (err) {
        if (err instanceof ApiError && err.status === 404 && isRecord(err.details) && typeof err.details.height === 'number') {
            return null;
        }
        throw err;
    }
}

/** The contract metadata a call transaction must carry: the chain's acct/<cid>/meta record of the active version. From the read address, as every read. */
export function fetchContract(cid: string): Promise<ContractMeta> {
    return request('read', ENDPOINTS.contract(cid), { method: 'GET' }, body => {
        if (!isRecord(body)) throw new ApiError('The contract response is not an object');
        return {
            cid: typeof body.cid === 'string' ? body.cid : cid,
            codeHash: expectString(body, 'codeHash', 'contract'),
            sandboxHash: expectString(body, 'sandboxHash', 'contract'),
            location: expectString(body, 'location', 'contract')
        };
    });
}

/**
 * The latest completed trade, or null while no trade exists (the mirror's 404 with details.height). Any other
 * failure throws, a 404 of an unknown route included. From the read address.
 */
export async function fetchPrice(): Promise<MarketPrice | null> {
    try {
        return await request('read', ENDPOINTS.price(), { method: 'GET' }, body => {
            if (!isRecord(body)) throw new ApiError('The price response is not an object');
            return {
                currency: expectString(body, 'currency', 'price'),
                price: expectString(body, 'price', 'price'),
                trades: expectNumber(body, 'trades', 'price'),
                updated: expectString(body, 'updated', 'price'),
                amount: expectString(body, 'amount', 'price'),
                expectedSats: expectNumber(body, 'expectedSats', 'price'),
                satsPerSbrit: expectString(body, 'satsPerSbrit', 'price'),
                saleId: expectString(body, 'saleId', 'price'),
                tradeHeight: expectNumber(body, 'tradeHeight', 'price'),
                height: expectNumber(body, 'height', 'price')
            };
        });
    } catch (err) {
        if (err instanceof ApiError && err.status === 404 && isRecord(err.details) && typeof err.details.height === 'number') {
            return null;
        }
        throw err;
    }
}

/** The newest completed trades, a page at a time; before is the next of the previous page. From the read address. */
export async function fetchTrades(limit = 20, before?: string): Promise<TradesPage> {
    return request('read', ENDPOINTS.trades(limit, before), { method: 'GET' }, body => {
        if (!isRecord(body) || !Array.isArray(body.trades)) throw new ApiError('The trades response has no "trades" list');
        const trades = body.trades.map(item => {
            if (!isRecord(item)) throw new ApiError('The trades response holds a trade that is not an object');
            return {
                saleId: expectString(item, 'saleId', 'trades'),
                cid: expectString(item, 'cid', 'trades'),
                seller: expectString(item, 'seller', 'trades'),
                buyer: expectString(item, 'buyer', 'trades'),
                amount: expectString(item, 'amount', 'trades'),
                expectedSats: expectNumber(item, 'expectedSats', 'trades'),
                satsPerSbrit: expectString(item, 'satsPerSbrit', 'trades'),
                usdPriceOfSbrit: expectString(item, 'usdPriceOfSbrit', 'trades'),
                closedAt: expectNumber(item, 'closedAt', 'trades'),
                height: expectNumber(item, 'height', 'trades')
            };
        });
        return { trades, next: typeof body.next === 'string' ? body.next : null, height: expectNumber(body, 'height', 'trades') };
    });
}

/** Submit a signed transaction (the JSON txToString produces) to the node address. */
export function submitTransaction(txJson: string): Promise<SubmitResult> {
    return request('node', ENDPOINTS.submit(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: txJson }, body => {
        if (!isRecord(body)) throw new ApiError('The submission response is not an object');
        return { txid: expectString(body, 'txid', 'submission'), status: body.status === 'pending' ? 'pending' : 'included' };
    });
}

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
export async function submitWithSequenceRetry(sequence: number, signedTransaction: (sequence: number) => Promise<string>): Promise<SequencedSubmitResult> {
    try {
        const result = await submitTransaction(await signedTransaction(sequence));
        return { ...result, sequence, resubmitted: false };
    } catch (err) {
        if (!(err instanceof ApiError) || err.code !== ErrorCode.ERR_INVALID_SEQUENCE || !isRecord(err.details)) {
            throw err;
        }
        const expected = err.details.expected;
        if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1 || expected === sequence) {
            throw err;
        }
        const result = await submitTransaction(await signedTransaction(expected));
        return { ...result, sequence: expected, resubmitted: true };
    }
}

const MULTISIG_STATUSES: readonly string[] = ['pending', 'submitted', 'expired', 'stale'] satisfies PendingMultisigStatus[];
const MULTISIG_SUBMISSION_STATUSES: readonly string[] = ['submitted', 'stale', 'failed'] satisfies MultisigSubmission['status'][];

/** One request waiting for signatures, as the node's multisig routes answer it; the unsigned transaction is kept as it came, its bytes are what the signers sign */
function multisigRecordOf(value: unknown): PendingMultisigTx {
    if (!isRecord(value)) throw new ApiError('The multisig response holds a record that is not an object');
    const unsignedTx = value.unsignedTx;
    if (!isRecord(unsignedTx)) throw new ApiError('The response for multisig record has no "unsignedTx" object');
    for (const field of ['type', 'from', 'to', 'method', 'data']) {
        expectString(unsignedTx, field, 'multisig record unsignedTx');
    }
    expectNumber(unsignedTx, 'sequence', 'multisig record unsignedTx');
    expectNumber(unsignedTx, 'timestamp', 'multisig record unsignedTx');
    const status = expectString(value, 'status', 'multisig record');
    if (!MULTISIG_STATUSES.includes(status)) throw new ApiError(`The multisig response holds a record with the unknown status "${status}"`);
    const signers = value.authorizedSigners;
    if (!Array.isArray(signers) || !signers.every(signer => typeof signer === 'string')) throw new ApiError('The response for multisig record has no "authorizedSigners" list');
    if (!Array.isArray(value.signatures)) throw new ApiError('The response for multisig record has no "signatures" list');
    const signatures: PendingMultisigSignature[] = value.signatures.map(item => {
        if (!isRecord(item)) throw new ApiError('The multisig response holds a signature that is not an object');
        return { publickey: expectString(item, 'publickey', 'multisig record signatures'), signature: expectString(item, 'signature', 'multisig record signatures'), receivedAt: expectNumber(item, 'receivedAt', 'multisig record signatures') };
    });
    return {
        id: expectString(value, 'id', 'multisig record'),
        unsignedTx: unsignedTx as unknown as PendingMultisigTx['unsignedTx'],
        contract: expectString(value, 'contract', 'multisig record'),
        method: expectString(value, 'method', 'multisig record'),
        thresholdM: expectNumber(value, 'thresholdM', 'multisig record'),
        authorizedSigners: signers as string[],
        signatures,
        status: status as PendingMultisigStatus,
        createdAt: expectNumber(value, 'createdAt', 'multisig record'),
        expiresAt: expectNumber(value, 'expiresAt', 'multisig record'),
        submittedTxId: typeof value.submittedTxId === 'string' ? value.submittedTxId : undefined
    };
}

/** The outcome of the node's submission attempt in a multisig answer, undefined when the answer has none: the threshold is not reached yet */
function multisigSubmissionOf(value: unknown): MultisigSubmission | undefined {
    if (value === undefined || value === null) return undefined;
    if (!isRecord(value)) throw new ApiError('The multisig response holds a submission that is not an object');
    const status = expectString(value, 'status', 'multisig submission');
    if (!MULTISIG_SUBMISSION_STATUSES.includes(status)) throw new ApiError(`The multisig response holds a submission with the unknown status "${status}"`);
    return {
        status: status as MultisigSubmission['status'],
        txId: typeof value.txId === 'string' ? value.txId : undefined,
        response: typeof value.response === 'string' ? value.response : undefined,
        reason: typeof value.reason === 'string' ? value.reason : undefined
    };
}

/** The answer of the create and the signature routes: the record, and the submission outcome when this signature reached the threshold */
function multisigSignatureResponseOf(body: unknown): MultisigSignatureResponse {
    if (!isRecord(body)) throw new ApiError('The multisig response is not an object');
    const submission = multisigSubmissionOf(body.submission);
    return submission ? { record: multisigRecordOf(body.record), submission } : { record: multisigRecordOf(body.record) };
}

/**
 * Park an unsigned contract call at the node for the collection of its signatures. To the node address.
 * @param unsignedTx The contract call, built for the chain id and version the read address reports, without signatures
 * @param signature The sender's own signature over it (getTxSignatures with the sender's signer); the node parks nothing without it
 * @returns The record, and the submission outcome when the sender's signature alone reached the threshold
 */
export function createMultisigRequest(unsignedTx: ContractCallTransaction, signature: TransactionSignature): Promise<MultisigSignatureResponse> {
    const message: MultisigCreateRequest = { unsignedTx, signature };
    return request('node', ENDPOINTS.multisig(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: encodeDeterministicJSON(message, { asString: true }) }, multisigSignatureResponseOf);
}

/**
 * The requests in which the public key is an authorised signer, oldest first. From the node address: the requests exist there alone.
 * @param signer The compressed public key, 66 hex characters, in lower case as the node records its signers
 * @param status Only the requests of this status; all when left out
 */
export function fetchMultisigRequests(signer: string, status?: PendingMultisigStatus): Promise<PendingMultisigTx[]> {
    return request('node', ENDPOINTS.multisig(signer, status), { method: 'GET' }, body => {
        if (!isRecord(body) || !Array.isArray(body.records)) throw new ApiError('The multisig response has no "records" list');
        return body.records.map(multisigRecordOf);
    });
}

/** One request by its id. From the node address. An unknown id is the node's 404, thrown as an ApiError with the code ERR_KEY_NOT_FOUND. */
export function fetchMultisigRequest(id: string): Promise<PendingMultisigTx> {
    return request('node', ENDPOINTS.multisigRequest(id), { method: 'GET' }, body => {
        if (!isRecord(body)) throw new ApiError('The multisig response is not an object');
        return multisigRecordOf(body.record);
    });
}

/**
 * Upload a signer's signature over the request's unsigned transaction (getTxSignatures over record.unsignedTx). To the node address.
 * @returns The record with the signature, and the submission outcome when this signature reached the threshold
 */
export function sendMultisigSignature(id: string, signature: TransactionSignature): Promise<MultisigSignatureResponse> {
    const message: MultisigSignatureUpload = { signature };
    return request('node', ENDPOINTS.multisigSignatures(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: encodeDeterministicJSON(message, { asString: true }) }, multisigSignatureResponseOf);
}

/** Retry the submission of a request that holds its signatures and whose automatic submission failed. To the node address. */
export function submitMultisigRequest(id: string): Promise<MultisigSubmitResponse> {
    return request('node', ENDPOINTS.multisigSubmit(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: encodeDeterministicJSON({}, { asString: true }) }, body => {
        if (!isRecord(body)) throw new ApiError('The multisig response is not an object');
        const submission = multisigSubmissionOf(body.submission);
        if (!submission) throw new ApiError('The response for multisig submit has no "submission" object');
        return { record: multisigRecordOf(body.record), submission };
    });
}
