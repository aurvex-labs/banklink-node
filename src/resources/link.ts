import type { Client } from '../client';
import type { LinkCreateParams, LinkOtpParams, LinkResult, SingleResponse } from '../types';

export class Link {
  constructor(private readonly client: Client) {}

  async create(params: LinkCreateParams): Promise<LinkResult> {
    const response = await this.client.post<SingleResponse<LinkResult>>('/link', {
      bank_id: params.bankId,
      credentials: params.credentials,
      nickname: params.nickname,
    });
    return response.data;
  }

  async submitOtp(params: LinkOtpParams): Promise<LinkResult> {
    const response = await this.client.post<SingleResponse<LinkResult>>('/link/otp', {
      session_token: params.sessionToken,
      otp: params.otp,
    });
    return response.data;
  }
}
