/**
 * The API client against local HTTP servers that answer like the Accountable Node and a read mirror are
 * expected to, and the routing of each call to the node address or the read address.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';

import * as api from '../src/api';

const ACCOUNT = 'SMwB3Yytvt11n79jTCBwfComY8CsBsxjd3';
const CONTRACT = 'CPnsvUmZ6imsKM1QYi5Bbi3cG2UUY5Dgm2';

let server: Server;
let lastBody = '';

/** Answers like the node; records the paths it was asked, for the routing tests. */
function handle(req: IncomingMessage, res: ServerResponse, hits: string[] = []): void {
    hits.push(`${req.method} ${req.url}`);
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
        lastBody = data;
        const url = req.url || '';
        const reply = (status: number, body: unknown): void => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        if (url === '/api/v1/status') return reply(200, { chainId: 1337, version: 1, network: 'devnet', height: 42, tip: 'ab'.repeat(32) });
        if (url === `/api/v1/accounts/${ACCOUNT}`) return reply(200, { address: ACCOUNT, balance: '12.5', sequence: 3 });
        if (url === `/api/v1/accounts/${ACCOUNT}/transactions?limit=2`) return reply(200, { transactions: [{ txid: 'a1', type: 'transfer', from: ACCOUNT, to: CONTRACT, amount: 1, timestamp: 5 }, 'junk'] });
        if (url === `/api/v1/contracts/${CONTRACT}`) return reply(200, { cid: CONTRACT, codeHash: 'ab', sandboxHash: 'cd', location: 'file_system' });
        if (url === '/api/v1/transactions' && req.method === 'POST') return reply(200, { txid: 'f'.repeat(64), status: 'included' });
        if (url === '/api/v1/accounts/bad') return reply(200, { address: 'bad' });
        if (url === '/api/v1/accounts/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'); return; }
        reply(404, { error: 'not found' });
    });
}

