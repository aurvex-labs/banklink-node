import {
  AuthenticationError,
  BanklinkError,
  InsufficientCreditsError,
  NotFoundError,
  OrgNotVerifiedError,
  RateLimitError,
} from './errors';
import type { BanklinkOptions } from './types';

const DEFAULT_BASE_URL = 'https://api.banklink.co.za/v1';
const DEFAULT_TIMEOUT = 30_000;
const SDK_VERSION = '0.2.0';

export class Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(opts: BanklinkOptions) {
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
        throw new BanklinkError(
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
      let errorCode: string | undefined;
      try {
        // v1 errors are { error: { code, message } }; tolerate { error: "..." } too.
        const errorBody = (await response.json()) as {
          error?: string | { code?: string; message?: string };
          message?: string;
        };
        if (errorBody.error && typeof errorBody.error === 'object') {
          errorMessage = errorBody.error.message;
          errorCode = errorBody.error.code;
        } else {
          errorMessage = errorBody.error ?? errorBody.message;
        }
      } catch {
        // ignore JSON parse failures on error body
      }

      if (errorCode === 'org_not_verified') throw new OrgNotVerifiedError(errorMessage);

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
          throw new BanklinkError(
            errorMessage ?? `Unexpected error (HTTP ${response.status})`,
            errorCode ?? 'api_error',
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
