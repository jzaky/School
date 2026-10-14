import { m } from "../lib/metrics.js";
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { isDeferredTransaction, onBeforeCommit, type Prisma, type TenantDb } from "@aegis/db";
import { env } from "../env.js";
import { canonicalJson, canonicalValue, sha256Hex } from "../lib/crypto.js";
import type { OrgContext } from "../lib/context.js";

export const GENESIS_HASH = "0".repeat(64);

export interface EvidenceInput {
  type: string;
  subjectType: string;
  subjectId?: string | null;
  correlationId?: string | null;
  payload?: Record<string, unknown>;
  actor?: { type: string; id: string | null };
  traceId?: string | null;
  occurredAt?: Date;
}

export interface EvidenceRecord {
  id: string;
  orgId: string;
  seq: bigint;
  type: string;
  actorType: string;
  actorId: string | null;
  subjectType: string;
  subjectId: string | null;
  correlationId: string | null;
  traceId: string | null;
  payload: unknown;
  prevHash: string;
  hash: string;
  occurredAt: Date;
}

/** The exact bytes that are hashed for an event. Kept stable forever: changing it breaks verification. */
export function evidenceHashInput(e: Omit<EvidenceRecord, "id" | "hash">): string {
  return canonicalJson({
    v: 1,
    orgId: e.orgId,
    seq: e.seq.toString(),
    type: e.type,
    actorType: e.actorType,
    actorId: e.actorId,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    correlationId: e.correlationId,
    traceId: e.traceId,
    payload: e.payload ?? {},
    occurredAt: e.occurredAt.toISOString(),
    prevHash: e.prevHash,
  });
}

export function computeEvidenceHash(e: Omit<EvidenceRecord, "id" | "hash">): string {
  return sha256Hex(evidenceHashInput(e));
}

/**
 * Appends one event to the org's hash chain. Must be called inside the same tenant
 * transaction as the domain change it records, so that a failure to write evidence
 * rolls the domain change back (fail closed). Appends for one org are serialised with
 * a transaction-scoped advisory lock.
 */
const chainHeads = new WeakMap<object, Map<string, { seq: bigint; hash: string }>>();

type Pending = Omit<EvidenceRecord, "id" | "hash" | "seq" | "prevHash">;
const pendingByTx = new WeakMap<object, Pending[]>();

/**
 * Deferred mode (withTenant lock "deferred"): events are kept in order and written just before commit,
 * under the organization lock, with their chain links computed then. The rows, hashes and ordering are
 * exactly what immediate appends would produce; only the time the lock is held changes.
 */
async function flushPending(db: TenantDb, orgId: string) {
  const list = pendingByTx.get(db);
  if (!list?.length) return;
  pendingByTx.set(db, []);
  await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('evidence:' || $1))`, orgId);
  const last = await db.evidenceEvent.findFirst({ where: { orgId }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  let seq = last?.seq ?? 0n;
  let prevHash = last?.hash ?? GENESIS_HASH;
  const rows = list.map((p) => {
    seq += 1n;
    const base = { ...p, seq, prevHash };
    const hash = computeEvidenceHash(base);
    prevHash = hash;
    return { ...base, payload: base.payload as Prisma.InputJsonValue, hash };
  });
  await db.evidenceEvent.createMany({ data: rows });
}

export async function appendEvidence(db: TenantDb, ctx: OrgContext, input: EvidenceInput): Promise<EvidenceRecord> {
  m.evidenceAppended.inc();
  if (isDeferredTransaction(db)) {
    const actor = input.actor ?? { type: ctx.actor.type, id: ctx.actor.id };
    const p: Pending = {
      orgId: ctx.orgId,
      type: input.type,
      actorType: actor.type,
      actorId: actor.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      correlationId: input.correlationId ?? ctx.requestId,
      traceId: input.traceId ?? ctx.traceId ?? null,
      payload: canonicalValue(input.payload ?? {}),
      occurredAt: input.occurredAt ?? ctx.now ?? new Date(),
    };
    let list = pendingByTx.get(db);
    if (!list) {
      list = [];
      pendingByTx.set(db, list);
      onBeforeCommit(db, () => flushPending(db, ctx.orgId));
    }
    list.push(p);
    // Written at commit; the id, sequence and hash are assigned then. No caller reads them back.
    return { ...p, id: "", seq: 0n, prevHash: "", hash: "" } as EvidenceRecord;
  }
  // After the first append in a transaction this transaction holds the organization's ledger lock until it
  // commits, so the head it wrote is still the head: later appends in the same transaction skip the lock
  // and the read. The cache is keyed by the transaction client and dies with it.
  let heads = chainHeads.get(db);
  let last = heads?.get(ctx.orgId) ?? null;
  if (!last) {
    // Re-entrant for the transaction that already holds it (withTenant takes it first); harmless otherwise.
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('evidence:' || $1))`, ctx.orgId);
    last = await db.evidenceEvent.findFirst({ where: { orgId: ctx.orgId }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  }
  const seq = (last?.seq ?? 0n) + 1n;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const actor = input.actor ?? { type: ctx.actor.type, id: ctx.actor.id };
  const base = {
    orgId: ctx.orgId,
    seq,
    type: input.type,
    actorType: actor.type,
    actorId: actor.id,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    correlationId: input.correlationId ?? ctx.requestId,
    traceId: input.traceId ?? ctx.traceId ?? null,
    // Stored exactly as hashed (sorted keys, normalised numbers) so verification is byte-stable.
    payload: canonicalValue(input.payload ?? {}),
    prevHash,
    occurredAt: input.occurredAt ?? ctx.now ?? new Date(),
  };
  const hash = computeEvidenceHash(base);
  const row = await db.evidenceEvent.create({ data: { ...base, payload: base.payload as Prisma.InputJsonValue, hash } });
  if (!heads) {
    heads = new Map();
    chainHeads.set(db, heads);
  }
  heads.set(ctx.orgId, { seq, hash });
  return row as EvidenceRecord;
}

