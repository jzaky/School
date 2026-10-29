#!/usr/bin/env node
/**
 * Independent verifier for an AEGIS evidence bundle. Needs only Node.js: no AEGIS code, no database,
 * no network. Anyone (an auditor, a customer, a regulator) can run it on an exported bundle.
 *
 *   node verify-evidence.mjs <bundle-folder>
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

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node verify-evidence.mjs <bundle-folder>");
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
const publicKey = createPublicKey(readFileSync(join(dir, "public-key.pem"), "utf8"));

let ok = true;
const fail = (msg) => {
  ok = false;
  console.log(`FAIL  ${msg}`);
};
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
if (ok) console.log(`OK    ${events.length} records, ${events[0].seq} to ${last.seq}: consecutive, linked, unedited, and the signed checkpoint matches.`);
process.exit(ok ? 0 : 1);
