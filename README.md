# @banklink/sdk

Official BankLink SDK for TypeScript and Node.js. Zero dependencies — uses native `fetch` (Node 18+).

## Installation

```bash
npm install @banklink/sdk
```

## Quick Start

```typescript
import BankLink from '@banklink/sdk';

const banklink = new BankLink({ apiKey: 'bkl_live_your_api_key' });

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
const banklink = new BankLink({
  apiKey: 'bkl_live_your_api_key', // Required
  baseUrl: 'https://api.banklink.co.za/v1', // Optional, defaults to production
  timeout: 30000, // Optional, request timeout in ms (default: 30000)
});
```

| Option    | Type     | Default                              | Description                     |
|-----------|----------|--------------------------------------|---------------------------------|
| `apiKey`  | `string` | —                                    | Your BankLink API key (required)|
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

## Error Handling

```typescript
import BankLink, {
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
  BankLinkError,
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
  } else if (err instanceof BankLinkError) {
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
| `RateLimitError`         | 429         | `rate_limit_exceeded`   |
| `BankLinkError`          | any         | `api_error` / `timeout` |

All error classes extend `BankLinkError`, which extends `Error`.

## Requirements

- **Node.js 18+** (uses native `fetch` and `AbortController`)
- **Zero runtime dependencies**

## License

MIT — Copyright (c) 2026 Aurvex Labs
