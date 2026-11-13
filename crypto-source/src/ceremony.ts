/**
 * High-level flows (contract 00 §13). These are what the SDK, API tests and worker call.
 * Each one does every check in the contract, in order, so callers can't skip a step.
 */
import { b64u, b64uDecode } from "./encoding.js";
import { fail } from "./errors.js";
import { assertMeta, openC, openW, rotateEnvelope, type CredentialPlaintext, type Envelope, type EnvelopeMeta } from "./envelope.js";
import type { HostList } from "./hostList.js";
import { assertCustomerPublicKey, publicPart, type CustomerKeys, type CustomerPublicKey } from "./keys.js";
import {
  openRelease, openResult, releaseHash, sealRelease, sealResult, signApproval, verifyApproval,
  type Approval, type Release, type ReleaseRequestParams,
} from "./release.js";
import { type RuntimeOpts } from "./runtime.js";
import { assertTicket, ticketHash, verifyTicket, type Operation, type ReleaseMode, type Ticket } from "./ticket.js";

/** API → SDK (00 §12.1). */
export interface ReleaseRequest {
  jobId: string;
  fetchId: string;
  expiresAt: string;
  operation: Operation;
  releaseMode: ReleaseMode;
  profile: { id: string | null; bankId: string };
  credential?: { kid: string; credentialVersion: number; W: string };
  ticket: Ticket;
  ticketSig: string;
}

/** SDK → API (00 §12.2), plus ticketHash which the SDK keeps locally to open the result. */
export interface ReleaseResponse {
  fetchId: string;
  sealedRelease: string;
  approval: Approval;
  approvalSig: string;
}

export interface CustomerReleaseInput {
  orgId: string;
  /** What the caller asked for. The ticket must match it exactly. */
  expect: { profileId: string | null; bankId: string; operation: Operation };
  fields?: Record<string, string>;
  device?: Record<string, unknown>;
  request?: ReleaseRequestParams;
  rekeyTo?: CustomerPublicKey;
}

export interface CustomerReleaseOpts extends RuntimeOpts {
  /** From verifyHostList. */
  hosts: HostList;
}

export async function customerBuildRelease(
  req: ReleaseRequest,
  keys: CustomerKeys,
  input: CustomerReleaseInput,
  opts: CustomerReleaseOpts,
): Promise<{ response: ReleaseResponse; ticket: Ticket; ticketHash: string }> {
  if (!req || typeof req !== "object") fail("format_invalid", "bad release request");
  const mode = req.releaseMode;
  if (mode === "dek" && !req.credential) fail("format_invalid", "dek release request without credential");
  if (mode === "fields" && !input.fields) fail("format_invalid", "fields mode needs fields");
  if (mode === "dek" && input.fields) fail("format_invalid", "dek mode must not send fields");

  const ticket = verifyTicket(req.ticket, req.ticketSig, opts.hosts, {
    orgId: input.orgId,
    profileId: input.expect.profileId,
    bankId: input.expect.bankId,
    operation: input.expect.operation,
    releaseMode: mode,
    credentialVersion: mode === "dek" ? req.credential!.credentialVersion : null,
  }, opts);
  if (ticket.fetchId !== req.fetchId || ticket.jobId !== req.jobId) fail("ticket_invalid", "ticket does not match the request");
  const th = ticketHash(ticket);

  let release: Release;
  let dek: Uint8Array | undefined;
  try {
    if (mode === "dek") {
      if (req.credential!.kid !== keys.kid) fail("key_invalid", "credentials are locked to a different customer key");
      const meta: EnvelopeMeta = { orgId: input.orgId, profileId: ticket.profileId!, bankId: ticket.bankId, credentialVersion: ticket.credentialVersion! };
      dek = await openW(req.credential!.W, meta, keys);
      release = {
        v: 1, type: "bl.release", ticketHash: th, mode: "dek", dek: b64u(dek), customer: publicPart(keys),
        ...(ticket.operation === "rekey" ? { rekeyTo: assertCustomerPublicKey(input.rekeyTo) } : {}),
        ...(input.request ? { request: input.request } : {}),
      };
    } else {
      release = {
        v: 1, type: "bl.release", ticketHash: th, mode: "fields", fields: input.fields!, customer: publicPart(keys),
        ...(input.device ? { device: input.device } : {}),
        ...(input.request ? { request: input.request } : {}),
      };
    }
    const sealedRelease = await sealRelease(release, ticket, opts);
    const { approval, approvalSig } = signApproval({ fetchId: ticket.fetchId, ticketHash: th, releaseHash: releaseHash(sealedRelease) }, keys, opts);
    return { response: { fetchId: ticket.fetchId, sealedRelease, approval, approvalSig }, ticket, ticketHash: th };
  } finally {
    dek?.fill(0);
  }
}