export interface VerifyResult {
  valid: boolean;
  checked: number;
  firstBadSeq: string | null;
  reason: string | null;
  lastHash: string | null;
  checkpoints: { throughSeq: string; valid: boolean }[];
}

/** Recomputes every hash in the chain and validates checkpoint signatures. */
export async function verifyChain(db: TenantDb, orgId: string, opts: { fromSeq?: bigint; limit?: number; ring?: EvidenceKeyRing } = {}): Promise<VerifyResult> {
  const rows = await db.evidenceEvent.findMany({
    where: { orgId, ...(opts.fromSeq ? { seq: { gte: opts.fromSeq } } : {}) },
    orderBy: { seq: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
  });
  let prevHash = GENESIS_HASH;
  if (opts.fromSeq && opts.fromSeq > 1n) {
    const before = await db.evidenceEvent.findUnique({ where: { orgId_seq: { orgId, seq: opts.fromSeq - 1n } }, select: { hash: true } });
    prevHash = before?.hash ?? GENESIS_HASH;
  }
  let expectedSeq = opts.fromSeq ?? 1n;
  for (const r of rows) {
    if (r.seq !== expectedSeq) {
      return { valid: false, checked: rows.length, firstBadSeq: r.seq.toString(), reason: `sequence gap: expected ${expectedSeq}`, lastHash: null, checkpoints: [] };
    }
    if (r.prevHash !== prevHash) {
      return { valid: false, checked: rows.length, firstBadSeq: r.seq.toString(), reason: "previous hash mismatch", lastHash: null, checkpoints: [] };
    }
    const recomputed = computeEvidenceHash(r as EvidenceRecord);
    if (recomputed !== r.hash) {
      return { valid: false, checked: rows.length, firstBadSeq: r.seq.toString(), reason: "content hash mismatch", lastHash: null, checkpoints: [] };
    }
    prevHash = r.hash;
    expectedSeq += 1n;
  }
  const checkpoints = await db.evidenceCheckpoint.findMany({ where: { orgId }, orderBy: { throughSeq: "asc" } });
  const cpResults: { throughSeq: string; valid: boolean }[] = [];
  let allCpValid = true;
  for (const cp of checkpoints) {
    const ev = await db.evidenceEvent.findUnique({ where: { orgId_seq: { orgId, seq: cp.throughSeq } }, select: { hash: true } });
    const ok = !!ev && ev.hash === cp.hash && verifyCheckpointSignature(cp.hash, cp.throughSeq, orgId, cp.signature, cp.keyId, opts.ring);
    if (!ok) allCpValid = false;
    cpResults.push({ throughSeq: cp.throughSeq.toString(), valid: ok });
  }
  return { valid: allCpValid, checked: rows.length, firstBadSeq: null, reason: allCpValid ? null : "checkpoint signature or hash mismatch", lastHash: rows.at(-1)?.hash ?? null, checkpoints: cpResults };
}

/**
 * Evidence signing keys (S9). EVIDENCE_SIGNING_KEY is the current Ed25519 private key (PKCS8 PEM,
 * base64); it signs new checkpoints. EVIDENCE_VERIFY_KEYS lists retired public keys (SPKI PEM, base64,
 * comma separated) so checkpoints signed before a rotation still verify. Each checkpoint records the id
 * of the key that signed it, and verification uses exactly that key: a checkpoint whose key is unknown
 * fails verification instead of being silently skipped.
 */
export interface EvidenceKeyRing {
  current: { keyId: string; privateKey: KeyObject; publicKey: KeyObject } | null;
  /** Every key that may verify, by key id: the current public key and the retired ones. */
  verify: Map<string, KeyObject>;
}

export function keyIdOf(publicKey: KeyObject): string {
  return sha256Hex(publicKey.export({ type: "spki", format: "der" })).slice(0, 16);
}

export function loadKeyRing(signingKeyB64: string | undefined, verifyKeysB64: string | undefined): EvidenceKeyRing {
  const verifyKeys = new Map<string, KeyObject>();
  let current: EvidenceKeyRing["current"] = null;
  if (signingKeyB64) {
    const privateKey = createPrivateKey(Buffer.from(signingKeyB64, "base64").toString("utf8"));
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("EVIDENCE_SIGNING_KEY must be an Ed25519 private key");
    const publicKey = createPublicKey(privateKey);
    current = { keyId: keyIdOf(publicKey), privateKey, publicKey };
    verifyKeys.set(current.keyId, publicKey);
  }
  for (const part of (verifyKeysB64 ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const publicKey = createPublicKey(Buffer.from(part, "base64").toString("utf8"));
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("EVIDENCE_VERIFY_KEYS must hold Ed25519 public keys");
    verifyKeys.set(keyIdOf(publicKey), publicKey);
  }
  return { current, verify: verifyKeys };
}

let cachedRing: { source: string; ring: EvidenceKeyRing } | null = null;
/** The key ring from the environment, rebuilt only when the configured values change. */
export function evidenceKeyRing(): EvidenceKeyRing {
  const e = env();
  const source = `${e.EVIDENCE_SIGNING_KEY ?? ""}|${e.EVIDENCE_VERIFY_KEYS ?? ""}`;
  if (!cachedRing || cachedRing.source !== source) cachedRing = { source, ring: loadKeyRing(e.EVIDENCE_SIGNING_KEY, e.EVIDENCE_VERIFY_KEYS) };
  return cachedRing.ring;
}

export function signingKeyId(ring: EvidenceKeyRing = evidenceKeyRing()): string {
  return ring.current?.keyId ?? "none";
}

export function checkpointMessage(hash: string, throughSeq: bigint, orgId: string): Buffer {
  return Buffer.from(canonicalJson({ v: 1, orgId, throughSeq: throughSeq.toString(), hash }));
}

/** Verifies with the key that signed the checkpoint (by its recorded key id). Unknown key ids fail. */
export function verifyCheckpointSignature(hash: string, throughSeq: bigint, orgId: string, signature: string, keyId: string, ring: EvidenceKeyRing = evidenceKeyRing()): boolean {
  const key = ring.verify.get(keyId);
  if (!key) return false;
  try {
    return verify(null, checkpointMessage(hash, throughSeq, orgId), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Signs the latest hash. Returns null when no signing key is configured or nothing new happened. */
export async function writeCheckpoint(db: TenantDb, orgId: string, ring: EvidenceKeyRing = evidenceKeyRing()) {
  const key = ring.current;
  if (!key) return null;
  const last = await db.evidenceEvent.findFirst({ where: { orgId }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  if (!last) return null;
  const existing = await db.evidenceCheckpoint.findUnique({ where: { orgId_throughSeq: { orgId, throughSeq: last.seq } } });
  if (existing) return existing;
  const signature = sign(null, checkpointMessage(last.hash, last.seq, orgId), key.privateKey).toString("base64");
  return db.evidenceCheckpoint.create({ data: { orgId, throughSeq: last.seq, hash: last.hash, signature, keyId: key.keyId } });
}

/** Public keys that verify checkpoints, current first. Publish these so anyone can check exported evidence. */
export function exportCheckpointPublicKeys(ring: EvidenceKeyRing = evidenceKeyRing()): { keyId: string; current: boolean; pem: string }[] {
  return [...ring.verify.entries()]
    .map(([keyId, k]) => ({ keyId, current: keyId === ring.current?.keyId, pem: k.export({ type: "spki", format: "pem" }).toString() }))
    .sort((a, b) => Number(b.current) - Number(a.current) || a.keyId.localeCompare(b.keyId));
}

/** The current public key, or null when no signing key is configured. */
export function exportCheckpointPublicKey(): string | null {
  return exportCheckpointPublicKeys().find((k) => k.current)?.pem ?? null;
}
