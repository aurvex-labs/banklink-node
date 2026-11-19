export type BankProgressStage = 'connecting' | 'waiting_for_mfa' | 'awaiting_qr_scan' | 'qr_expired' | 'fetching';
/** A bank's sign-in QR code (Capitec), as a data: image URL with its expiry. */
export type BankQrCode = { readonly image: string; readonly expiresAt: string; readonly attempt: number };
export type BankProgress =
  | { readonly stage: 'connecting' | 'waiting_for_mfa' | 'fetching' }
  | { readonly stage: 'awaiting_qr_scan'; readonly qr: BankQrCode }
  /** The code lapsed. POST retryId to /v1/bank-progress/qr-retry before retryUntil for a new one. */
  | { readonly stage: 'qr_expired'; readonly retryUntil: string; readonly retryId: string };

export const bankProgressMessage = (stage: BankProgressStage) => ({
  connecting: 'Connecting to your bank…',
  waiting_for_mfa: 'Waiting for approval in your banking app…',
  awaiting_qr_scan: 'Scan the QR code with your banking app…',
  qr_expired: 'The QR code expired…',
  fetching: 'Fetching account data…',
})[stage];

const QR_IMAGE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
const RETRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** Only the fields each stage allows. The image must be a data: image URL, so nothing else reaches an <img>. */
export const parseBankProgress = (event: any): BankProgress | undefined => {
  switch (event?.stage) {
    case 'connecting': case 'waiting_for_mfa': case 'fetching':
      return { stage: event.stage };
    case 'awaiting_qr_scan': {
      const qr = event.qr;
      if (!qr || typeof qr.image !== 'string' || qr.image.length > 200_000 || !QR_IMAGE.test(qr.image) || !isTime(qr.expiresAt) || !Number.isSafeInteger(qr.attempt) || qr.attempt < 1) return undefined;
      return { stage: 'awaiting_qr_scan', qr: { image: qr.image, expiresAt: qr.expiresAt, attempt: qr.attempt } };
    }
    case 'qr_expired':
      if (!isTime(event.retryUntil) || typeof event.retryId !== 'string' || !RETRY_ID.test(event.retryId)) return undefined;
      return { stage: 'qr_expired', retryUntil: event.retryUntil, retryId: event.retryId };
    default:
      return undefined;
  }
};

export async function readBankProgress<T>(res: Response, onProgress: (progress: BankProgress) => void | Promise<void>): Promise<T> {
  if (!res.headers.get('content-type')?.includes('application/x-ndjson')) return res.json();
  if (!res.body) throw new Error('Connection closed before the bank returned a result');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (finished) throw new Error('Unexpected bank event after completion');
        if (event.type === 'heartbeat') continue;
        const progress = event.type === 'progress' ? parseBankProgress(event) : undefined;
        if (progress) await onProgress(progress);
        else if (event.type === 'result') { result = event.data; finished = true; }
        else if (event.type === 'error') throw new Error(event.message || 'Bank connection failed');
        else throw new Error('Invalid bank progress event');
      }
      if (done) break;
    }
    if (!finished || buffer.trim()) throw new Error('Connection closed before the bank returned a result');
    return result as T;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
