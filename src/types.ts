export interface BanklinkOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface Account {
  id: string;
  bank: string;
  account_number: string | null;
  nickname: string;
  last_synced_at: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  account_id: string;
  external_id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  direction: 'debit' | 'credit';
  balance: number | null;
  reference: string | null;
  created_at: string;
}

export interface Balance {
  account_id: string;
  balance: number | null;
  currency: string;
  last_synced_at: string | null;
}

export interface SyncResult {
  synced: number;
  skipped: number;
}

export interface LinkResult {
  type: 'success' | 'mfa_required' | 'error';
  profile_id?: string;
  account_number?: string | null;
  session_token?: string;
  message?: string;
}

export interface ApiKeyInfo {
  valid: boolean;
  key_id: string;
  org_id: string;
  name: string;
  scopes: string[];
}

export interface ListResponse<T> {
  data: T[];
  cursor: string | null;
}

export interface SingleResponse<T> {
  data: T;
}

export interface ListParams {
  limit?: number;
  cursor?: string;
}

export interface LinkCreateParams {
  bankId: string;
  credentials: Record<string, string>;
  nickname?: string;
}

export interface LinkOtpParams {
  sessionToken: string;
  otp: string;
}

export type RequestDestination =
  | { type: 'webhook'; url: string }
  | { type: 'email'; address: string };

export interface RequestReturnOptions {
  dateFrom?: string;
  dateTo?: string;
}

export interface HostedRequestCreateParams {
  reference: string;
  name?: string;
  bankId?: string;
  returnOptions?: RequestReturnOptions;
  /** Live requests: webhook URLs must be https on your verified domain. */
  destinations: RequestDestination[];
  expiresAt?: string;
  /**
   * Where to send the customer after they finish or cancel. Must be https on
   * your verified domain (test keys may also use http://localhost). Defaults to
   * the redirect URL in your link profile. Banklink appends `banklink_status`
   * and `banklink_reference` query parameters.
   */
  redirectUrl?: string;
}

export interface LinkRequestCreateParams extends HostedRequestCreateParams {
  saveData?: boolean;
}

export type AccessRequestCreateParams = HostedRequestCreateParams;

export interface HostedRequest {
  id: string;
  /** `link` keeps an encrypted login for later fetches; `access` fetches once. */
  kind?: 'link' | 'access';
  reference: string;
  name?: string;
  token: string;
  url: string;
  status: 'pending' | 'completed' | 'expired' | 'revoked';
  bank_id: string | null;
  return_options: RequestReturnOptions;
  destinations: RequestDestination[];
  save_data?: boolean;
  redirect_url?: string | null;
  expires_at: string | null;
  completed_at?: string | null;
  /** Why the customer's last attempt failed, while the request is pending. */
  last_error?: string | null;
  /** Set when the bank fetch succeeded but a webhook/email delivery failed. */
  delivery_error?: string | null;
  created_at: string;
}

/** Value of the `banklink_status` query parameter on your redirect URL. */
export type RedirectStatus = 'success' | 'cancelled' | 'expired' | 'revoked' | 'already_completed';

export type WebhookEventType = 'link_request.completed' | 'access_request.completed' | 'pulse.delivered';

/** The JSON body Banklink POSTs to a webhook destination. */
export interface WebhookEvent {
  event: WebhookEventType;
  request_type?: 'link_request' | 'access_request';
  link_request_id?: string;
  access_request_id?: string;
  pulse_id?: string;
  reference?: string;
  account_number?: string | null;
  transactions: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    currency: string;
    direction: 'debit' | 'credit';
    balance?: number | null;
    reference?: string | null;
  }>;
}
