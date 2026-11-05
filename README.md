# streembit-bc-sdk

The Streembit Blockchain SDK: the wallet core and the Accountable Node API client. One implementation of
every byte a wallet produces and the node verifies, used by the node, the CLI wallet, the Foundation's web
wallet and the desktop wallet.

- `streembit-bc-sdk`: key creation, HD derivation, addresses, transaction building, the signing preimage,
  the txid, signing through the `Signer` interface, the encrypted wallet file and its metadata, and the
  block hash and creator block signature that the node and the read mirror verify.
- `streembit-bc-sdk/api`: the client of the node's public HTTP API and of a read mirror that serves its read routes.

Pure JavaScript only (`@noble/curves`, `@noble/hashes`, `@scure/bip32`, `@scure/bip39`, `decimal.js` and
Web Crypto), no native modules and no WebAssembly. Every function carries the name of the node function it
replaces and behaves as that function does. The same code runs in Node 22.12 or later, in a browser bundle and
in NW.js.
Types and protocol constants come from `streembit-bc-types`; nothing is redeclared here.

## Installation

The package is not published to npm; install it from GitHub:

```bash
npm install github:streembit/streembit-bc-sdk
```

`dist/` is committed, as in `streembit-bc-types`, so an install from GitHub needs no build step.
Node 22.12 or later is required: the noble and scure packages are ECMAScript modules and are required
from CommonJS.

## Usage

```typescript
import { AssetId } from 'streembit-bc-types';
import { generateMnemonic, seedFromMnemonic, deriveFromSeed, SoftwareSigner, buildTransferTx, signTransaction, txToString, createWalletFile, openWalletFile } from 'streembit-bc-sdk';
import { configureApi, configureReadApi, fetchStatus, fetchAccount, submitTransaction } from 'streembit-bc-sdk/api';

// Keys: derive the seed once per session, then accounts from it.
const mnemonic = generateMnemonic();
const seed = seedFromMnemonic(mnemonic);
const account = deriveFromSeed(seed, 0, 0);          // { path, privateKey, publicKey, address }

// Wallet file (wallet.json version 1), stored wherever the wallet decides.
const file = await createWalletFile(mnemonic, 'Correct-Horse#2026', { network: 'devnet' });
const restored = await openWalletFile(file, 'Correct-Horse#2026');

// A transfer: chain id, version and the next sequence come from the node, never from the read address.
configureApi('https://node.example.org');
configureReadApi('https://mirror.example.org');      // optional; balances, history and status are read here
const status = await fetchStatus('node');
const info = await fetchAccount(account.address, 'node');
const tx = buildTransferTx({ chainId: status.chainId, version: status.version, from: account.address, to: 'S...', amount: '1.5', asset: AssetId.SBRIT, sequence: info.sequence + 1 });
const signer = new SoftwareSigner(account.privateKey);
await signTransaction(tx, [signer]);   // refuses a signer that does not control tx.from
signer.dispose();
const { txid } = await submitTransaction(txToString(tx));
```

## Node address and read address

The API client calls two addresses:

| Address | Set by | Calls |
|---|---|---|
| node | `configureApi(url)`, read back with `apiBaseUrl()` | `submitTransaction`, `fetchContract`, and `fetchStatus('node')`, `fetchAccount(address, 'node')` |
| read | `configureReadApi(url)`, read back with `readApiBaseUrl()` | `fetchStatus()`, `fetchAccount(address)`, `fetchTransactions(address)` |

The read address is a read mirror that serves the node's read routes with the same paths and response shapes.
While none is configured (or after `configureReadApi('')`), `readApiBaseUrl()` returns the node address and every
call goes to the node, so a consumer that calls `configureApi` only works as before. An error the client raises
itself (no answer, an answer that is not JSON or lacks a field) names the address it called, "The node API at
<url>" or "The read API at <url>"; an error answer keeps the server's own message.

Sequence rule: build a transaction from the node's state. The mirror can be a block or two behind the node, and a
second send built on its sequence would reuse a sequence and be rejected, so the chain id, the version and the
sequence of a transaction being built are read with `fetchStatus('node')` and `fetchAccount(address, 'node')`.

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
| `api` | the Accountable Node API client (separate entry point) |

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
