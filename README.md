# @banklink/sdk

Official Banklink SDK for TypeScript and Node.js. Version **0.3.0**, Node 20+. The v2 client bundles `@banklink/crypto` with two production worker roots pinned. V2 is in limited preview: your organisation must be enabled and your live API key must have the explicit `v2` scope. Contact Banklink for access. Publishing the SDK does not enable v2 for an organisation. The Python SDK remains v1-only.

## Customer-held-key v2

```ts
import { BanklinkV2 } from '@banklink/sdk';
// Also: import { BanklinkV2 } from '@banklink/sdk/v2';
import { FileVersionCache } from '@banklink/sdk/local';
const banklink = new BanklinkV2({
  apiKey: process.env.BANKLINK_API_KEY!,
  keyProvider: async () => loadSeedFromYourSecretManager(),
  hostVersionCache: new FileVersionCache('/private/user-owned-directory/host-version'),
});
const profile = await banklink.profiles.create({ bank: 'fnb', fields: { username, password } });
const result = await banklink.profiles.sync(profile.id, {
  accounts: ['account-id'], fromDate: '2026-10-01',
  onOtp: async () => collectOtpPrivately(),
  signal: abortController.signal,
});
```

`key` and `keyProvider` are mutually exclusive. The provider loads lazily; it must return the same current seed throughout an operation. Fields, account/date parameters and OTP are sealed locally. The API receives only public registration, envelope and sealed ceremony payloads. Results are opaque worker JSON, returned as `unknown` for caller validation. Create returns `{id, bankId, data}`. Never log secrets or whole transport bodies.

Supported: `keys.init(backedUpSeed?)`, `current()`, `pending()`, `rotate(backedUpTargetSeed)`, `banks.list()`, `profiles.create/list/delete/verify/sync/syncOnce`. Verify uses a link job; syncOnce takes `{bank, fields, ...jobOptions}`. Every job method accepts `onOtp`, `signal`, `timeoutMs` and sealed request options `accounts/fromDate/toDate`. Without `onOtp`, OTP cancels the active job and throws `OtpRequiredError`.

Back up seeds **before** registration/rotation. SDK `keys.init()` returns a generated seed; interactive apps should instead generate/back up a seed with the crypto package before passing it to `keys.init(seed)`. A caller that loses the init return value still needs its prior backup. Lost seed means re-linking; Banklink can't recover it and the portal has no reset.

**Rotating your key** (`keys.rotate(backedUpTargetSeed, {rollDataKeys?})`) re-wraps each profile's data key locally: it fetches the profile's `W` (never `C`), opens it with the old key, seals the same data key to the new key, checks the result, and sends it with an approval signed by the old key. No worker job and no bank login. During a partial rotation keep **both** old and target seeds and call `keys.rotate(theSameTargetSeed)` again; profiles already on the target are skipped using public metadata `kid`. Don't run syncs with the old seed while a rotation is in progress (a profile with a live job can't be re-wrapped and returns `job_exists`; retry after it finishes). The client's seed changes only after completion. The data key itself changes on the next successful job; if the old seed may have leaked, pass `rollDataKeys: true` (one verify job per profile) or call `profiles.verify(id)` for each profile with the new seed.

**IP allowlists:** an API key can be restricted to IP addresses or CIDR ranges in the developer portal. Calls from elsewhere fail with `CeremonyError` code `ip_not_allowed`. `sk_test_` keys are refused by v2 (`test_key_not_supported`).

Default bounds: HTTP 10 seconds/3 MiB, job execution 240 seconds, polling from 250 ms backing off to 2 s, at most three OTP prompts. Options: `requestTimeoutMs`, `timeoutMs`, `pollIntervalMs`. Releases, OTP and collection are never retried, except after a 429 (refused before it was handled, so safe to resend). If a release/collection response is lost, start a fresh job; the result may be unrecoverable. Failures attempt DELETE with an independent HTTP deadline; worker TTL is the fallback. A create response lost before the job id is known cannot be explicitly cancelled. Profile creation may have succeeded even if verification fails; inspect metadata and verify or delete it.

Typed coarse errors from `/v2`: `KeyRequiredError`, `KeyMismatchError`, `TicketInvalidError`, `OtpRequiredError`, `BankLoginFailedError`, `JobExpiredError`, base `CeremonyError` with `code`. HTTP 429 is retried up to four times when `Retry-After` is 15 s or less; a longer `Retry-After` (for example the per-profile limit of 3 bank logins per 10 minutes) fails at once as `rate_limited` with `retryAfterMs`. Limits are per organisation, shared by all its keys: 60 requests a minute (job polls counted separately) and 10 bank logins a minute. No raw transport errors/stacks or remote messages are exposed by v2. HTTPS is required except loopback HTTP. Test roots require explicit constructor `test: {allowTestRoot: true}`;  Production empty pins fail closed. Host-list versions are monotonic in memory. Optional `FileVersionCache` uses private files, serializes writes within its instance and must have one process/instance owner; use a serialized external `VersionCache` for concurrent processes. Protect backups/cache against deletion/rollback with your local security policy.

