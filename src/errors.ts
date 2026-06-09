export class BankLinkError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'BankLinkError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends BankLinkError {
  constructor(message: string = 'Authentication failed. Check your API key.') {
    super(message, 'authentication_error', 401);
    this.name = 'AuthenticationError';
  }
}

export class InsufficientCreditsError extends BankLinkError {
  constructor(message: string = 'Insufficient credits to complete this request.') {
    super(message, 'insufficient_credits', 402);
    this.name = 'InsufficientCreditsError';
  }
}

export class NotFoundError extends BankLinkError {
  constructor(message: string = 'The requested resource was not found.') {
    super(message, 'not_found', 404);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends BankLinkError {
  constructor(message: string = 'Rate limit exceeded. Please slow down your requests.') {
    super(message, 'rate_limit_exceeded', 429);
    this.name = 'RateLimitError';
  }
}
