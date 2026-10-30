/**
 * isBitcoinAddress against the BIP 173 and BIP 350 reference vectors and the legacy Base58Check forms.
 * Syntax only: the function says whether a string is a well-formed address of a network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bech32 } from '@scure/base';
import { isBitcoinAddress, createUserAddress, generateKeyPair } from '../src/index';

describe('isBitcoinAddress', () => {
    it('accepts the mainnet legacy forms', () => {
        assert.equal(isBitcoinAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'mainnet'), true);   // P2PKH, version 0x00
        assert.equal(isBitcoinAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'mainnet'), true);   // P2SH, version 0x05
    });

    it('accepts segwit version 0 in bech32, lower or upper case', () => {
        assert.equal(isBitcoinAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'mainnet'), true);
        assert.equal(isBitcoinAddress('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'mainnet'), true);
        assert.equal(isBitcoinAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'testnet'), true);
    });

    it('accepts segwit version 1 only in bech32m', () => {
        assert.equal(isBitcoinAddress('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'mainnet'), true);
        // BIP 350: a version 1 program encoded with the bech32 checksum is invalid
        assert.equal(isBitcoinAddress('bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7k7grplx', 'mainnet'), false);
    });

    it('binds the address to the network', () => {
        assert.equal(isBitcoinAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mainnet'), false);
        assert.equal(isBitcoinAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'testnet'), false);
        assert.equal(isBitcoinAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'testnet'), false);
        assert.equal(isBitcoinAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 'testnet'), true);     // testnet P2PKH, version 0x6f
        assert.equal(isBitcoinAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 'regtest'), true);     // regtest shares the testnet version bytes
        const program = new Uint8Array(20).fill(7);
        const regtest = bech32.encode('bcrt', [0, ...bech32.toWords(program)], 90);
        assert.equal(isBitcoinAddress(regtest, 'regtest'), true);
        assert.equal(isBitcoinAddress(regtest, 'mainnet'), false);
    });

    it('refuses malformed strings and other chains', () => {
        assert.equal(isBitcoinAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5', 'mainnet'), false);   // bad checksum
        assert.equal(isBitcoinAddress('bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'mainnet'), false);   // mixed case
        assert.equal(isBitcoinAddress('', 'mainnet'), false);
        assert.equal(isBitcoinAddress('not an address', 'mainnet'), false);
        assert.equal(isBitcoinAddress(createUserAddress(generateKeyPair().publicKey), 'mainnet'), false);   // an SBRIT address
        assert.equal(isBitcoinAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'unknown' as never), false);
    });
});