## One-off fetches and progress

A one-off fetch needs an enabled organisation and a v2 API key, but no saved customer seed or key registration. The SDK creates a throwaway key in memory for the job and wipes its key buffers afterwards.

```ts
import { BanklinkV2 } from '@banklink/sdk/v2';

const banklink = new BanklinkV2({ apiKey: process.env.BANKLINK_API_KEY! });
const result = await banklink.profiles.syncOnce({
  bank: 'fnb',
  fields: await collectBankLoginPrivately(),
  onOtp: async () => collectOtpPrivately(),
  onStatus(status) {
    // Show coarse progress only; never log credentials, OTPs or results.
    if (status.stage === 'awaiting_approval') showApprovalDeadline(status.expiresAt);
  },
});
```

`onStatus` reports `preparing`, `signing_in`, `awaiting_approval`, `awaiting_otp`, `fetching` and `decrypting`. Stages can be skipped. An approval event includes `expiresAt` and may include `resent` when the bank sends another notification. The callback's errors are ignored so display failures do not break jobs.

The API relays encrypted credentials, releases and results. The Banklink-operated worker decrypts credentials briefly to sign in to the bank and encrypts results to your job key. This is not operator-blind execution. Keep bank login collection and OTP entry in your own private input flow.

The CLI and MCP server are on hold. This release contains neither a `banklink` executable nor an `@banklink/sdk/mcp` export.

## Source and verification

The customer-side cryptographic source is available in [`crypto-source/src`](crypto-source/src), alongside frozen vectors in [`crypto-source/test-vectors`](crypto-source/test-vectors). The installed package bundles crypto 0.2.1; a separate crypto registry install is not needed.

The integration tests and offline simulator run from the source monorepo. They cover sealed credentials and results, ticket tampering, worker-list rollback, OTP, cancellation, rotation, one-off keys and progress. A clean packed-package install is checked before release.

## Deprecated v1 API (compatibility)

The default and named `Banklink` export keep v1 behaviour and options; the examples below describe that legacy surface. The v1 client itself has no runtime dependencies (native `fetch`); the v2 client adds bundled `@banklink/crypto`. Old callers are never silently routed to v2. Deep source imports were never a supported API and are excluded by the exports map.

## Installation

```bash
npm install @banklink/sdk
```

## Quick Start

```typescript
import Banklink from '@banklink/sdk';

const banklink = new Banklink({ apiKey: 'bkl_live_your_api_key' });

// List all linked accounts
const { data: accounts } = await banklink.accounts.list();
console.log(accounts);

// Get transactions for an account
const { data: transactions } = await banklink.transactions.list('acc_123', { limit: 50 });
console.log(transactions);

// Auto-paginate through all transactions
for await (const txn of banklink.transactions.listAutoPaginate('acc_123', { limit: 100 })) {
  console.log(txn.date, txn.description, txn.amount);
}

// Get the balance for an account
const balance = await banklink.balances.get('acc_123');
console.log(balance.balance, balance.currency);

// Trigger a sync (ingest latest transactions)
const result = await banklink.accounts.sync('acc_123');
console.log(`Synced ${result.synced} new transactions, skipped ${result.skipped} duplicates`);
```

## Configuration

```typescript
const banklink = new Banklink({
  apiKey: 'bkl_live_your_api_key', // Required
  baseUrl: 'https://api.banklink.co.za/v1', // Optional, defaults to production
  timeout: 30000, // Optional, request timeout in ms (default: 30000)
});
```

| Option    | Type     | Default                              | Description                     |
|-----------|----------|--------------------------------------|---------------------------------|
| `apiKey`  | `string` | —                                    | Your Banklink API key (required)|
| `baseUrl` | `string` | `https://api.banklink.co.za/v1`      | API base URL                    |
| `timeout` | `number` | `30000`                              | Request timeout in milliseconds |

## Accounts

```typescript
// List all accounts
const { data: accounts } = await banklink.accounts.list();

// Get a single account
const account = await banklink.accounts.get('acc_123');

// Trigger a sync
const { synced, skipped } = await banklink.accounts.sync('acc_123');
```

## Transactions

```typescript
// List transactions (paginated)
const page = await banklink.transactions.list('acc_123', { limit: 50 });
console.log(page.data);       // Transaction[]
console.log(page.cursor);     // string | null — pass as cursor for next page

// Next page
const nextPage = await banklink.transactions.list('acc_123', {
  limit: 50,
  cursor: page.cursor ?? undefined,
});

// Auto-paginate through all transactions
for await (const txn of banklink.transactions.listAutoPaginate('acc_123')) {
  console.log(txn);
}
```

