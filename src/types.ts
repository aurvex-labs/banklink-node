export interface BankLinkOptions {
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
