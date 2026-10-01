import type { Client } from '../client';
import type {
  AccessRequestCreateParams,
  HostedRequest,
  LinkRequestCreateParams,
  SingleResponse,
} from '../types';

export class Requests {
  constructor(private readonly client: Client) {}

  async createLink(params: LinkRequestCreateParams): Promise<HostedRequest> {
    const response = await this.client.post<SingleResponse<HostedRequest>>('/link-requests', {
      reference: params.reference,
      name: params.name,
      bank_id: params.bankId,
      return_options: params.returnOptions,
      destinations: params.destinations,
      save_data: params.saveData ?? false,
      expires_at: params.expiresAt,
      redirect_url: params.redirectUrl,
    });
    return response.data;
  }

  async createAccess(params: AccessRequestCreateParams): Promise<HostedRequest> {
    const response = await this.client.post<SingleResponse<HostedRequest>>('/access-requests', {
      reference: params.reference,
      name: params.name,
      bank_id: params.bankId,
      return_options: params.returnOptions,
      destinations: params.destinations,
      expires_at: params.expiresAt,
      redirect_url: params.redirectUrl,
    });
    return response.data;
  }
}
