import { b64uDecode, domainHash } from "./encoding.js";
import { fail } from "./errors.js";
import { findHost, type HostList } from "./hostList.js";
import { signDomain, verifyDomain } from "./keys.js";
import { defaultClock, isTimestamp, toTimestamp, type Clock } from "./runtime.js";

export const TICKET_DOMAIN = "bl/ticket/v1";
export const MAX_TICKET_TTL_MS = 10 * 60_000;
const MAX_CLOCK_SKEW_MS = 2 * 60_000;

export type Operation = "link" | "sync" | "rekey";
export type ReleaseMode = "dek" | "fields";

export interface Ticket {
  v: 1;
  type: "bl.ticket";
  jobId: string;
  fetchId: string;
  orgId: string;
  profileId: string | null;
  bankId: string;
  operation: Operation;
  releaseMode: ReleaseMode;
  credentialVersion: number | null;
  workerTempPub: string;
  hostKeyId: string;
  issuedAt: string;
  expiresAt: string;
}

const OPS: readonly Operation[] = ["link", "sync", "rekey"];
const MODES: readonly ReleaseMode[] = ["dek", "fields"];
const isId = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 128;

/** Shape + internal-consistency check. Returns a clean copy (unknown keys dropped). */
export function assertTicket(t: unknown): Ticket {
  const x = t as Ticket;
  if (!x || x.v !== 1 || x.type !== "bl.ticket" || !isId(x.jobId) || !isId(x.fetchId) || !isId(x.orgId) || !isId(x.bankId)
    || !OPS.includes(x.operation) || !MODES.includes(x.releaseMode) || !isId(x.hostKeyId)
    || !isTimestamp(x.issuedAt) || !isTimestamp(x.expiresAt)) {
    fail("ticket_invalid", "malformed ticket");
  }
  if (x.releaseMode === "dek") {
    if (!isId(x.profileId) || !Number.isSafeInteger(x.credentialVersion) || (x.credentialVersion as number) < 1) fail("ticket_invalid", "dek ticket needs profileId and credentialVersion");
  } else {
    if (x.credentialVersion !== null || (x.profileId !== null && !isId(x.profileId))) fail("ticket_invalid", "fields ticket must have credentialVersion null");
    if (x.operation === "rekey") fail("ticket_invalid", "rekey needs dek mode");
  }
  try {
    b64uDecode(x.workerTempPub, 32);
  } catch {
    fail("ticket_invalid", "bad workerTempPub");
  }
  const ttl = Date.parse(x.expiresAt) - Date.parse(x.issuedAt);
  if (ttl <= 0 || ttl > MAX_TICKET_TTL_MS) fail("ticket_invalid", "bad ticket lifetime");
  return {
    v: 1, type: "bl.ticket", jobId: x.jobId, fetchId: x.fetchId, orgId: x.orgId, profileId: x.profileId, bankId: x.bankId,
    operation: x.operation, releaseMode: x.releaseMode, credentialVersion: x.credentialVersion,
    workerTempPub: x.workerTempPub, hostKeyId: x.hostKeyId, issuedAt: x.issuedAt, expiresAt: x.expiresAt,
  };
}

export const ticketHash = (ticket: Ticket): string => domainHash(TICKET_DOMAIN, assertTicket(ticket));

/** Worker side. */
export function createTicket(
  input: Omit<Ticket, "v" | "type" | "issuedAt" | "expiresAt">,
  opts: { now?: Clock; ttlMs?: number } = {},
): Ticket {
  const now = (opts.now ?? defaultClock)();
  const ttl = Math.min(opts.ttlMs ?? MAX_TICKET_TTL_MS, MAX_TICKET_TTL_MS);
  return assertTicket({
    v: 1, type: "bl.ticket", ...input,
    issuedAt: toTimestamp(now), expiresAt: toTimestamp(new Date(now.getTime() + ttl)),
  });
}

export const signTicket = (ticket: Ticket, hostPrivateKey: Uint8Array): string => signDomain(TICKET_DOMAIN, assertTicket(ticket), hostPrivateKey);

export interface TicketExpectations {
  orgId: string;
  profileId: string | null;
  bankId: string;
  operation: Operation;
  releaseMode: ReleaseMode;
  credentialVersion: number | null;
}

/**
 * Customer side (00 §8): the ticket is signed by a host on a verified list, is current,
 * and is for exactly the job the caller asked for. `hosts` must come from verifyHostList.
 */
export function verifyTicket(ticket: unknown, signature: string, hosts: HostList, expect: TicketExpectations, opts: { now?: Clock } = {}): Ticket {
  const t = assertTicket(ticket);
  const now = (opts.now ?? defaultClock)().getTime();
  const host = findHost(hosts, t.hostKeyId, Date.parse(t.issuedAt));
  if (!host || !verifyDomain(TICKET_DOMAIN, t, signature, host.publicKey)) fail("ticket_invalid", "ticket not signed by a trusted worker");
  if (Date.parse(t.expiresAt) <= now) fail("ticket_invalid", "ticket expired");
  if (Date.parse(t.issuedAt) > now + MAX_CLOCK_SKEW_MS) fail("ticket_invalid", "ticket issued in the future");
  if (now > Date.parse(host.validUntil)) fail("ticket_invalid", "worker host no longer valid");
  for (const k of ["orgId", "profileId", "bankId", "operation", "releaseMode", "credentialVersion"] as const) {
    if (t[k] !== expect[k]) fail("ticket_invalid", `ticket ${k} does not match the request`);
  }
  return t;
}
