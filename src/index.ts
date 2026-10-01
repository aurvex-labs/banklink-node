import { Client } from './client';
import { Accounts } from './resources/accounts';
import { Balances } from './resources/balances';
import { Link } from './resources/link';
import { Transactions } from './resources/transactions';
import { Requests } from './resources/requests';
import type { BanklinkOptions } from './types';

export class Banklink {
  readonly accounts: Accounts;
  readonly transactions: Transactions;
  readonly balances: Balances;
  readonly link: Link;
  readonly requests: Requests;

  constructor(opts: BanklinkOptions) {
    const client = new Client(opts);
    this.accounts = new Accounts(client);
    this.transactions = new Transactions(client);
    this.balances = new Balances(client);
    this.link = new Link(client);
    this.requests = new Requests(client);
  }
}

export default Banklink;

// Error classes
export {
  AuthenticationError,
  BanklinkError,
  InsufficientCreditsError,
  NotFoundError,
  OrgNotVerifiedError,
  RateLimitError,
  WebhookSignatureError,
} from './errors';

// Webhooks
export { constructWebhookEvent, verifyWebhookSignature, SIGNATURE_HEADER } from './webhooks';

// Types
export type {
  Account,
  AccessRequestCreateParams,
  ApiKeyInfo,
  Balance,
  BanklinkOptions,
  LinkCreateParams,
  LinkOtpParams,
  LinkResult,
  LinkRequestCreateParams,
  ListParams,
  ListResponse,
  HostedRequest,
  HostedRequestCreateParams,
  RequestDestination,
  RequestReturnOptions,
  RedirectStatus,
  SingleResponse,
  SyncResult,
  Transaction,
  WebhookEvent,
  WebhookEventType,
} from './types';
