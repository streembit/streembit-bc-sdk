"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.configureApi = configureApi;
exports.configureReadApi = configureReadApi;
exports.apiBaseUrl = apiBaseUrl;
exports.readApiBaseUrl = readApiBaseUrl;
exports.fetchStatus = fetchStatus;
exports.fetchAccount = fetchAccount;
exports.fetchTransactions = fetchTransactions;
exports.fetchContract = fetchContract;
exports.submitTransaction = submitTransaction;
const ENDPOINTS = {
    status: () => '/api/v1/status',
    account: (address) => `/api/v1/accounts/${encodeURIComponent(address)}`,
    transactions: (address, limit) => `/api/v1/accounts/${encodeURIComponent(address)}/transactions?limit=${limit}`,
    contract: (cid) => `/api/v1/contracts/${encodeURIComponent(cid)}`,
    submit: () => '/api/v1/transactions'
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
/** Base URL of the node API, without a trailing slash. Reads use it too while no read address is configured. */
function configureApi(url) {
    nodeUrl = trimUrl(url);
}
/** Base URL of the read API (a read mirror), without a trailing slash; an empty string sends reads to the node again. */
function configureReadApi(url) {
    readUrl = trimUrl(url);
}
/** The node address. */
function apiBaseUrl() {
    return nodeUrl;
}
/** The read address, or the node address while no read address is configured. */
function readApiBaseUrl() {
    return readUrl || nodeUrl;
}
/** "The node API at <url>" or "The read API at <url>", for the messages of the errors the client raises itself. */
function describeAddress(from) {
    return from === 'read' && readUrl ? `The read API at ${readUrl}` : `The node API at ${nodeUrl}`;
}
async function request(from, path, init, check) {
    const baseUrl = from === 'read' ? readApiBaseUrl() : nodeUrl;
    if (!baseUrl) {
        throw new ApiError('The node API address is not configured');
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
/**
 * Chain id, protocol version, network name and height. From the read address by default; code that builds a
 * transaction passes 'node' (see the sequence rule above).
 */
function fetchStatus(from = 'read') {
    return request(from, ENDPOINTS.status(), { method: 'GET' }, body => {
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
 * the read address by default; the sequence of a transaction being built is read with 'node' (see the
 * sequence rule above).
 */
function fetchAccount(address, from = 'read') {
    return request(from, ENDPOINTS.account(address), { method: 'GET' }, body => {
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
/** The contract metadata a call transaction must carry: what the node reads from acct/<cid>/meta. From the node address. */
function fetchContract(cid) {
    return request('node', ENDPOINTS.contract(cid), { method: 'GET' }, body => {
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
/** Submit a signed transaction (the JSON txToString produces) to the node address. */
function submitTransaction(txJson) {
    return request('node', ENDPOINTS.submit(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: txJson }, body => {
        if (!isRecord(body))
            throw new ApiError('The submission response is not an object');
        return { txid: expectString(body, 'txid', 'submission'), status: body.status === 'pending' ? 'pending' : 'included' };
    });
}
