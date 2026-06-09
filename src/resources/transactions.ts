import type { Client } from '../client';
import type { ListParams, ListResponse, Transaction } from '../types';

export class Transactions {
  constructor(private readonly client: Client) {}

  list(accountId: string, params?: ListParams): Promise<ListResponse<Transaction>> {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.cursor !== undefined) query.set('cursor', params.cursor);
    const qs = query.toString();
    const path = `/accounts/${accountId}/transactions${qs ? `?${qs}` : ''}`;
    return this.client.get<ListResponse<Transaction>>(path);
  }

  async *listAutoPaginate(
    accountId: string,
    params?: { limit?: number },
  ): AsyncGenerator<Transaction> {
    let cursor: string | null = null;

    do {
      const page: ListResponse<Transaction> = await this.list(accountId, {
        limit: params?.limit,
        cursor: cursor ?? undefined,
      });

      for (const transaction of page.data) {
        yield transaction;
      }

      cursor = page.cursor;
    } while (cursor !== null);
  }
}
