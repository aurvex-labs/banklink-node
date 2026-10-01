export class BanklinkError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'BanklinkError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends BanklinkError {
  constructor(message: string = 'Authentication failed. Check your API key.') {
    super(message, 'authentication_error', 401);
    this.name = 'AuthenticationError';
  }
}

export class InsufficientCreditsError extends BanklinkError {
  constructor(message: string = 'Insufficient credits to complete this request.') {
    super(message, 'insufficient_credits', 402);
    this.name = 'InsufficientCreditsError';
  }
}

export class NotFoundError extends BanklinkError {
  constructor(message: string = 'The requested resource was not found.') {
    super(message, 'not_found', 404);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends BanklinkError {
  constructor(message: string = 'Rate limit exceeded. Please slow down your requests.') {
    super(message, 'rate_limit_exceeded', 429);
    this.name = 'RateLimitError';
  }
}

/** The organisation must verify its link profile before creating live link or access requests. */
export class OrgNotVerifiedError extends BanklinkError {
  constructor(message: string = 'Verify your organisation\'s link profile before creating link or access requests.') {
    super(message, 'org_not_verified', 403);
    this.name = 'OrgNotVerifiedError';
  }
}

/** A webhook's Banklink-Signature header didn't match its body, or was too old. */
export class WebhookSignatureError extends BanklinkError {
  constructor(message: string = 'Webhook signature verification failed.') {
    super(message, 'webhook_signature_invalid', 400);
    this.name = 'WebhookSignatureError';
  }
}
