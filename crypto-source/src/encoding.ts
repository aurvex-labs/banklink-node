import canonicalize from "canonicalize";
import { sha256 } from "@noble/hashes/sha2.js";
import { fail } from "./errors.js";

const B64U_RE = /^[A-Za-z0-9_-]*$/;

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(b);

/** base64url without padding. */
export function b64u(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict base64url decode. Rejects padding, other alphabets and impossible lengths. */
export function b64uDecode(s: string, expectedLength?: number): Uint8Array {
  if (typeof s !== "string" || !B64U_RE.test(s) || s.length % 4 === 1) fail("format_invalid", "invalid base64url");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  // Reject non-canonical encodings (trailing bits set) by re-encoding.
  if (b64u(out) !== s) fail("format_invalid", "non-canonical base64url");
  if (expectedLength !== undefined && out.length !== expectedLength) fail("format_invalid", "unexpected length");
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Guard: signed/canonical objects may only contain strings, safe integers, booleans, null, arrays and plain objects. */
function assertCanonicalSafe(v: unknown, depth = 0): void {
  if (depth > 32) fail("format_invalid", "object too deep");
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) fail("format_invalid", "only safe integers allowed");
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) assertCanonicalSafe(x, depth + 1);
    return;
  }
  if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    for (const [, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined) fail("format_invalid", "undefined values not allowed");
      assertCanonicalSafe(x, depth + 1);
    }
    return;
  }
  fail("format_invalid", "unsupported value type");
}

/** RFC 8785 canonical JSON. */
export function jcs(obj: unknown): string {
  assertCanonicalSafe(obj);
  const s = canonicalize(obj);
  if (typeof s !== "string") fail("format_invalid", "cannot canonicalize");
  return s;
}

/** utf8(domain) || 0x0A || utf8(JCS(obj)) — the exact bytes every signature and AAD is computed over. */
export function signingBytes(domain: string, obj: unknown): Uint8Array {
  return utf8(`${domain}\n${jcs(obj)}`);
}

export const sha256b64u = (bytes: Uint8Array): string => b64u(sha256(bytes));

export const domainHash = (domain: string, obj: unknown): string => sha256b64u(signingBytes(domain, obj));

/** Drop keys whose value is undefined, so optional fields never reach JCS. */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}
