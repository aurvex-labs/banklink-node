import {
  BankLinkError,
  AuthenticationError,
  InsufficientCreditsError,
  NotFoundError,
  RateLimitError,
} from './errors';
import type { BankLinkOptions } from './types';

const DEFAULT_BASE_URL = 'https://api.banklink.co.za/v1';
const DEFAULT_TIMEOUT = 30_000;
const SDK_VERSION = '0.1.0';

export class Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(opts: BankLinkOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': `banklink-node/${SDK_VERSION}`,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new BankLinkError(
          `Request timed out after ${this.timeout}ms`,
          'timeout',
          0,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let errorMessage: string | undefined;
      try {
        const errorBody = (await response.json()) as { error?: string; message?: string };
        errorMessage = errorBody.error ?? errorBody.message;
      } catch {
        // ignore JSON parse failures on error body
      }

      switch (response.status) {
        case 401:
          throw new AuthenticationError(errorMessage);
        case 402:
          throw new InsufficientCreditsError(errorMessage);
        case 404:
          throw new NotFoundError(errorMessage);
        case 429:
          throw new RateLimitError(errorMessage);
        default:
          throw new BankLinkError(
            errorMessage ?? `Unexpected error (HTTP ${response.status})`,
            'api_error',
            response.status,
          );
      }
    }

    return response.json() as Promise<T>;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
}
