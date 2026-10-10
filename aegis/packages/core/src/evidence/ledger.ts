import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import type { Prisma, TenantDb } from "@aegis/db";
import { env } from "../env.js";
import { canonicalJson, sha256Hex } from "../lib/crypto.js";
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
export async function appendEvidence(db: TenantDb, ctx: OrgContext, input: EvidenceInput): Promise<EvidenceRecord> {
  await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('evidence:' || $1))`, ctx.orgId);
  const last = await db.evidenceEvent.findFirst({ where: { orgId: ctx.orgId }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
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
    payload: input.payload ?? {},
    prevHash,
    occurredAt: input.occurredAt ?? new Date(),
  };
  const hash = computeEvidenceHash(base);
  const row = await db.evidenceEvent.create({ data: { ...base, payload: base.payload as Prisma.InputJsonValue, hash } });
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
export async function verifyChain(db: TenantDb, orgId: string, opts: { fromSeq?: bigint; limit?: number } = {}): Promise<VerifyResult> {
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
    const ok = !!ev && ev.hash === cp.hash && verifyCheckpointSignature(cp.hash, cp.throughSeq, orgId, cp.signature);
    if (!ok) allCpValid = false;
    cpResults.push({ throughSeq: cp.throughSeq.toString(), valid: ok });
  }
  return { valid: allCpValid, checked: rows.length, firstBadSeq: null, reason: allCpValid ? null : "checkpoint signature or hash mismatch", lastHash: rows.at(-1)?.hash ?? null, checkpoints: cpResults };
}

function signingKey() {
  const raw = env().EVIDENCE_SIGNING_KEY;
  if (!raw) return null;
  const pem = Buffer.from(raw, "base64").toString("utf8");
  return createPrivateKey(pem);
}

export function signingKeyId(): string {
  const key = signingKey();
  if (!key) return "none";
  const pub = createPublicKey(key).export({ type: "spki", format: "der" });
  return sha256Hex(pub).slice(0, 16);
}

export function checkpointMessage(hash: string, throughSeq: bigint, orgId: string): Buffer {
  return Buffer.from(canonicalJson({ v: 1, orgId, throughSeq: throughSeq.toString(), hash }));
}

export function verifyCheckpointSignature(hash: string, throughSeq: bigint, orgId: string, signature: string): boolean {
  const key = signingKey();
  if (!key) return false;
  try {
    return verify(null, checkpointMessage(hash, throughSeq, orgId), createPublicKey(key), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** Signs the latest hash. Returns null when no signing key is configured or nothing new happened. */
export async function writeCheckpoint(db: TenantDb, orgId: string) {
  const key = signingKey();
  if (!key) return null;
  const last = await db.evidenceEvent.findFirst({ where: { orgId }, orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  if (!last) return null;
  const existing = await db.evidenceCheckpoint.findUnique({ where: { orgId_throughSeq: { orgId, throughSeq: last.seq } } });
  if (existing) return existing;
  const signature = sign(null, checkpointMessage(last.hash, last.seq, orgId), key).toString("base64");
  return db.evidenceCheckpoint.create({ data: { orgId, throughSeq: last.seq, hash: last.hash, signature, keyId: signingKeyId() } });
}

export function exportCheckpointPublicKey(): string | null {
  const key = signingKey();
  if (!key) return null;
  return createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
}
