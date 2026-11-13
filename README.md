# streembit-bc-sdk

The Streembit Blockchain SDK: the wallet core and the Accountable Node API client. One implementation of
every byte a wallet produces and the node verifies, used by the node, the CLI wallet, the Foundation's web
wallet and the desktop wallet.

- `streembit-bc-sdk`: key creation, HD derivation, addresses, transaction building, the signing preimage,
  the txid, signing through the `Signer` interface, the encrypted wallet file and its metadata, and the
  block hash and creator block signature that the node and the read mirror verify.
- `streembit-bc-sdk/api`: the client of a read mirror's public HTTP API, for every read, and of the Accountable Node's, for the submission of signed transactions and the collection of multisig signatures.

Pure JavaScript only (`@noble/curves`, `@noble/hashes`, `@scure/bip32`, `@scure/bip39`, `decimal.js` and
Web Crypto), no native modules and no WebAssembly. Every function carries the name of the node function it
replaces and behaves as that function does. The same code runs in Node 26 or later, in a browser bundle and
in NW.js.
Types and protocol constants come from `streembit-bc-types`; nothing is redeclared here.

## Installation

The package is not published to npm; install it from GitHub:

```bash
npm install github:streembit/streembit-bc-sdk
```

`dist/` is committed, as in `streembit-bc-types`, so an install from GitHub needs no build step.
Node 26 or later is required, as in the other Streembit projects. The technical floor is Node 22.12: the
noble and scure packages are ECMAScript modules and are required from CommonJS.

## Usage

```typescript
import { AssetId } from 'streembit-bc-types';
import { generateMnemonic, seedFromMnemonic, deriveFromSeed, SoftwareSigner, buildTransferTx, signTransaction, txToString, createWalletFile, openWalletFile } from 'streembit-bc-sdk';
import { configureApi, configureReadApi, fetchStatus, fetchAccount, submitWithSequenceRetry } from 'streembit-bc-sdk/api';

// Keys: derive the seed once per session, then accounts from it.
const mnemonic = generateMnemonic();
const seed = seedFromMnemonic(mnemonic);
const account = deriveFromSeed(seed, 0, 0);          // { path, privateKey, publicKey, address }

// Wallet file (wallet.json version 1), stored wherever the wallet decides.
const file = await createWalletFile(mnemonic, 'Correct-Horse#2026', { network: 'devnet' });
const restored = await openWalletFile(file, 'Correct-Horse#2026');

// A transfer: chain id, version and the next sequence are read from the read mirror; the node receives the signed transaction only.
configureReadApi('https://mirror.example.org');      // required: every read goes here
configureApi('https://node.example.org');            // required: the signed transaction goes here
const status = await fetchStatus();
const info = await fetchAccount(account.address);
const signer = new SoftwareSigner(account.privateKey);
// Builds and signs with the given sequence; signTransaction refuses a signer that does not control tx.from
const signed = async (sequence: number) => txToString(await signTransaction(buildTransferTx({ chainId: status.chainId, version: status.version, from: account.address, to: 'S...', amount: '1.5', asset: AssetId.SBRIT, sequence }), [signer]));
// Submits; when the mirror was behind and the node names another sequence, signs and submits once more with it
const { txid } = await submitWithSequenceRetry(info.sequence + 1, signed);
signer.dispose();
```

## Node address and read address

The API client calls two addresses, and both are required:

| Address | Set by | Calls |
|---|---|---|
| read | `configureReadApi(url)`, read back with `readApiBaseUrl()` | every read: `fetchStatus()`, `fetchAccount(address)`, `fetchTransactions(address)`, `fetchWalletTransactions(addresses)`, `fetchTransaction(txid)`, `fetchContract(cid)`, `fetchPrice()`, `fetchTrades()` |
| node | `configureApi(url)`, read back with `apiBaseUrl()` | the submission of a signed transaction: `submitTransaction`, `submitWithSequenceRetry`; the multisig requests: `createMultisigRequest`, `fetchMultisigRequests`, `fetchMultisigRequest`, `sendMultisigSignature`, `submitMultisigRequest` |

The read address is a read mirror; the node address is the Accountable Node. No read of the chain is sent to
the node, and there is no fallback: a read while no read address is configured (or after `configureReadApi('')`) is refused
with the error "The read API address is required". An error the client raises itself (no answer, an answer that
is not JSON or lacks a field) names the address it called, "The node API at <url>" or "The read API at <url>";
an error answer keeps the server's own message.

`fetchTransaction(txid)` reads one transaction with the height of its block. It answers `null` while the mirror
does not have the transaction.