describe('Accountable Node API client', () => {
    before(async () => {
        server = createServer(handle);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('server has no port');
        api.configureApi(`http://127.0.0.1:${address.port}/`);
    });

    after(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    it('strips the trailing slash of the base URL', () => {
        assert.ok(!api.apiBaseUrl().endsWith('/'));
    });

    it('reads status, account, transactions and contract metadata', async () => {
        assert.deepEqual(await api.fetchStatus(), { chainId: 1337, version: 1, network: 'devnet', height: 42, tip: 'ab'.repeat(32) });
        assert.deepEqual(await api.fetchAccount(ACCOUNT), { address: ACCOUNT, balance: '12.5', sequence: 3 });
        const list = await api.fetchTransactions(ACCOUNT, 2);
        assert.equal(list.length, 1);
        assert.equal(list[0].amount, '1');
        assert.equal(list[0].method, undefined);
        assert.deepEqual(await api.fetchContract(CONTRACT), { cid: CONTRACT, codeHash: 'ab', sandboxHash: 'cd', location: 'file_system' });
    });

    it('submits the transaction JSON as the request body', async () => {
        const result = await api.submitTransaction('{"type":"transfer"}');
        assert.equal(result.txid, 'f'.repeat(64));
        assert.equal(result.status, 'included');
        assert.equal(lastBody, '{"type":"transfer"}');
    });

    it('reports missing fields, non-JSON bodies and HTTP errors as ApiError', async () => {
        await assert.rejects(api.fetchAccount('bad'), (err: unknown) => err instanceof api.ApiError && /"balance"/.test(err.message));
        await assert.rejects(api.fetchAccount('html'), (err: unknown) => err instanceof api.ApiError && err.status === 200);
        await assert.rejects(api.fetchContract('missing'), (err: unknown) => err instanceof api.ApiError && err.status === 404 && /not found/.test(err.message));
    });

    it('refuses to call an unconfigured API', async () => {
        const configured = api.apiBaseUrl();
        api.configureApi('');
        await assert.rejects(api.fetchStatus(), (err: unknown) => err instanceof api.ApiError);
        api.configureApi(configured);
    });
});

describe('Node address and read address', () => {
    let node: Server;
    let read: Server;
    let nodeUrl = '';
    let readUrl = '';
    const nodeHits: string[] = [];
    const readHits: string[] = [];

    async function listen(hits: string[]): Promise<{ server: Server; url: string }> {
        const server = createServer((req, res) => handle(req, res, hits));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('server has no port');
        return { server, url: `http://127.0.0.1:${address.port}` };
    }

    /** Every call the wallet makes, in the shape the routing is checked against. */
    async function everyCall(): Promise<void> {
        await api.fetchStatus();
        await api.fetchAccount(ACCOUNT);
        await api.fetchTransactions(ACCOUNT, 2);
        await api.fetchContract(CONTRACT);
        await api.submitTransaction('{"type":"transfer"}');
        await api.fetchStatus('node');
        await api.fetchAccount(ACCOUNT, 'node');
    }

    function clearHits(): void {
        nodeHits.length = 0;
        readHits.length = 0;
    }

    before(async () => {
        ({ server: node, url: nodeUrl } = await listen(nodeHits));
        ({ server: read, url: readUrl } = await listen(readHits));
    });

    after(async () => {
        api.configureReadApi('');
        await new Promise<void>(resolve => node.close(() => resolve()));
        await new Promise<void>(resolve => read.close(() => resolve()));
    });

    it('sends every call to the node address while no read address is configured', async () => {
        api.configureApi(nodeUrl);
        api.configureReadApi('');
        assert.equal(api.readApiBaseUrl(), nodeUrl);
        clearHits();
        await everyCall();
        assert.equal(nodeHits.length, 7);
        assert.deepEqual(readHits, []);
    });

    it('sends reads to the read address, and submission, contracts and the node reads to the node address', async () => {
        api.configureApi(nodeUrl);
        api.configureReadApi(`${readUrl}/`);
        assert.equal(api.apiBaseUrl(), nodeUrl);
        assert.equal(api.readApiBaseUrl(), readUrl);
        clearHits();
        await everyCall();
        assert.deepEqual(readHits, [
            'GET /api/v1/status',
            `GET /api/v1/accounts/${ACCOUNT}`,
            `GET /api/v1/accounts/${ACCOUNT}/transactions?limit=2`
        ]);
        assert.deepEqual(nodeHits, [
            `GET /api/v1/contracts/${CONTRACT}`,
            'POST /api/v1/transactions',
            'GET /api/v1/status',
            `GET /api/v1/accounts/${ACCOUNT}`
        ]);
    });

    it('names the address that failed in the error message', async () => {
        const closed = await listen([]);
        await new Promise<void>(resolve => closed.server.close(() => resolve()));
        api.configureApi(nodeUrl);
        api.configureReadApi(closed.url);
        await assert.rejects(api.fetchStatus(), (err: unknown) => err instanceof api.ApiError && err.message.startsWith(`The read API at ${closed.url} did not answer`));
        await api.fetchStatus('node');
        api.configureApi(closed.url);
        api.configureReadApi(readUrl);
        await assert.rejects(api.submitTransaction('{}'), (err: unknown) => err instanceof api.ApiError && err.message.startsWith(`The node API at ${closed.url} did not answer`));
        await assert.rejects(api.fetchAccount('bad'), (err: unknown) => err instanceof api.ApiError && err.message.startsWith(`The read API at ${readUrl}: `) && /"balance"/.test(err.message));
    });
});

describe('Market reads from the read mirror', () => {
    let mirror: Server;
    let mirrorUrl = '';
    let hasTrade = true;
    const SALE = 'ab'.repeat(32);
    const PRICE = { currency: 'USD', price: '0.5', trades: 2, updated: '2026-11-02T10:00:00.000Z', amount: '100', expectedSats: 150000, satsPerSbrit: '1500', saleId: SALE, tradeHeight: 40, height: 42 };
    const TRADE = { saleId: SALE, cid: CONTRACT, seller: ACCOUNT, buyer: ACCOUNT, amount: '100', expectedSats: 150000, satsPerSbrit: '1500', usdPriceOfSbrit: '0.5', closedAt: 1762077600000, height: 40 };
    const hits: string[] = [];

    before(async () => {
        mirror = createServer((req, res) => {
            hits.push(`${req.method} ${req.url}`);
            const reply = (status: number, body: unknown): void => {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            const url = req.url || '';
            if (url === '/api/v1/market/price') {
                return hasTrade ? reply(200, PRICE) : reply(404, { error: 'ERR_KEY_NOT_FOUND', message: 'No completed trade at height 42', details: { height: 42 } });
            }
            if (url === '/api/v1/market/trades?limit=1') return reply(200, { trades: [TRADE], next: `40:${SALE}`, height: 42 });
            if (url === `/api/v1/market/trades?limit=1&before=40%3A${SALE}`) return reply(200, { trades: [], next: null, height: 42 });
            reply(404, { error: 'ERR_KEY_NOT_FOUND', message: `Route GET ${url} not found` });
        });
        await new Promise<void>(resolve => mirror.listen(0, '127.0.0.1', resolve));
        const address = mirror.address();
        if (!address || typeof address === 'string') throw new Error('server has no port');
        mirrorUrl = `http://127.0.0.1:${address.port}`;
    });

    after(async () => {
        api.configureReadApi('');
        await new Promise<void>(resolve => mirror.close(() => resolve()));
    });

    it('reads the latest trade as the price', async () => {
        api.configureReadApi(mirrorUrl);
        hasTrade = true;
        assert.deepEqual(await api.fetchPrice(), PRICE);
    });

    it('answers null while no trade exists, and throws on a 404 of an unknown route', async () => {
        api.configureReadApi(mirrorUrl);
        hasTrade = false;
        assert.equal(await api.fetchPrice(), null);
        hasTrade = true;
        api.configureReadApi(`${mirrorUrl}/elsewhere`);
        await assert.rejects(api.fetchPrice(), (err: unknown) => err instanceof api.ApiError && err.status === 404);
    });

    it('pages the trades with next and before', async () => {
        api.configureReadApi(mirrorUrl);
        const first = await api.fetchTrades(1);
        assert.deepEqual(first, { trades: [TRADE], next: `40:${SALE}`, height: 42 });
        const second = await api.fetchTrades(1, first.next ?? undefined);
        assert.deepEqual(second, { trades: [], next: null, height: 42 });
    });

    it('refuses the market reads while no read address is configured', async () => {
        api.configureReadApi('');
        hits.length = 0;
        await assert.rejects(api.fetchPrice(), (err: unknown) => err instanceof api.ApiError && /read API address/.test(err.message));
        await assert.rejects(api.fetchTrades(), (err: unknown) => err instanceof api.ApiError && /read API address/.test(err.message));
        assert.deepEqual(hits, []);
    });
});
