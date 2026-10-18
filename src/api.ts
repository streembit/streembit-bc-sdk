
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
 * A browser wallet calls the API from another origin, so the node answers with CORS headers for the
 * origins in its rest.corsOrigins configuration (GET and POST with a JSON body, including the preflight).
 *
 * fetch and AbortController only; runs in Node, in the browser and in NW.js.
 *
 * An error answer is { error: <ErrorCode>, message, details } with a 4xx or 5xx status. request() turns
 * it into an ApiError whose message is the node's message, code the node's error, details its details
 * and status the HTTP status. A request that did not reach the node, or an answer that is not JSON,
 * is an ApiError with an empty code.
 */


const ENDPOINTS = {
    status: () => '/api/v1/status',
    account: (address: string) => `/api/v1/accounts/${encodeURIComponent(address)}`,
    transactions: (address: string, limit: number) => `/api/v1/accounts/${encodeURIComponent(address)}/transactions?limit=${limit}`,
    contract: (cid: string) => `/api/v1/contracts/${encodeURIComponent(cid)}`,
    submit: () => '/api/v1/transactions'
};

const REQUEST_TIMEOUT_MS = 10000;

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
    /** included: the engine wrote the block (200); pending: still processing when the node's wait ended (202) */
    status: 'included' | 'pending';
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

let baseUrl = '';

/** Base URL of the node API, without a trailing slash. */
export function configureApi(url: string): void {
    baseUrl = String(url || '').replace(/\/+$/, '');
}

export function apiBaseUrl(): string {
    return baseUrl;
}

async function request<T>(path: string, init: RequestInit, check: (body: unknown) => T): Promise<T> {
    if (!baseUrl) {
        throw new ApiError('The node API address is not configured');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(baseUrl + path, { ...init, signal: controller.signal, headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
    } catch (err) {
        throw new ApiError(`The node API at ${baseUrl} did not answer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
        clearTimeout(timer);
    }
    let body: unknown = null;
    const text = await response.text();
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            throw new ApiError(`The node API returned a response that is not JSON (HTTP ${response.status})`, response.status);
        }
    }
    if (!response.ok) {
        const code = isRecord(body) && typeof body.error === 'string' ? body.error : '';
        const text = isRecord(body) && typeof body.message === 'string' && body.message ? body.message : code || `HTTP ${response.status}`;
        const details = isRecord(body) ? body.details : undefined;
        throw new ApiError(text, response.status, code, details);
    }
    return check(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectString(body: Record<string, unknown>, field: string, where: string): string {
    const value = body[field];
    if (typeof value !== 'string') {
        throw new ApiError(`The node API response for ${where} has no "${field}" field`);
    }
    return value;
}

function expectNumber(body: Record<string, unknown>, field: string, where: string): number {
    const value = body[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ApiError(`The node API response for ${where} has no numeric "${field}" field`);
    }
    return value;
}

/** Chain id, protocol version and network name; the values every transaction and wallet file carries. */
export function fetchStatus(): Promise<ChainStatus> {
    return request(ENDPOINTS.status(), { method: 'GET' }, body => {
        if (!isRecord(body)) throw new ApiError('The node API status response is not an object');
        return {
            chainId: expectNumber(body, 'chainId', 'status'),
            version: expectNumber(body, 'version', 'status'),
            network: expectString(body, 'network', 'status'),
            height: typeof body.height === 'number' ? body.height : 0
        };
    });
}

/** Balance and current sequence of an address. An unknown address is reported as balance 0, sequence 0 by the node. */
export function fetchAccount(address: string): Promise<AccountInfo> {
    return request(ENDPOINTS.account(address), { method: 'GET' }, body => {
        if (!isRecord(body)) throw new ApiError('The node API account response is not an object');
        return {
            address: typeof body.address === 'string' ? body.address : address,
            balance: expectString(body, 'balance', 'account'),
            sequence: expectNumber(body, 'sequence', 'account')
        };
    });
}

/** Most recent transactions of an address, newest first. */
export function fetchTransactions(address: string, limit = 20): Promise<TransactionRecord[]> {
    return request(ENDPOINTS.transactions(address, limit), { method: 'GET' }, body => {
        const list = isRecord(body) ? body.transactions : body;
        if (!Array.isArray(list)) throw new ApiError('The node API transactions response has no "transactions" list');
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

/** The contract metadata a call transaction must carry: what the node reads from acct/<cid>/meta. */
export function fetchContract(cid: string): Promise<ContractMeta> {
    return request(ENDPOINTS.contract(cid), { method: 'GET' }, body => {
        if (!isRecord(body)) throw new ApiError('The node API contract response is not an object');
        return {
            cid: typeof body.cid === 'string' ? body.cid : cid,
            codeHash: expectString(body, 'codeHash', 'contract'),
            sandboxHash: expectString(body, 'sandboxHash', 'contract'),
            location: expectString(body, 'location', 'contract')
        };
    });
}

/** Submit a signed transaction (the JSON txToString produces). */
export function submitTransaction(txJson: string): Promise<SubmitResult> {
    return request(ENDPOINTS.submit(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: txJson }, body => {
        if (!isRecord(body)) throw new ApiError('The node API submission response is not an object');
        return { txid: expectString(body, 'txid', 'submission'), status: body.status === 'pending' ? 'pending' : 'included' };
    });
}
