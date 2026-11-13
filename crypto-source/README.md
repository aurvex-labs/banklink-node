# @banklink/crypto

The cryptography behind BankLink's two-party credential ceremony. **BankLink stores your bank credentials encrypted (`C`), with the key to them locked to your public key (`W`). Only you hold the private key. The two halves meet only inside a BankLink worker, for one job you approve, and the worker re-encrypts under a new key afterwards.** BankLink can't decrypt your credentials or read your results.

This package implements every step of that protocol, so neither your code nor ours has to. It uses no custom cryptography, only standard constructions from widely used libraries:

| Purpose | Construction | Library |
|---|---|---|
| Key derivation | HKDF-SHA256 | `@noble/hashes` |
| Public-key encryption | HPKE, RFC 9180 (X25519, HKDF-SHA256, AES-256-GCM) | `@hpke/core`, `@hpke/dhkem-x25519` |
| Signatures | Ed25519 | `@noble/curves` |
| Symmetric encryption | AES-256-GCM | `@noble/ciphers` |
| Canonical JSON for signatures | RFC 8785 | `canonicalize` |

Most developers should use [`@banklink/sdk`](../node), which calls this package for you. The full specification is [`docs/architecture/ceremony/00-shared-contract-and-crypto.md`](../../../docs/architecture/ceremony/00-shared-contract-and-crypto.md) in the BankLink repository.

## Install

```bash
npm install @banklink/crypto
```

ESM and CommonJS builds. Node ≥ 20 and modern browsers.

## Development

```bash
npm test                  # unit, ceremony round-trip, attack and frozen-vector tests
npm run build             # dist/ (ESM + CJS + types)
npm run tools -- help     # ceremony-tools: worker host list prepare / assemble / verify
```

`test-vectors/v1.json` is **frozen**. Any implementation of the protocol (for example a future Python SDK) must open every value in it and reproduce the deterministic ones.

## Licence

MIT
