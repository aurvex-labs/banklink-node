import { b64uDecode, compact, fromUtf8, sha256b64u, utf8 } from "./encoding.js";
import { fail } from "./errors.js";
import { assertFields } from "./envelope.js";
import { hpkeOpen, hpkeSeal } from "./hpke.js";
import { assertCustomerPublicKey, signDomain, verifyDomain, type CustomerKeys, type CustomerPublicKey } from "./keys.js";
import { defaultClock, defaultRng, isTimestamp, toTimestamp, type RuntimeOpts } from "./runtime.js";
import { assertTicket, ticketHash, type Ticket } from "./ticket.js";

export type ReleasePayloadMode = "dek" | "fields" | "otp";

/** Sync parameters travel inside the sealed release, so the API never learns them. */
export interface ReleaseRequestParams {
  accounts?: string[];
  fromDate?: string;
  toDate?: string;
}

export interface Release {
  v: 1;
  type: "bl.release";
  ticketHash: string;
  mode: ReleasePayloadMode;
  dek?: string;
  fields?: Record<string, string>;
  device?: Record<string, unknown>;
  otp?: string;
  customer?: CustomerPublicKey;
  rekeyTo?: CustomerPublicKey;
  request?: ReleaseRequestParams;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertRequestParams(r: unknown): ReleaseRequestParams {
  const x = r as ReleaseRequestParams;
  if (!x || typeof x !== "object" || Array.isArray(x)) fail("release_invalid");
  if (x.accounts !== undefined && (!Array.isArray(x.accounts) || x.accounts.length > 50 || !x.accounts.every((a) => typeof a === "string" && a.length > 0 && a.length <= 64))) fail("release_invalid");
  if (x.fromDate !== undefined && !(typeof x.fromDate === "string" && DATE_RE.test(x.fromDate))) fail("release_invalid");
  if (x.toDate !== undefined && !(typeof x.toDate === "string" && DATE_RE.test(x.toDate))) fail("release_invalid");
  return compact({ accounts: x.accounts, fromDate: x.fromDate, toDate: x.toDate });
}

const keyOrFail = (k: unknown): CustomerPublicKey => {
  try {
    return assertCustomerPublicKey(k);
  } catch {
    fail("release_invalid");
  }
};

/** Validate a release against the ticket it was sealed to (00 §9). Returns a clean copy. */
export function assertRelease(r: unknown, ticket: Ticket): Release {
  const x = r as Release;
  const th = ticketHash(ticket);
  if (!x || x.v !== 1 || x.type !== "bl.release" || x.ticketHash !== th) fail("release_invalid");
  const base = { v: 1 as const, type: "bl.release" as const, ticketHash: th };

  if (x.mode === "otp") {
    if (typeof x.otp !== "string" || x.otp.length < 1 || x.otp.length > 32) fail("release_invalid");
    if (x.dek !== undefined || x.fields !== undefined || x.customer !== undefined || x.rekeyTo !== undefined || x.request !== undefined) fail("release_invalid");
    return { ...base, mode: "otp", otp: x.otp };
  }
  if (x.mode !== ticket.releaseMode) fail("release_invalid");
  const customer = keyOrFail(x.customer);
  const request = x.request === undefined ? undefined : assertRequestParams(x.request);
  if (x.otp !== undefined) fail("release_invalid");

  if (x.mode === "dek") {
    if (typeof x.dek !== "string") fail("release_invalid");
    try {
      b64uDecode(x.dek, 32);
    } catch {
      fail("release_invalid");
    }
    if (x.fields !== undefined || x.device !== undefined) fail("release_invalid");
    let rekeyTo: CustomerPublicKey | undefined;
    if (ticket.operation === "rekey") {
      rekeyTo = keyOrFail(x.rekeyTo);
      if (rekeyTo.kid === customer.kid) fail("release_invalid");
      if (request !== undefined) fail("release_invalid");
    } else if (x.rekeyTo !== undefined) {
      fail("release_invalid");
    }
    return compact({ ...base, mode: "dek" as const, dek: x.dek, customer, rekeyTo, request });
  }

  // fields
  try {
    assertFields(x.fields);
  } catch {
    fail("release_invalid");
  }
  if (x.dek !== undefined || x.rekeyTo !== undefined) fail("release_invalid");
  if (x.device !== undefined && (typeof x.device !== "object" || x.device === null || Array.isArray(x.device))) fail("release_invalid");
  return compact({ ...base, mode: "fields" as const, fields: x.fields, device: x.device, customer, request });
}

/** Seal a release to the worker's temporary key from the ticket. Payload is plain JSON (it may carry floats in device state). */
export async function sealRelease(release: Release, ticket: Ticket, opts: RuntimeOpts = {}): Promise<string> {
  const t = assertTicket(ticket);
  const clean = assertRelease(release, t);
  return hpkeSeal(b64uDecode(t.workerTempPub, 32), "bl/release/v1", utf8(clean.ticketHash), utf8(JSON.stringify(clean)), opts.rng ?? defaultRng);
}

export async function openRelease(sealed: string, tempPriv: Uint8Array, ticket: Ticket): Promise<Release> {
  const t = assertTicket(ticket);
  const th = ticketHash(t);
  const pt = await hpkeOpen(tempPriv, "bl/release/v1", utf8(th), sealed, "release_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(pt));
  } catch {
    fail("release_invalid");
  } finally {
    pt.fill(0);
  }
  return assertRelease(parsed, t);
}

export function releaseHash(sealed: string): string {
  try {
    return sha256b64u(b64uDecode(sealed));
  } catch {
    fail("release_invalid");
  }
}

// ── approval (00 §10) ────────────────────────────────────────────────────────

export const APPROVAL_DOMAIN = "bl/approval/v1";

export interface Approval {
  v: 1;
  type: "bl.approval";
  fetchId: string;
  ticketHash: string;
  releaseHash: string;
  kid: string;
  decidedAt: string;
}

export function signApproval(input: { fetchId: string; ticketHash: string; releaseHash: string }, keys: CustomerKeys, opts: RuntimeOpts = {}): { approval: Approval; approvalSig: string } {
  const approval: Approval = {
    v: 1, type: "bl.approval", fetchId: input.fetchId, ticketHash: input.ticketHash, releaseHash: input.releaseHash,
    kid: keys.kid, decidedAt: toTimestamp((opts.now ?? defaultClock)()),
  };
  return { approval, approvalSig: signDomain(APPROVAL_DOMAIN, approval, keys.sigPriv) };
}

/** Throws approval_invalid unless the approval is signed by `sigPub` and binds exactly these values. */
export function verifyApproval(
  approval: unknown,
  signature: string,
  sigPub: string,
  expect: { fetchId: string; ticketHash: string; releaseHash: string; kid: string },
): Approval {
  const a = approval as Approval;
  if (!a || a.v !== 1 || a.type !== "bl.approval" || !isTimestamp(a.decidedAt)) fail("approval_invalid");
  for (const k of ["fetchId", "ticketHash", "releaseHash", "kid"] as const) if (a[k] !== expect[k]) fail("approval_invalid");
  const clean: Approval = { v: 1, type: "bl.approval", fetchId: a.fetchId, ticketHash: a.ticketHash, releaseHash: a.releaseHash, kid: a.kid, decidedAt: a.decidedAt };
  if (typeof signature !== "string" || !verifyDomain(APPROVAL_DOMAIN, clean, signature, sigPub)) fail("approval_invalid");
  return clean;
}

// ── sealed result (00 §11) ───────────────────────────────────────────────────

export interface ResultPayload {
  v: 1;
  type: "bl.result";
  jobId: string;
  operation: Ticket["operation"];
  data: unknown;
}

export async function sealResult(payload: Omit<ResultPayload, "v" | "type">, customer: CustomerPublicKey, th: string, opts: RuntimeOpts = {}): Promise<string> {
  const c = assertCustomerPublicKey(customer);
  const body: ResultPayload = { v: 1, type: "bl.result", jobId: payload.jobId, operation: payload.operation, data: payload.data ?? null };
  return hpkeSeal(b64uDecode(c.encPub, 32), "bl/result/v1", utf8(th), utf8(JSON.stringify(body)), opts.rng ?? defaultRng);
}

export async function openResult(sealed: string, keys: CustomerKeys, th: string, expect: { jobId: string }): Promise<ResultPayload> {
  const pt = await hpkeOpen(keys.encPriv, "bl/result/v1", utf8(th), sealed, "decrypt_failed");
  let r: ResultPayload;
  try {
    r = JSON.parse(fromUtf8(pt));
  } catch {
    fail("decrypt_failed");
  }
  if (!r || r.v !== 1 || r.type !== "bl.result" || r.jobId !== expect.jobId) fail("decrypt_failed");
  return r;
}
