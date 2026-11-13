import { gcm } from "@noble/ciphers/aes.js";
import { b64u, b64uDecode, concatBytes, compact, fromUtf8, signingBytes, utf8 } from "./encoding.js";
import { fail } from "./errors.js";
import { hpkeOpen, hpkeSeal } from "./hpke.js";
import { assertCustomerPublicKey, type CustomerKeys, type CustomerPublicKey } from "./keys.js";
import { defaultRng, type RuntimeOpts } from "./runtime.js";

export const ENVELOPE_FORMAT = "ceremony-v1";
export const PAD_BUCKETS = [512, 2048, 8192, 32768] as const;

/** What is inside C (contract 00 §5). */
export interface CredentialPlaintext {
  v: 1;
  fields: Record<string, string>;
  device?: Record<string, unknown>;
}

/** AAD metadata for C. credentialVersion starts at 1. */
export interface EnvelopeMeta {
  orgId: string;
  profileId: string;
  bankId: string;
  credentialVersion: number;
}

export interface Envelope {
  kid: string;
  credentialVersion: number;
  C: string;
  W: string;
}

// ── validation ───────────────────────────────────────────────────────────────

export function assertFields(fields: unknown): Record<string, string> {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) fail("format_invalid", "fields must be an object");
  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 16) fail("format_invalid", "fields must have 1–16 entries");
  for (const [k, v] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k) || typeof v !== "string" || v.length > 1024) fail("format_invalid", "bad field");
  }
  return fields as Record<string, string>;
}

export function assertPlaintext(p: unknown): CredentialPlaintext {
  const x = p as CredentialPlaintext;
  if (!x || x.v !== 1) fail("format_invalid", "bad credential plaintext");
  assertFields(x.fields);
  if (x.device !== undefined && (typeof x.device !== "object" || x.device === null || Array.isArray(x.device))) fail("format_invalid", "bad device state");
  return compact({ v: 1 as const, fields: x.fields, device: x.device });
}

export function assertMeta(m: EnvelopeMeta): EnvelopeMeta {
  if (!m || typeof m.orgId !== "string" || !m.orgId || typeof m.profileId !== "string" || !m.profileId || typeof m.bankId !== "string" || !m.bankId
    || !Number.isSafeInteger(m.credentialVersion) || m.credentialVersion < 1) {
    fail("format_invalid", "bad envelope metadata");
  }
  return { orgId: m.orgId, profileId: m.profileId, bankId: m.bankId, credentialVersion: m.credentialVersion };
}

// ── padding ──────────────────────────────────────────────────────────────────

export function padPlaintext(json: Uint8Array): Uint8Array {
  const need = 4 + json.length;
  const bucket = PAD_BUCKETS.find((b) => b >= need);
  if (!bucket) fail("format_invalid", "credential plaintext too large");
  const out = new Uint8Array(bucket);
  new DataView(out.buffer).setUint32(0, json.length, false);
  out.set(json, 4);
  return out;
}

export function unpadPlaintext(padded: Uint8Array): Uint8Array {
  if (!PAD_BUCKETS.includes(padded.length as (typeof PAD_BUCKETS)[number])) fail("decrypt_failed");
  const len = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0, false);
  if (len > padded.length - 4) fail("decrypt_failed");
  for (let i = 4 + len; i < padded.length; i++) if (padded[i] !== 0) fail("decrypt_failed");
  return padded.slice(4, 4 + len);
}

// ── C ────────────────────────────────────────────────────────────────────────

const cAad = (meta: EnvelopeMeta) => signingBytes("bl/c/v1", assertMeta(meta));
const wAad = (kid: string, meta: EnvelopeMeta) =>
  signingBytes("bl/w/v1", { kid, orgId: meta.orgId, profileId: meta.profileId, credentialVersion: meta.credentialVersion });

export function encryptC(plaintext: CredentialPlaintext, dek: Uint8Array, meta: EnvelopeMeta, opts: RuntimeOpts = {}): string {
  if (dek.length !== 32) fail("format_invalid", "dek must be 32 bytes");
  // Plain JSON (not JCS): device state may hold floats such as cookie expiry times, and nobody signs this.
  const padded = padPlaintext(utf8(JSON.stringify(assertPlaintext(plaintext))));
  const nonce = (opts.rng ?? defaultRng)(12);
  const ct = gcm(dek, nonce, cAad(meta)).encrypt(padded);
  padded.fill(0);
  return b64u(concatBytes(nonce, ct));
}

export function openC(C: string, dek: Uint8Array, meta: EnvelopeMeta): CredentialPlaintext {
  let bytes: Uint8Array;
  try {
    bytes = b64uDecode(C);
  } catch {
    fail("decrypt_failed");
  }
  if (bytes.length < 12 + 16 + PAD_BUCKETS[0]) fail("decrypt_failed");
  let padded: Uint8Array;
  try {
    padded = gcm(dek, bytes.subarray(0, 12), cAad(meta)).decrypt(bytes.subarray(12));
  } catch {
    fail("decrypt_failed");
  }
  try {
    const json = unpadPlaintext(padded);
    return assertPlaintext(JSON.parse(fromUtf8(json)));
  } catch {
    fail("decrypt_failed");
  } finally {
    padded.fill(0);
  }
}

// ── W ────────────────────────────────────────────────────────────────────────

export async function lockDek(dek: Uint8Array, target: CustomerPublicKey, meta: EnvelopeMeta, opts: RuntimeOpts = {}): Promise<string> {
  const t = assertCustomerPublicKey(target);
  return hpkeSeal(b64uDecode(t.encPub, 32), "bl/w/v1", wAad(t.kid, assertMeta(meta)), dek, opts.rng ?? defaultRng);
}

export async function openW(W: string, meta: EnvelopeMeta, keys: CustomerKeys): Promise<Uint8Array> {
  const dek = await hpkeOpen(keys.encPriv, "bl/w/v1", wAad(keys.kid, assertMeta(meta)), W, "decrypt_failed");
  if (dek.length !== 32) fail("decrypt_failed");
  return dek;
}

// ── whole envelope ───────────────────────────────────────────────────────────

/** Customer side, at link time: fresh DEK, C and W locked to the customer's own public key. */
export async function createEnvelope(plaintext: CredentialPlaintext, meta: EnvelopeMeta, target: CustomerPublicKey, opts: RuntimeOpts = {}): Promise<Envelope> {
  const dek = (opts.rng ?? defaultRng)(32);
  try {
    const C = encryptC(plaintext, dek, meta, opts);
    const W = await lockDek(dek, target, meta, opts);
    return { kid: target.kid, credentialVersion: meta.credentialVersion, C, W };
  } finally {
    dek.fill(0);
  }
}

/** Worker side, after a successful job: new DEK, version + 1, locked to `target` (from inside the sealed release). */
export async function rotateEnvelope(plaintext: CredentialPlaintext, meta: EnvelopeMeta, target: CustomerPublicKey, opts: RuntimeOpts = {}): Promise<Envelope> {
  const next = { ...assertMeta(meta), credentialVersion: meta.credentialVersion + 1 };
  return createEnvelope(plaintext, next, target, opts);
}
