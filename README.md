# streembit-bc-sdk

The Streembit Blockchain SDK: the wallet core and the Accountable Node API client. One implementation of
every byte a wallet produces and the node verifies, used by the node, the CLI wallet, the Foundation's web
wallet and the desktop wallet.

- `streembit-bc-sdk`: key creation, HD derivation, addresses, transaction building, the signing preimage,
  the txid, signing through the `Signer` interface, the encrypted wallet file and its metadata.
- `streembit-bc-sdk/api`: the client of the node's public HTTP API.

Pure JavaScript only (`@noble/curves`, `@noble/hashes`, `@scure/bip32`, `@scure/bip39` and Web Crypto),
no native modules and no WebAssembly. The same code runs in Node 22.12 or later, in a browser bundle and
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
import { generateMnemonic, seedFromMnemonic, deriveFromSeed, SoftwareSigner, buildTransferTx, signTransaction, txToString, createWalletFile, openWalletFile } from 'streembit-bc-sdk';
import { configureApi, fetchStatus, fetchAccount, submitTransaction } from 'streembit-bc-sdk/api';

// Keys: derive the seed once per session, then accounts from it.
const mnemonic = generateMnemonic();
const seed = seedFromMnemonic(mnemonic);
const account = deriveFromSeed(seed, 0, 0);          // { path, privateKey, publicKey, address }

// Wallet file (wallet.json version 1), stored wherever the wallet decides.
const file = await createWalletFile(mnemonic, 'Correct-Horse#2026', { network: 'devnet' });
const restored = await openWalletFile(file, 'Correct-Horse#2026');

// A transfer: chain id, version and the next sequence come from the node.
configureApi('https://node.example.org');
const status = await fetchStatus();
const info = await fetchAccount(account.address);
const tx = buildTransferTx({ chainId: status.chainId, version: status.version, from: account.address, to: 'S...', amount: '1.5', sequence: info.sequence + 1 });
const signer = new SoftwareSigner(account.privateKey);
await signTransaction(tx, signer);
signer.dispose();
const { txid } = await submitTransaction(txToString(tx));
```

## Modules

| Module | Content |
|---|---|
| `encoding` | deterministic JSON, hex, base64, UTF-8, concat, random bytes |
| `hashing` | Blake2b-256, SHA-256, RIPEMD-160, HASH160, double SHA-256, transaction salt |
| `base58` | Base58 and Base58Check |
| `address` | user and contract addresses, validation, `publicKeyOwnsAddress` |
| `keys` | BIP39 mnemonic, BIP32 derivation on `m/44'/19640701'/<account>'/0/<index>` |
| `signing` | ECDSA secp256k1 over SHA-256, DER, `Signer` and `SoftwareSigner` |
| `transaction` | transfer and contract call builders, `serializeForSigning`, `computeTxId`, `serializeForAttestation` |
| `metadata` | the wallet file's record of handed-out addresses and labels |
| `walletfile` | wallet.json version 1: scrypt key derivation, AES-256-GCM, password policy |
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
