import type { Client } from '../client';
import type { Balance, SingleResponse } from '../types';

export class Balances {
  constructor(private readonly client: Client) {}

  async get(accountId: string): Promise<Balance> {
    const response = await this.client.get<SingleResponse<Balance>>(
      `/accounts/${accountId}/balance`,
    );
    return response.data;
  }
}
