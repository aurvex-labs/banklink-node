import { b64u, signingBytes, utf8 } from "./encoding.js";
import { fail } from "./errors.js";
import { computeHostKeyId, computeRootKeyId, ed25519PublicKey, verifyDomain } from "./keys.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { defaultClock, isTimestamp, type Clock } from "./runtime.js";

export const HOST_LIST_DOMAIN = "bl/worker-hosts/v1";

export interface RootKey {
  rootKeyId: string;
  publicKey: string;
  label: string;
}

/**
 * Production worker root keys (contract 00 §7, runbook 04), pinned 2026-11-09.
 * - root-1 signs host lists day to day. It lives in Cloud KMS
 *   (project banklink-roots, africa-south1, key ring banklink-roots, key worker-root-1, version 1).
 * - root-2 is the offline spare, used only if root-1 is lost or leaked (runbook 04 §7).
 * Changing this list means every SDK, keyholder and dashboard frame must upgrade.
 */
export const WORKER_ROOT_KEYS: readonly RootKey[] = Object.freeze([
  Object.freeze({ rootKeyId: "wr_zlxldZ_stOcPvMxW", publicKey: "nWYJ9_E4D10vlcPukAEERET8iQDtumirpDDam6-wwNk", label: "root-1" }),
  Object.freeze({ rootKeyId: "wr_oxy8ekGkfPd0-hcW", publicKey: "q9ul3DMgPr2kh8S3VGKsN2nESVrRQWTOoCR0_2xI9g0", label: "root-2" }),
]);

/**
 * TEST root key: derived from a public label, so anyone can sign with it. Never trusted
 * unless allowTestRoot is set. Used by the simulator and tests.
 */
const TEST_ROOT_LABEL = "banklink test worker root key - NOT FOR PRODUCTION";
export function testRootPrivateKey(): Uint8Array {
  return sha256(utf8(TEST_ROOT_LABEL));
}
const testRootPub = ed25519PublicKey(testRootPrivateKey());
export const TEST_ROOT_KEYS: readonly RootKey[] = Object.freeze([
  { rootKeyId: computeRootKeyId(testRootPub), publicKey: testRootPub, label: "test-root" },
]);

export interface HostEntry {
  hostKeyId: string;
  publicKey: string;
  validFrom: string;
  validUntil: string;
}

export interface HostList {
  v: 1;
  type: "bl.worker_hosts";
  version: number;
  issuedAt: string;
  expiresAt: string;
  hosts: HostEntry[];
}

export interface HostListEnvelope {
  list: HostList;
  rootKeyId: string;
  signature: string;
}

function assertHostList(l: unknown): HostList {
  const x = l as HostList;
  if (!x || x.v !== 1 || x.type !== "bl.worker_hosts" || !Number.isSafeInteger(x.version) || x.version < 1
    || !isTimestamp(x.issuedAt) || !isTimestamp(x.expiresAt) || !Array.isArray(x.hosts) || x.hosts.length > 256) {
    fail("host_list_invalid", "malformed host list");
  }
  const hosts = x.hosts.map((h) => {
    if (!h || typeof h.publicKey !== "string" || !isTimestamp(h.validFrom) || !isTimestamp(h.validUntil)) fail("host_list_invalid", "malformed host entry");
    let id: string;
    try {
      id = computeHostKeyId(h.publicKey);
    } catch {
      fail("host_list_invalid", "malformed host key");
    }
    if (id !== h.hostKeyId) fail("host_list_invalid", "hostKeyId does not match key");
    return { hostKeyId: h.hostKeyId, publicKey: h.publicKey, validFrom: h.validFrom, validUntil: h.validUntil };
  });
  return { v: 1, type: "bl.worker_hosts", version: x.version, issuedAt: x.issuedAt, expiresAt: x.expiresAt, hosts };
}

/** Online step 1: build the list and the exact bytes the offline laptop signs with `openssl pkeyutl -sign -rawin`. */
export function prepareHostList(input: { version: number; issuedAt: string; expiresAt: string; hosts: Omit<HostEntry, "hostKeyId">[] }): { list: HostList; tosign: Uint8Array } {
  const list = assertHostList({
    v: 1,
    type: "bl.worker_hosts",
    version: input.version,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    hosts: input.hosts.map((h) => {
      try {
        return { ...h, hostKeyId: computeHostKeyId(h.publicKey) };
      } catch {
        fail("host_list_invalid", "malformed host key");
      }
    }),
  });
  return { list, tosign: signingBytes(HOST_LIST_DOMAIN, list) };
}

function rootsFor(opts: { rootKeys?: readonly RootKey[]; allowTestRoot?: boolean }): readonly RootKey[] {
  const roots = [...(opts.rootKeys ?? WORKER_ROOT_KEYS), ...(opts.allowTestRoot ? TEST_ROOT_KEYS : [])];
  if (roots.length === 0) fail("host_list_invalid", "no worker root keys configured (production keys not yet pinned)");
  return roots;
}

/** Online step 2: attach the offline signature (raw 64 bytes or b64u), checking it against the trusted roots. */
export function assembleHostList(list: HostList, signature: Uint8Array | string, opts: { rootKeys?: readonly RootKey[]; allowTestRoot?: boolean } = {}): HostListEnvelope {
  const clean = assertHostList(list);
  const sig = typeof signature === "string" ? signature : b64u(signature);
  const root = rootsFor(opts).find((r) => verifyDomain(HOST_LIST_DOMAIN, clean, sig, r.publicKey));
  if (!root) fail("host_list_invalid", "signature does not match any trusted root key");
  return { list: clean, rootKeyId: root.rootKeyId, signature: sig };
}

export interface VerifyHostListOpts {
  rootKeys?: readonly RootKey[];
  allowTestRoot?: boolean;
  /** Highest version this client has seen; lower versions are rejected (rollback protection). */
  minVersion?: number;
  now?: Clock;
}

export function verifyHostList(envelope: unknown, opts: VerifyHostListOpts = {}): HostList {
  const e = envelope as HostListEnvelope;
  if (!e || typeof e !== "object" || typeof e.rootKeyId !== "string" || typeof e.signature !== "string") fail("host_list_invalid", "malformed envelope");
  const list = assertHostList(e.list);
  const root = rootsFor(opts).find((r) => r.rootKeyId === e.rootKeyId);
  if (!root || !verifyDomain(HOST_LIST_DOMAIN, list, e.signature, root.publicKey)) fail("host_list_invalid", "bad host list signature");
  const now = (opts.now ?? defaultClock)().getTime();
  if (Date.parse(list.expiresAt) <= now) fail("host_list_invalid", "host list expired");
  if (Date.parse(list.issuedAt) > now + 2 * 60_000) fail("host_list_invalid", "host list issued in the future");
  if (opts.minVersion !== undefined && list.version < opts.minVersion) fail("host_list_invalid", "host list rollback");
  return list;
}

/** Find a host that is valid at `at`. */
export function findHost(list: HostList, hostKeyId: string, at: number): HostEntry | undefined {
  return list.hosts.find((h) => h.hostKeyId === hostKeyId && Date.parse(h.validFrom) <= at && at <= Date.parse(h.validUntil));
}
