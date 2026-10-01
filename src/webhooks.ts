import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookSignatureError } from './errors';
import type { WebhookEvent } from './types';

export const SIGNATURE_HEADER = 'banklink-signature';

const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Check a webhook's `Banklink-Signature` header against its raw body.
 *
 * Pass the body exactly as received (string or Buffer) — not re-serialised
 * JSON, or the signature won't match. Returns false for a wrong secret, a
 * tampered body, or a timestamp more than `toleranceSeconds` old.
 *
 * During a secret rotation the header carries two `v1` signatures; either
 * matching is enough.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  header: string | null | undefined,
  secret: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): boolean {
  if (!header) return false;
  const body = typeof payload === 'string' ? payload : payload.toString('utf8');
  const parts = header.split(',').map((p) => p.trim().split('='));
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isInteger(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  return parts
    .filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? ''))
    .some(([, v]) => timingSafeEqual(expected, Buffer.from(v, 'hex')));
}

/**
 * Verify a webhook and return its parsed body, or throw WebhookSignatureError.
 *
 * @example
 * app.post('/banklink', express.raw({ type: 'application/json' }), (req, res) => {
 *   const event = constructWebhookEvent(req.body, req.get('Banklink-Signature'), process.env.BANKLINK_WEBHOOK_SECRET!);
 *   // event.event === 'link_request.completed', event.transactions, ...
 *   res.sendStatus(200);
 * });
 */
export function constructWebhookEvent(
  payload: string | Buffer,
  header: string | null | undefined,
  secret: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): WebhookEvent {
  if (!verifyWebhookSignature(payload, header, secret, toleranceSeconds)) {
    throw new WebhookSignatureError();
  }
  return JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8')) as WebhookEvent;
}
