import { b64uDecode, sha256b64u } from "./encoding.js";
import { fail } from "./errors.js";
import { assertMeta, lockDek, openW, type EnvelopeMeta } from "./envelope.js";
import { assertCustomerPublicKey, signDomain, verifyDomain, type CustomerKeys, type CustomerPublicKey } from "./keys.js";
import { defaultClock, isTimestamp, toTimestamp, type RuntimeOpts } from "./runtime.js";

/**
 * Customer-key rotation by local re-wrap (contract 00 §17).
 *
 * C's AAD has no kid, so moving a profile to a new customer key only needs a new W: open W with
 * the old key, seal the same DEK to the new key with the new kid in W's AAD. C and the credential
 * version stay the same, and no worker or bank login is involved. The old signing key approves
 * the exact new W, so a relay can't substitute its own.
 */

export const REWRAP_DOMAIN = "bl/rewrap/v1";

export interface RewrapApproval {
  v: 1;
  type: "bl.rewrap";
  orgId: string;
  profileId: string;
  credentialVersion: number;
  fromKid: string;
  toKid: string;
  /** sha256 of the new W's raw bytes (b64u), like releaseHash. */
  wHash: string;
  decidedAt: string;
}

/** Hash of a W (or any b64u sealed blob) as bound by the approval. Throws format_invalid on bad input. */
export function wHash(W: string): string {
  try {
    return sha256b64u(b64uDecode(W));
  } catch {
    fail("format_invalid", "W is not base64url");
  }
}

/**
 * Opens W with `from` and seals the same DEK to `to` (kid in the AAD). Throws decrypt_failed if
 * `from` can't open it, key_invalid if `to` is the same key. The DEK is wiped before returning.
 */
export async function rewrapW(W: string, meta: EnvelopeMeta, from: CustomerKeys, to: CustomerPublicKey, opts: RuntimeOpts = {}): Promise<string> {
  const target = assertCustomerPublicKey(to);
  if (target.kid === from.kid) fail("key_invalid", "re-wrap target is the current key");
  const dek = await openW(W, assertMeta(meta), from);
  try {
    return await lockDek(dek, target, meta, opts);
  } finally {
    dek.fill(0);
  }
}

export function signRewrap(
  input: { orgId: string; profileId: string; credentialVersion: number; toKid: string; W: string },
  from: CustomerKeys,
  opts: RuntimeOpts = {},
): { approval: RewrapApproval; approvalSig: string } {
  const approval: RewrapApproval = {
    v: 1, type: "bl.rewrap", orgId: input.orgId, profileId: input.profileId, credentialVersion: input.credentialVersion,
    fromKid: from.kid, toKid: input.toKid, wHash: wHash(input.W), decidedAt: toTimestamp((opts.now ?? defaultClock)()),
  };
  return { approval, approvalSig: signDomain(REWRAP_DOMAIN, approval, from.sigPriv) };
}

/**
 * API side. Throws approval_invalid unless the approval is signed by `fromSigPub` and binds exactly
 * these values, including the hash of the W being stored.
 */
export function verifyRewrap(
  approval: unknown,
  signature: unknown,
  fromSigPub: string,
  expect: { orgId: string; profileId: string; credentialVersion: number; fromKid: string; toKid: string; W: string },
): RewrapApproval {
  const a = approval as RewrapApproval;
  if (!a || typeof a !== "object" || a.v !== 1 || a.type !== "bl.rewrap" || !isTimestamp(a.decidedAt)) fail("approval_invalid");
  for (const k of ["orgId", "profileId", "credentialVersion", "fromKid", "toKid"] as const) if (a[k] !== expect[k]) fail("approval_invalid");
  let expectedHash: string;
  try { expectedHash = wHash(expect.W); } catch { fail("approval_invalid"); }
  if (a.wHash !== expectedHash) fail("approval_invalid");
  const clean: RewrapApproval = {
    v: 1, type: "bl.rewrap", orgId: a.orgId, profileId: a.profileId, credentialVersion: a.credentialVersion,
    fromKid: a.fromKid, toKid: a.toKid, wHash: a.wHash, decidedAt: a.decidedAt,
  };
  if (typeof signature !== "string" || !verifyDomain(REWRAP_DOMAIN, clean, signature, fromSigPub)) fail("approval_invalid");
  return clean;
}

/**
 * Customer side, one call per profile: re-wraps W to `to`, checks the result opens with `toKeys`
 * when given (the SDK always passes it), and signs the approval with the old key.
 */
export async function customerRewrap(
  input: { orgId: string; profileId: string; bankId: string; credentialVersion: number; W: string },
  from: CustomerKeys,
  to: CustomerPublicKey | CustomerKeys,
  opts: RuntimeOpts = {},
): Promise<{ W: string; approval: RewrapApproval; approvalSig: string }> {
  const meta = { orgId: input.orgId, profileId: input.profileId, bankId: input.bankId, credentialVersion: input.credentialVersion };
  const W = await rewrapW(input.W, meta, from, to, opts);
  if ("encPriv" in to) {
    // Self-check before anything leaves the process: the new W opens to the same DEK.
    const [a, b] = await Promise.all([openW(input.W, meta, from), openW(W, meta, to)]);
    const same = a.length === b.length && a.every((x, i) => x === b[i]);
    a.fill(0); b.fill(0);
    if (!same) fail("decrypt_failed");
  }
  return { W, ...signRewrap({ ...input, toKid: to.kid, W }, from, opts) };
}