`fetchWalletTransactions(addresses, limit, before)` reads the history of a whole wallet in one request: the
transactions of the listed addresses merged, newest first, each transaction once, with the block height and
position of each, the fee it paid as the transaction carries it, and the mirror's height. Each transaction
carries `balanceChanges`, one row per listed address it touched: the `address`, its `role` (`sent`, `received`,
`contract` or `fee`) and the signed `change` of its balance, as the chain's state diff records them. `from`,
`to` and `amount` do not say what an address received from a contract or as the attester's fee; `balanceChanges`
does. It answers a page of up to 100 transactions and `next`, which is passed back as `before` for the page of
older ones. `fetchTransactions(address)` stays the history of one address.

Sequence rule: a transaction is built from what the read address reports, the chain id, the version and the
account's sequence. The mirror can be a block or two behind the node, so the node may refuse the sequence and
name the one it expects (`ERR_INVALID_SEQUENCE`, `details.expected`); the transaction is then built and signed
again with that sequence and submitted once more. `submitWithSequenceRetry(sequence, signedTransaction)` does
both steps: it calls `signedTransaction` with the sequence to sign with, once, or twice when the node names
another one, and answers the node's result with the sequence the accepted transaction carries.

Multisig: a contract call that needs several signatures is parked at the Accountable Node, which collects the
signatures and submits the transaction when the threshold is reached. The requests are kept by the node alone,
not on the chain, so all five calls go to the node address. `createMultisigRequest(unsignedTx, signature)`
parks the unsigned call with its sender's own signature (`getTxSignatures`); a sender has one open request and
it expires one hour after the transaction's timestamp. `fetchMultisigRequests(signer, status)` lists the
requests in which the public key is an authorised signer, `fetchMultisigRequest(id)` reads one.
`sendMultisigSignature(id, signature)` uploads a signer's signature over the request's `unsignedTx`. The
answers of the create and the signature call carry `submission` when the threshold was reached: `submitted`
with the transaction id, `stale` (the sender's sequence moved, request again) or `failed`, which
`submitMultisigRequest(id)` retries. A transaction carries at most 3 signatures in Phase 1.

## Modules

| Module | Content |
|---|---|
| `encoding` | deterministic JSON, hex, base64, UTF-8, concat, random bytes |
| `hashing` | Blake2b-256, SHA-256, RIPEMD-160, HASH160, double SHA-256, transaction salt |
| `base58` | Base58 and Base58Check |
| `address` | user and contract addresses, validation, `publicKeyOwnsAddress` |
| `keys` | BIP39 mnemonic, BIP32 derivation on `m/44'/19640701'/<account>'/0/<index>` |
| `signing` | ECDSA secp256k1 over SHA-256, DER, `Signer` and `SoftwareSigner` |
| `transaction` | transfer and contract call builders, `serializeForSigning`, `computeTxId`, `validateAmount`; multisig: `getTxSignatures`, `signTransaction`, `combineTxWithSigs`, `validateTransactionSignatures`, `validateTransactionAddressOwnership`, `pendingTxId` |
| `metadata` | the wallet file's record of handed-out addresses and labels |
| `walletfile` | wallet.json version 1: scrypt key derivation, AES-256-GCM, password policy; two sealed payloads, `{mnemonic}` (`createWalletFile`, `openWalletFile`) and `{privateKey}` for an officer's recorded key (`createKeyFile`, `openKeyFile`); `metadata.kind` says which |
| `api` | the API client of the read mirror and the Accountable Node (separate entry point) |

The wallet file carries its scrypt parameters, so a file written with any parameter set opens with any
client. `DEFAULT_SCRYPT_PARAMS` is N=2^17, r=8, p=1 (128 MiB), the OWASP minimum, and takes a few
hundred milliseconds on a desktop CPU. The derivation is synchronous; a page that must stay responsive
runs it in a Web Worker.

## Development

```bash
npm install
npm run type-check
npm run build        # tsc to dist/, committed
npm test             # node:test through tsx
npm run vectors      # rewrites tests/wallet-vectors.json
```

`tests/wallet-vectors.json` holds the values the core must reproduce. `scripts/vectors.ts` writes them
from implementations that share no code with `src/`: bip39, bip32 and tiny-secp256k1 for keys, OpenSSL
through `node:crypto` for SHA-256, RIPEMD-160, ECDSA, scrypt and AES-256-GCM, and blakejs for Blake2b.
Regenerate after a protocol change to addresses, the signing preimage, the
txid or the wallet file, review the diff, and update `src/` until `npm test` passes again. Never change
`src/` to match a wrong vector or a vector to match `src/`.

The dependencies that define bytes are pinned exactly in `package.json`; change a version only with a
green `npm test`.
