import { Client } from './client';
import { Accounts } from './resources/accounts';
import { Balances } from './resources/balances';
import { Link } from './resources/link';
import { Transactions } from './resources/transactions';
import type { BankLinkOptions } from './types';

export class BankLink {
  readonly accounts: Accounts;
  readonly transactions: Transactions;
  readonly balances: Balances;
  readonly link: Link;

  constructor(opts: BankLinkOptions) {
    const client = new Client(opts);
    this.accounts = new Accounts(client);
    this.transactions = new Transactions(client);
    this.balances = new Balances(client);
    this.link = new Link(client);
  }
}

export default BankLink;

// Error classes
export {
  AuthenticationError,
  BankLinkError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
} from './errors';

// Types
export type {
  Account,
  ApiKeyInfo,
  Balance,
  BankLinkOptions,
  LinkCreateParams,
  LinkOtpParams,
  LinkResult,
  ListParams,
  ListResponse,
  SingleResponse,
  SyncResult,
  Transaction,
} from './types';