## Balances

```typescript
const balance = await banklink.balances.get('acc_123');
console.log(balance.balance);       // number | null
console.log(balance.currency);      // e.g. "ZAR"
console.log(balance.last_synced_at); // ISO timestamp or null
```

## Linking a Bank Account

```typescript
// Initiate bank linking
const result = await banklink.link.create({
  bankId: 'fnb',
  credentials: {
    username: 'your_username',
    password: 'your_password',
  },
  nickname: 'My FNB Cheque Account', // Optional
});

if (result.type === 'success') {
  console.log('Linked! Profile ID:', result.profile_id);
} else if (result.type === 'mfa_required') {
  // Submit OTP
  const otpResult = await banklink.link.submitOtp({
    sessionToken: result.session_token!,
    otp: '123456',
  });
  console.log('OTP result:', otpResult.type);
}
```

## Hosted request links

Live requests need a verified link profile: see
[Verify your organisation](https://banklink.co.za/resources/verify-organisation-link-requests).
Until then they throw `OrgNotVerifiedError`; test keys (`sk_test_`) work straight away.
Live webhook and redirect URLs must be https on your verified domain.

```typescript
// Retains encrypted credentials for repeat syncs. The initial transactions are
// also stored in Banklink because saveData is true.
const linkRequest = await banklink.requests.createLink({
  reference: 'customer-4821',
  bankId: 'fnb',
  returnOptions: { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
  destinations: [{ type: 'webhook', url: 'https://example.co.za/banklink' }],
  saveData: true,
  // Optional. Banklink appends banklink_status and banklink_reference.
  redirectUrl: 'https://example.co.za/onboarding/bank-done',
});

// Performs one fetch and delivery without storing credentials or transactions.
const accessRequest = await banklink.requests.createAccess({
  reference: 'affordability-check-774',
  destinations: [{ type: 'webhook', url: 'https://example.co.za/banklink' }],
});

// Send the hosted URL to your customer.
console.log(linkRequest.url, accessRequest.url);
```

## Verifying webhooks

Every webhook carries a `Banklink-Signature` header signed with your webhook
signing secret (dashboard → Settings → Webhook signing). Verify it against the
**raw** request body before trusting the payload:

```typescript
import express from 'express';
import { constructWebhookEvent, WebhookSignatureError } from '@banklink/sdk';

app.post('/banklink', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = constructWebhookEvent(req.body, req.get('Banklink-Signature'), process.env.BANKLINK_WEBHOOK_SECRET!);
    if (event.event === 'link_request.completed') {
      // event.reference, event.account_number, event.transactions
    }
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return res.sendStatus(400);
    throw err;
  }
});
```

`verifyWebhookSignature(rawBody, header, secret, toleranceSeconds = 300)` returns
a boolean if you'd rather handle it yourself. Signatures older than the tolerance
are rejected, and either secret is accepted during the 24 hours after a rotation.
Use the `Banklink-Delivery` header to ignore duplicate deliveries.

## Error Handling

```typescript
import Banklink, {
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  OrgNotVerifiedError,
  RateLimitError,
  BanklinkError,
} from '@banklink/sdk';

try {
  const account = await banklink.accounts.get('acc_doesnt_exist');
} catch (err) {
  if (err instanceof NotFoundError) {
    console.error('Account not found');
  } else if (err instanceof AuthenticationError) {
    console.error('Invalid API key');
  } else if (err instanceof RateLimitError) {
    console.error('Too many requests — back off and retry');
  } else if (err instanceof InsufficientCreditsError) {
    console.error('Account has insufficient credits');
  } else if (err instanceof OrgNotVerifiedError) {
    console.error('Verify your link profile before creating live link requests');
  } else if (err instanceof BanklinkError) {
    console.error(`API error ${err.status}: ${err.message} (code: ${err.code})`);
  } else {
    throw err; // re-throw unexpected errors
  }
}
```

### Error Classes

| Class                    | HTTP Status | Code                    |
|--------------------------|-------------|-------------------------|
| `AuthenticationError`    | 401         | `authentication_error`  |
| `InsufficientCreditsError` | 402       | `insufficient_credits`  |
| `NotFoundError`          | 404         | `not_found`             |
| `OrgNotVerifiedError`    | 403         | `org_not_verified`      |
| `RateLimitError`         | 429         | `rate_limit_exceeded`   |
| `WebhookSignatureError`  | —           | `webhook_signature_invalid` |
| `BanklinkError`          | any         | the API's error code, e.g. `bad_request` |

All error classes extend `BanklinkError`, which extends `Error`.

## Requirements

- **Node.js 18+** (uses native `fetch` and `AbortController`)
- **Zero runtime dependencies**

## License

MIT — Copyright (c) 2026 Aurvex Labs
