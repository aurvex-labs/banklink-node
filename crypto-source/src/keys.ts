import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { b64u, b64uDecode, concatBytes, signingBytes, utf8 } from "./encoding.js";
import { fail } from "./errors.js";
import { defaultClock, defaultRng, isTimestamp, toTimestamp, type RuntimeOpts } from "./runtime.js";

export const SEED_PREFIX = "blseed_v1_";
const KDF_SALT = utf8("banklink/v1");

export interface CustomerPublicKey {
  kid: string;
  encPub: string;
  sigPub: string;
}

export interface CustomerKeys extends CustomerPublicKey {
  encPriv: Uint8Array;
  sigPriv: Uint8Array;
}

export interface Ed25519KeyPair {
  publicKey: string;
  privateKey: Uint8Array;
}

// ── ids ──────────────────────────────────────────────────────────────────────

export function computeKid(encPub: string, sigPub: string): string {
  return "ck_" + b64u(sha256(concatBytes(b64uDecode(encPub, 32), b64uDecode(sigPub, 32)))).slice(0, 22);
}
export const computeHostKeyId = (pub: string): string => "wh_" + b64u(sha256(b64uDecode(pub, 32))).slice(0, 16);
export const computeRootKeyId = (pub: string): string => "wr_" + b64u(sha256(b64uDecode(pub, 32))).slice(0, 16);

// ── seed ─────────────────────────────────────────────────────────────────────

export const generateSeed = (opts: RuntimeOpts = {}): Uint8Array => (opts.rng ?? defaultRng)(32);

export const encodeSeed = (seed: Uint8Array): string => {
  if (seed.length !== 32) fail("key_invalid", "seed must be 32 bytes");
  return SEED_PREFIX + b64u(seed);
};

export function decodeSeed(text: string): Uint8Array {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t.startsWith(SEED_PREFIX)) fail("key_invalid", "not a BankLink key (expected blseed_v1_…)");
  try {
    return b64uDecode(t.slice(SEED_PREFIX.length), 32);
  } catch {
    fail("key_invalid", "malformed BankLink key");
  }
}

export function deriveCustomerKeys(seed: Uint8Array): CustomerKeys {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) fail("key_invalid", "seed must be 32 bytes");
  const encPriv = hkdf(sha256, seed, KDF_SALT, utf8("bl/enc/v1"), 32);
  const sigPriv = hkdf(sha256, seed, KDF_SALT, utf8("bl/sig/v1"), 32);
  const encPub = b64u(x25519.getPublicKey(encPriv));
  const sigPub = b64u(ed25519.getPublicKey(sigPriv));
  return { kid: computeKid(encPub, sigPub), encPub, sigPub, encPriv, sigPriv };
}

export const publicPart = (k: CustomerPublicKey): CustomerPublicKey => ({ kid: k.kid, encPub: k.encPub, sigPub: k.sigPub });

/** Throws unless kid matches the two public keys. */
export function assertCustomerPublicKey(k: unknown): CustomerPublicKey {
  const c = k as CustomerPublicKey;
  if (!c || typeof c !== "object" || typeof c.kid !== "string" || typeof c.encPub !== "string" || typeof c.sigPub !== "string") {
    fail("key_invalid", "malformed customer key");
  }
  let kid: string;
  try {
    kid = computeKid(c.encPub, c.sigPub);
  } catch {
    fail("key_invalid", "malformed customer key");
  }
  if (kid !== c.kid) fail("key_invalid", "kid does not match public keys");
  return { kid: c.kid, encPub: c.encPub, sigPub: c.sigPub };
}

// ── generic key pairs (worker host / temp / root) ────────────────────────────

export function generateEd25519KeyPair(opts: RuntimeOpts = {}): Ed25519KeyPair {
  const privateKey = (opts.rng ?? defaultRng)(32);
  return { privateKey, publicKey: b64u(ed25519.getPublicKey(privateKey)) };
}

export const ed25519PublicKey = (privateKey: Uint8Array): string => b64u(ed25519.getPublicKey(privateKey));

export function generateX25519KeyPair(opts: RuntimeOpts = {}): { publicKey: string; privateKey: Uint8Array } {
  const privateKey = (opts.rng ?? defaultRng)(32);
  return { privateKey, publicKey: b64u(x25519.getPublicKey(privateKey)) };
}

// ── signatures ───────────────────────────────────────────────────────────────

export function signDomain(domain: string, obj: unknown, privateKey: Uint8Array): string {
  return b64u(ed25519.sign(signingBytes(domain, obj), privateKey));
}

/** Strict RFC 8032 verification (no ZIP-215 leniency). Never throws on a bad signature: returns false. */
export function verifyDomain(domain: string, obj: unknown, signature: string, publicKey: string): boolean {
  try {
    return ed25519.verify(b64uDecode(signature, 64), signingBytes(domain, obj), b64uDecode(publicKey, 32), { zip215: false });
  } catch {
    return false;
  }
}

// ── key registration (00 §4) ─────────────────────────────────────────────────

export interface KeyRegistration {
  v: 1;
  type: "bl.key_registration";
  orgId: string;
  kid: string;
  encPub: string;
  sigPub: string;
  createdAt: string;
}

export function signKeyRegistration(keys: CustomerKeys, orgId: string, opts: RuntimeOpts = {}): { registration: KeyRegistration; signature: string } {
  const registration: KeyRegistration = {
    v: 1,
    type: "bl.key_registration",
    orgId,
    kid: keys.kid,
    encPub: keys.encPub,
    sigPub: keys.sigPub,
    createdAt: toTimestamp((opts.now ?? defaultClock)()),
  };
  return { registration, signature: signDomain("bl/key-registration/v1", registration, keys.sigPriv) };
}

/** Returns the verified public key. Throws key_invalid on any problem. */
export function verifyKeyRegistration(registration: unknown, signature: string, expectedOrgId: string): CustomerPublicKey {
  const r = registration as KeyRegistration;
  if (!r || r.v !== 1 || r.type !== "bl.key_registration" || typeof r.orgId !== "string" || !isTimestamp(r.createdAt)) {
    fail("key_invalid", "malformed registration");
  }
  if (r.orgId !== expectedOrgId) fail("key_invalid", "registration is for another org");
  const pub = assertCustomerPublicKey(r);
  const clean: KeyRegistration = { v: 1, type: "bl.key_registration", orgId: r.orgId, kid: r.kid, encPub: r.encPub, sigPub: r.sigPub, createdAt: r.createdAt };
  if (!verifyDomain("bl/key-registration/v1", clean, signature, pub.sigPub)) fail("key_invalid", "bad registration signature");
  return pub;
}
