#!/usr/bin/env node
/**
 * Independent verifier for an AEGIS evidence bundle. Needs only Node.js: no AEGIS code, no database,
 * no network. Anyone (an auditor, a customer, a regulator) can run it on an exported bundle.
 *
 *   node verify-evidence.mjs <bundle-folder> [--key <public-key.pem> | --fingerprint <sha256-hex>] [--expect-through <seq>]
 *
 * --key or --fingerprint pins the signing key you obtained from the AEGIS operator separately. The
 * fingerprint is the SHA-256 of the key (SPKI, DER); its first 16 characters are the key id AEGIS records
 * with every checkpoint, and either form is accepted. Without it the verifier can only use the key inside the bundle, so a bundle
 * rebuilt with a different key would also pass: the result says so. --expect-through checks that the bundle
 * reaches a record number you noted earlier, which detects records removed from the end.
 *
 * The folder holds events.jsonl (one evidence record per line, in sequence), checkpoint.json (a signed
 * checkpoint at the last record) and public-key.pem (the Ed25519 key that signs checkpoints).
 *
 * It checks that (1) the records are consecutive, (2) each record links to the one before it,
 * (3) each record's content matches its hash, so nothing was edited, and (4) the checkpoint signature
 * over the last hash is valid, so the chain was not rebuilt by someone without AEGIS's signing key.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!dir) {
  console.error("usage: node verify-evidence.mjs <bundle-folder> [--key <public-key.pem> | --fingerprint <sha256-hex>] [--expect-through <seq>]");
  process.exit(2);
}

// Must match packages/core/src/lib/crypto.ts canonicalJson exactly.
function normaliseNumber(n) {
  return !Number.isFinite(n) || Number.isInteger(n) ? n : Number(n.toPrecision(15));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    return out;
  }
  return typeof v === "number" ? normaliseNumber(v) : v;
}
const canonicalJson = (v) => JSON.stringify(sortKeys(v));
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

// Must match packages/core/src/evidence/ledger.ts evidenceHashInput exactly.
function hashOf(e) {
  return sha256Hex(canonicalJson({ v: 1, orgId: e.orgId, seq: String(e.seq), type: e.type, actorType: e.actorType, actorId: e.actorId ?? null, subjectType: e.subjectType, subjectId: e.subjectId ?? null, correlationId: e.correlationId ?? null, traceId: e.traceId ?? null, payload: e.payload ?? {}, occurredAt: new Date(e.occurredAt).toISOString(), prevHash: e.prevHash }));
}

const lines = readFileSync(join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean);
const events = lines.map((l) => JSON.parse(l));
const checkpoint = JSON.parse(readFileSync(join(dir, "checkpoint.json"), "utf8"));
const bundledKey = createPublicKey(readFileSync(join(dir, "public-key.pem"), "utf8"));
const fingerprintOf = (k) => createHash("sha256").update(k.export({ type: "spki", format: "der" })).digest("hex");
const pinnedKeyFile = opt("--key");
const pinnedFingerprint = opt("--fingerprint")?.toLowerCase().replace(/[^0-9a-f]/g, "");
const publicKey = pinnedKeyFile ? createPublicKey(readFileSync(pinnedKeyFile, "utf8")) : bundledKey;
const expectThrough = opt("--expect-through");

let ok = true;
const fail = (msg) => {
  ok = false;
  console.log(`FAIL  ${msg}`);
};
if (pinnedKeyFile && fingerprintOf(bundledKey) !== fingerprintOf(publicKey)) fail("the bundle's public key is not the key you supplied");
if (pinnedFingerprint && (pinnedFingerprint.length < 16 || !fingerprintOf(bundledKey).startsWith(pinnedFingerprint))) fail(`the bundle's public key has fingerprint ${fingerprintOf(bundledKey)}, not the one you supplied`);
for (let i = 0; i < events.length; i++) {
  const e = events[i];
  if (i > 0 && BigInt(e.seq) !== BigInt(events[i - 1].seq) + 1n) fail(`record ${e.seq}: sequence gap after ${events[i - 1].seq}`);
  if (i > 0 && e.prevHash !== events[i - 1].hash) fail(`record ${e.seq}: does not link to record ${events[i - 1].seq}`);
  if (hashOf(e) !== e.hash) fail(`record ${e.seq}: content does not match its hash (edited)`);
}
const last = events.at(-1);
if (!last) fail("no records");
else {
  if (String(checkpoint.throughSeq) !== String(last.seq) || checkpoint.hash !== last.hash) fail("checkpoint does not cover the last record");
  const message = Buffer.from(canonicalJson({ v: 1, orgId: last.orgId, throughSeq: String(checkpoint.throughSeq), hash: checkpoint.hash }));
  if (!verify(null, message, publicKey, Buffer.from(checkpoint.signature, "base64"))) fail("checkpoint signature is not valid for this public key");
}
if (expectThrough !== undefined && last && BigInt(last.seq) < BigInt(expectThrough)) fail(`the bundle ends at record ${last.seq}, before record ${expectThrough} you expected: records may have been removed from the end`);
if (ok) {
  console.log(`OK    ${events.length} records, ${events[0].seq} to ${last.seq}: consecutive, linked, unedited, and the signed checkpoint matches.`);
  if (!pinnedKeyFile && !pinnedFingerprint) console.log(`NOTE  checked against the key inside the bundle (fingerprint ${fingerprintOf(bundledKey)}). Compare it with the key id the AEGIS operator gives you (its first 16 characters), or pass --fingerprint, so a rebuilt bundle cannot pass.`);
  if (expectThrough === undefined) console.log("NOTE  records removed from the end cannot be detected from the bundle alone; pass --expect-through with a record number noted earlier.");
}
process.exit(ok ? 0 : 1);