/** Second login step. `ticket` is the one already verified by customerBuildRelease. */
export async function customerBuildOtpRelease(ticket: Ticket, otp: string, opts: RuntimeOpts = {}): Promise<string> {
  const t = assertTicket(ticket);
  return sealRelease({ v: 1, type: "bl.release", ticketHash: ticketHash(t), mode: "otp", otp }, t, opts);
}

export async function customerOpenResult(sealedResult: string, keys: CustomerKeys, th: string, jobId: string): Promise<unknown> {
  return (await openResult(sealedResult, keys, th, { jobId })).data;
}

// ── worker side ──────────────────────────────────────────────────────────────

export interface WorkerSession {
  ticket: Ticket;
  tempPriv: Uint8Array;
}

export interface WorkerRunBody {
  sealedRelease: string;
  approval: unknown;
  approvalSig: string;
  credential?: { C: string; credentialVersion: number; kid: string };
}

export interface OpenedRelease {
  ticket: Ticket;
  ticketHash: string;
  mode: "dek" | "fields";
  plaintext: CredentialPlaintext;
  customer: CustomerPublicKey;
  rekeyTo?: CustomerPublicKey;
  request?: ReleaseRequestParams;
}

const metaFromTicket = (t: Ticket): EnvelopeMeta =>
  assertMeta({ orgId: t.orgId, profileId: t.profileId!, bankId: t.bankId, credentialVersion: t.credentialVersion! });

/**
 * Worker: everything in 00 §9–10. Metadata for C's AAD comes from the session's ticket, never the body.
 * Throws CeremonyError with release_invalid | approval_invalid | decrypt_failed.
 */
export async function workerOpenRelease(session: WorkerSession, body: WorkerRunBody): Promise<OpenedRelease> {
  const ticket = assertTicket(session.ticket);
  const th = ticketHash(ticket);
  if (!body || typeof body.sealedRelease !== "string") fail("release_invalid");
  const release = await openRelease(body.sealedRelease, session.tempPriv, ticket);
  if (release.mode === "otp") fail("release_invalid");
  const customer = release.customer!;
  verifyApproval(body.approval, body.approvalSig, customer.sigPub, {
    fetchId: ticket.fetchId, ticketHash: th, releaseHash: releaseHash(body.sealedRelease), kid: customer.kid,
  });

  let plaintext: CredentialPlaintext;
  if (release.mode === "dek") {
    const cred = body.credential;
    if (!cred || typeof cred.C !== "string" || cred.credentialVersion !== ticket.credentialVersion || cred.kid !== customer.kid) fail("release_invalid");
    const dek = b64uDecode(release.dek!, 32);
    try {
      plaintext = openC(cred.C, dek, metaFromTicket(ticket));
    } finally {
      dek.fill(0);
    }
  } else {
    plaintext = { v: 1, fields: release.fields!, ...(release.device ? { device: release.device } : {}) };
  }
  return {
    ticket, ticketHash: th, mode: release.mode, plaintext, customer,
    ...(release.rekeyTo ? { rekeyTo: release.rekeyTo } : {}),
    ...(release.request ? { request: release.request } : {}),
  };
}

export async function workerOpenOtp(session: WorkerSession, sealedRelease: string): Promise<string> {
  const release = await openRelease(sealedRelease, session.tempPriv, assertTicket(session.ticket));
  if (release.mode !== "otp") fail("release_invalid");
  return release.otp!;
}

/**
 * Worker, after the connector ran (or straight away for rekey): seal the result to the customer and,
 * in dek mode, rotate C/W to rekeyTo ?? customer — keys taken only from inside the sealed release.
 */
export async function workerFinish(
  opened: OpenedRelease,
  outcome: { data: unknown; device?: Record<string, unknown> },
  opts: RuntimeOpts = {},
): Promise<{ sealedResult: string; rotated?: Envelope }> {
  const { ticket } = opened;
  const sealedResult = await sealResult(
    { jobId: ticket.jobId, operation: ticket.operation, data: ticket.operation === "rekey" ? null : outcome.data },
    opened.customer, opened.ticketHash, opts,
  );
  if (opened.mode !== "dek") return { sealedResult };
  const plaintext: CredentialPlaintext = {
    v: 1, fields: opened.plaintext.fields,
    ...((outcome.device ?? opened.plaintext.device) ? { device: outcome.device ?? opened.plaintext.device } : {}),
  };
  const rotated = await rotateEnvelope(plaintext, metaFromTicket(ticket), opened.rekeyTo ?? opened.customer, opts);
  return { sealedResult, rotated };
}
