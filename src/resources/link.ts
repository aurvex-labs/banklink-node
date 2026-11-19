import type { Client } from '../client';
import type { LinkCreateParams, LinkResult, SingleResponse } from '../types';

export class Link {
  constructor(private readonly client: Client) {}

  async create(params: LinkCreateParams): Promise<LinkResult> {
    const response = await this.client.post<SingleResponse<LinkResult>>('/link', {
      bankId: params.bankId,
      credentials: params.credentials,
      nickname: params.nickname,
      saveCredentials: params.saveCredentials,
      syncTransactions: params.syncTransactions,
    }, params);
    return response.data;
  }

  async requestQrRetry(retryId: string): Promise<void> {
    await this.client.post('/bank-progress/qr-retry', { retryId });
  }
}
