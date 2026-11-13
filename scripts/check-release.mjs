#!/usr/bin/env node
// Release guard, run by prepublishOnly after the build: refuses to publish a package that
// trusts no production worker root, or whose pinned roots don't match their ids.
// Usage: node tools/check-release.mjs [path to the built package, default: this package]
import { createRequire } from "node:module";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? new URL("..", import.meta.url).pathname);
const lib = createRequire(resolve(dir, "package.json"))(resolve(dir, "dist/index.cjs"));
const roots = lib.WORKER_ROOT_KEYS ?? [];
const problems = [];
if (roots.length < 2) problems.push(`expected root-1 and root-2 pinned in WORKER_ROOT_KEYS, found ${roots.length}`);
for (const r of roots) {
  try {
    if (lib.computeRootKeyId(r.publicKey) !== r.rootKeyId) problems.push(`${r.label}: rootKeyId does not match its public key`);
  } catch { problems.push(`${r.label}: public key is not a valid Ed25519 key`); }
}
if (new Set(roots.map(r => r.rootKeyId)).size !== roots.length) problems.push("duplicate root keys");
if (problems.length) {
  console.error("Refusing to publish @banklink/crypto:\n - " + problems.join("\n - ") + "\nSee docs/architecture/ceremony/04-worker-root-key-runbook.md.");
  process.exit(1);
}
console.log(`release check ok: ${roots.length} production roots pinned (${roots.map(r => r.label).join(", ")})`);
