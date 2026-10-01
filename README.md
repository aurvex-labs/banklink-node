# @banklink/sdk

Official Banklink SDK for TypeScript and Node.js. Zero dependencies — uses native `fetch` (Node 18+).

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
