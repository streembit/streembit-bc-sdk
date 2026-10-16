/**
 * The API client against a local HTTP server that answers like the Accountable Node is expected to.
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

function handle(req: IncomingMessage, res: ServerResponse): void {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
        lastBody = data;
        const url = req.url || '';
        const reply = (status: number, body: unknown): void => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        if (url === '/api/v1/status') return reply(200, { chainId: 1337, version: 1, network: 'devnet', height: 42 });
        if (url === `/api/v1/accounts/${ACCOUNT}`) return reply(200, { address: ACCOUNT, balance: '12.5', sequence: 3 });
        if (url === `/api/v1/accounts/${ACCOUNT}/transactions?limit=2`) return reply(200, { transactions: [{ txid: 'a1', type: 'transfer', from: ACCOUNT, to: CONTRACT, amount: 1, timestamp: 5 }, 'junk'] });
        if (url === `/api/v1/contracts/${CONTRACT}`) return reply(200, { cid: CONTRACT, codeHash: 'ab', sandboxHash: 'cd', location: 'file_system' });
        if (url === '/api/v1/transactions' && req.method === 'POST') return reply(200, { txid: 'f'.repeat(64) });
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
        assert.deepEqual(await api.fetchStatus(), { chainId: 1337, version: 1, network: 'devnet', height: 42 });
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
