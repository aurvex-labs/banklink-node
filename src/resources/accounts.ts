import type { Client } from '../client';
import type { Account, ListResponse, SingleResponse, SyncResult } from '../types';

export class Accounts {
  constructor(private readonly client: Client) {}

  list(): Promise<ListResponse<Account>> {
    return this.client.get<ListResponse<Account>>('/accounts');
  }

  async get(id: string): Promise<Account> {
    const response = await this.client.get<SingleResponse<Account>>(`/accounts/${id}`);
    return response.data;
  }

  async sync(id: string): Promise<SyncResult> {
    const response = await this.client.post<SingleResponse<SyncResult>>(`/accounts/${id}/sync`);
    return response.data;
  }
}
