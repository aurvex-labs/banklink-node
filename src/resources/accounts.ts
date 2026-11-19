import type { Client } from '../client';
import type { Account, BankOperationOptions, ListResponse, SingleResponse, SyncResult } from '../types';

export class Accounts {
  constructor(private readonly client: Client) {}

  list(): Promise<ListResponse<Account>> {
    return this.client.get<ListResponse<Account>>('/accounts');
  }

  async get(id: string): Promise<Account> {
    const response = await this.client.get<SingleResponse<Account>>(`/accounts/${id}`);
    return response.data;
  }

  async sync(id: string, options?: BankOperationOptions & { credentials?: Record<string, string>; accounts?: "all" | string[] }): Promise<SyncResult> {
    const response = await this.client.post<SingleResponse<SyncResult>>(`/accounts/${id}/sync`, { credentials: options?.credentials, accounts: options?.accounts }, options);
    return response.data;
  }
}
