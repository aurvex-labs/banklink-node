import { CipherSuite, Aes256Gcm, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { b64u, b64uDecode, concatBytes, utf8 } from "./encoding.js";
import { fail, type CeremonyErrorCode } from "./errors.js";
import { defaultRng, type Rng } from "./runtime.js";

/** HPKE base mode, DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM (contract 00 §2). */
const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

const ENC_LEN = 32;
const toAB = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

/**
 * Seal `pt` to an X25519 public key. Returns b64u(enc || ct).
 * The library generates the ephemeral key itself unless a non-default rng is supplied
 * (only test-vector generation does that).
 */
export async function hpkeSeal(recipientPub: Uint8Array, info: string, aad: Uint8Array, pt: Uint8Array, rng: Rng = defaultRng): Promise<string> {
  const recipientPublicKey = await suite.kem.importKey("raw", toAB(recipientPub), true);
  const params = rng === defaultRng
    ? { recipientPublicKey, info: utf8(info) }
    : { recipientPublicKey, info: utf8(info), ekm: toAB(rng(32)) };
  const { enc, ct } = await suite.seal(params, pt, aad);
  return b64u(concatBytes(new Uint8Array(enc), new Uint8Array(ct)));
}

/** Open b64u(enc || ct). Any failure → CeremonyError(failCode). */
export async function hpkeOpen(recipientPriv: Uint8Array, info: string, aad: Uint8Array, sealed: string, failCode: CeremonyErrorCode): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = b64uDecode(sealed);
  } catch {
    fail(failCode);
  }
  if (bytes.length < ENC_LEN + 16) fail(failCode);
  try {
    const recipientKey = await suite.kem.importKey("raw", toAB(recipientPriv), false);
    const pt = await suite.open(
      { recipientKey, enc: toAB(bytes.subarray(0, ENC_LEN)), info: utf8(info) },
      bytes.subarray(ENC_LEN),
      aad,
    );
    return new Uint8Array(pt);
  } catch {
    fail(failCode);
  }
}
