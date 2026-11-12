"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.configureApi = configureApi;
exports.configureReadApi = configureReadApi;
exports.apiBaseUrl = apiBaseUrl;
exports.readApiBaseUrl = readApiBaseUrl;
exports.fetchStatus = fetchStatus;
exports.fetchAccount = fetchAccount;
exports.fetchTransactions = fetchTransactions;
exports.fetchTransaction = fetchTransaction;
exports.fetchContract = fetchContract;
exports.fetchPrice = fetchPrice;
exports.fetchTrades = fetchTrades;
exports.submitTransaction = submitTransaction;
exports.submitWithSequenceRetry = submitWithSequenceRetry;
const streembit_bc_types_1 = require("streembit-bc-types");
const ENDPOINTS = {
    status: () => '/api/v1/status',
    account: (address) => `/api/v1/accounts/${encodeURIComponent(address)}`,
    transactions: (address, limit) => `/api/v1/accounts/${encodeURIComponent(address)}/transactions?limit=${limit}`,
    transaction: (txid) => `/api/v1/transactions/${encodeURIComponent(txid)}`,
    contract: (cid) => `/api/v1/contracts/${encodeURIComponent(cid)}`,
    submit: () => '/api/v1/transactions',
    price: () => '/api/v1/market/price',
    trades: (limit, before) => `/api/v1/market/trades?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`
};
const REQUEST_TIMEOUT_MS = 10000;
class ApiError extends Error {
    /** HTTP status of the answer; 0 when the request did not reach the node. */
    status;
    /** The node's error code, an ErrorCode name such as ERR_INSUFFICIENT_BALANCE; empty when the node sent none. */
    code;
    /** The node's details object, when it sent one. */
    details;
    constructor(message, status = 0, code = '', details) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.ApiError = ApiError;
let nodeUrl = '';
let readUrl = '';
function trimUrl(url) {
    return String(url || '').replace(/\/+$/, '');
}
/** Base URL of the node API, without a trailing slash: the Accountable Node, which receives signed transactions and nothing else. */
function configureApi(url) {
    nodeUrl = trimUrl(url);
}
/** Base URL of the read API (a read mirror), without a trailing slash. Required: every read goes there, and a read while it is not set is refused. */
function configureReadApi(url) {
    readUrl = trimUrl(url);
}
/** The node address. */
function apiBaseUrl() {
    return nodeUrl;
}
/** The read address; an empty string while none is configured. */
function readApiBaseUrl() {
    return readUrl;
}
/** "The node API at <url>" or "The read API at <url>", for the messages of the errors the client raises itself. */
function describeAddress(from) {
    return from === 'read' ? `The read API at ${readUrl}` : `The node API at ${nodeUrl}`;
}
async function request(from, path, init, check) {
    // No fallback between the two addresses: a read without a read address is an error, it is never sent to the node
    const baseUrl = from === 'read' ? readUrl : nodeUrl;
    if (!baseUrl) {
        throw new ApiError(from === 'read' ? 'The read API address is required: set it with configureReadApi. A read is never sent to the Accountable Node.' : 'The node API address is required: set it with configureApi.');
    }
    const where = describeAddress(from);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
        response = await fetch(baseUrl + path, { ...init, signal: controller.signal, headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
    }
    catch (err) {
        throw new ApiError(`${where} did not answer: ${err instanceof Error ? err.message : String(err)}`);
    }
    finally {
        clearTimeout(timer);
    }
    let body = null;
    const text = await response.text();
    if (text) {
        try {
            body = JSON.parse(text);
        }
        catch {
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
    }
    catch (err) {
        // a response of another shape: the check's message, with the address that answered it
        if (err instanceof ApiError && !err.code)
            throw new ApiError(`${where}: ${err.message}`, response.status);
        throw err;
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function expectString(body, field, where) {
    const value = body[field];
    if (typeof value !== 'string') {
        throw new ApiError(`The response for ${where} has no "${field}" field`);
    }
    return value;
}
function expectNumber(body, field, where) {
    const value = body[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ApiError(`The response for ${where} has no numeric "${field}" field`);
    }
    return value;
}
/** Chain id, protocol version, network name and height. From the read address, also for a transaction being built (see the sequence rule above). */
function fetchStatus() {
    return request('read', ENDPOINTS.status(), { method: 'GET' }, body => {
        if (!isRecord(body))
            throw new ApiError('The status response is not an object');
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
function fetchAccount(address) {
    return request('read', ENDPOINTS.account(address), { method: 'GET' }, body => {
        if (!isRecord(body))
            throw new ApiError('The account response is not an object');
        return {
            address: typeof body.address === 'string' ? body.address : address,
            balance: expectString(body, 'balance', 'account'),
            sequence: expectNumber(body, 'sequence', 'account')
        };
    });
}
/** Most recent transactions of an address, newest first. From the read address. */
function fetchTransactions(address, limit = 20) {
    return request('read', ENDPOINTS.transactions(address, limit), { method: 'GET' }, body => {
        const list = isRecord(body) ? body.transactions : body;
        if (!Array.isArray(list))
            throw new ApiError('The transactions response has no "transactions" list');
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
 * One transaction by its id, with the height of the block that holds it, or null while the mirror does not have
 * it (the mirror's 404 with details.height: not in a block yet, or not mirrored yet). Any other failure throws,
 * a malformed id and a 404 of an unknown route included. From the read address.
 */
async function fetchTransaction(txid) {
    try {
        return await request('read', ENDPOINTS.transaction(txid), { method: 'GET' }, body => {
            if (!isRecord(body))
                throw new ApiError('The transaction response is not an object');
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
    }
    catch (err) {
        if (err instanceof ApiError && err.status === 404 && isRecord(err.details) && typeof err.details.height === 'number') {
            return null;
        }
        throw err;
    }
}
/** The contract metadata a call transaction must carry: the chain's acct/<cid>/meta record of the active version. From the read address, as every read. */
function fetchContract(cid) {
    return request('read', ENDPOINTS.contract(cid), { method: 'GET' }, body => {
        if (!isRecord(body))
            throw new ApiError('The contract response is not an object');
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
async function fetchPrice() {
    try {
        return await request('read', ENDPOINTS.price(), { method: 'GET' }, body => {
            if (!isRecord(body))
                throw new ApiError('The price response is not an object');
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
    }
    catch (err) {
        if (err instanceof ApiError && err.status === 404 && isRecord(err.details) && typeof err.details.height === 'number') {
            return null;
        }
        throw err;
    }
}
/** The newest completed trades, a page at a time; before is the next of the previous page. From the read address. */
async function fetchTrades(limit = 20, before) {
    return request('read', ENDPOINTS.trades(limit, before), { method: 'GET' }, body => {
        if (!isRecord(body) || !Array.isArray(body.trades))
            throw new ApiError('The trades response has no "trades" list');
        const trades = body.trades.map(item => {
            if (!isRecord(item))
                throw new ApiError('The trades response holds a trade that is not an object');
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
function submitTransaction(txJson) {
    return request('node', ENDPOINTS.submit(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: txJson }, body => {
        if (!isRecord(body))
            throw new ApiError('The submission response is not an object');
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
async function submitWithSequenceRetry(sequence, signedTransaction) {
    try {
        const result = await submitTransaction(await signedTransaction(sequence));
        return { ...result, sequence, resubmitted: false };
    }
    catch (err) {
        if (!(err instanceof ApiError) || err.code !== streembit_bc_types_1.ErrorCode.ERR_INVALID_SEQUENCE || !isRecord(err.details)) {
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
