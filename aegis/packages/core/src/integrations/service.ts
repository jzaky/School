import type { Prisma, TenantDb } from "@aegis/db";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { decryptSecret, encryptSecret, randomToken } from "../lib/crypto.js";
import { notFound, validation } from "../lib/errors.js";
import { assertPermission, slugSchema } from "../orgs/orgs.js";

export async function listIntegrations(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "integrations:read");
  return db.integration.findMany({ where: { orgId: ctx.orgId }, include: { tools: { select: { id: true, key: true, name: true, enabled: true } }, credentials: { select: { id: true, name: true, version: true, rotationDueAt: true, rotatedAt: true, revokedAt: true, createdAt: true } } }, orderBy: { name: "asc" } });
}

export async function getIntegration(db: TenantDb, ctx: OrgContext, id: string) {
  assertPermission(ctx, "integrations:read");
  const i = await db.integration.findUnique({ where: { id }, include: { tools: true, credentials: { select: { id: true, name: true, version: true, rotationDueAt: true, rotatedAt: true, revokedAt: true, createdAt: true } } } });
  if (!i) throw notFound("Integration");
  const settings = (i.settings ?? {}) as Record<string, unknown>;
  return { ...i, settings: { ...settings, ledger: undefined }, ledger: Array.isArray(settings.ledger) ? (settings.ledger as Record<string, unknown>[]) : [] };
}

export const integrationInputSchema = z.object({ key: slugSchema, name: z.string().min(2).max(120), type: z.string().min(2).max(40), description: z.string().max(1000).default(""), baseUrl: z.string().max(300).optional() });

export async function createIntegration(db: TenantDb, ctx: OrgContext, input: z.infer<typeof integrationInputSchema>) {
  assertPermission(ctx, "integrations:write");
  const webhookSecret = randomToken(24);
  const row = await db.integration.create({ data: { orgId: ctx.orgId, ...input, webhookSecretEnc: encryptSecret(webhookSecret, `integration:${input.key}`) } });
  await appendEvidence(db, ctx, { type: "integration.created", subjectType: "integration", subjectId: row.id, payload: { key: row.key, type: row.type } });
  return { integration: row, webhookSecret };
}

/** Emergency control: disabling an integration makes every tool behind it deny at the gateway. */
export async function setIntegrationStatus(db: TenantDb, ctx: OrgContext, id: string, status: "active" | "disabled", reason: string) {
  assertPermission(ctx, status === "disabled" ? "agents:control" : "integrations:write");
  if (status === "disabled" && reason.trim().length < 3) throw validation("A reason is required");
  const row = await db.integration.update({ where: { id }, data: { status, statusReason: status === "disabled" ? reason : null } });
  await appendEvidence(db, ctx, { type: `integration.${status}`, subjectType: "integration", subjectId: id, payload: { key: row.key, reason } });
  return row;
}

export async function storeCredential(db: TenantDb, ctx: OrgContext, integrationId: string, name: string, secret: string, rotationDays = 90) {
  assertPermission(ctx, "integrations:write");
  const existing = await db.credential.findUnique({ where: { integrationId_name: { integrationId, name } } });
  if (existing) {
    const row = await db.credential.update({ where: { id: existing.id }, data: { secretEnc: encryptSecret(secret, `credential:${existing.id}:${name}`), version: { increment: 1 }, rotatedAt: new Date(), rotationDueAt: new Date(Date.now() + rotationDays * 86400_000), revokedAt: null } });
    await appendEvidence(db, ctx, { type: "credential.rotated", subjectType: "integration", subjectId: integrationId, payload: { name, version: row.version } });
    return row;
  }
  // Two-step create so the ciphertext can be bound to the row id.
  const created = await db.credential.create({ data: { orgId: ctx.orgId, integrationId, name, secretEnc: "pending", rotationDueAt: new Date(Date.now() + rotationDays * 86400_000), createdBy: ctx.actor.id } });
  const row = await db.credential.update({ where: { id: created.id }, data: { secretEnc: encryptSecret(secret, `credential:${created.id}:${name}`) } });
  await appendEvidence(db, ctx, { type: "credential.stored", subjectType: "integration", subjectId: integrationId, payload: { name } });
  return row;
}

/** Rotation generates a fresh secret for simulated systems; real systems supply theirs through storeCredential. */
export async function rotateCredential(db: TenantDb, ctx: OrgContext, credentialId: string) {
  assertPermission(ctx, "integrations:write");
  const c = await db.credential.findUnique({ where: { id: credentialId } });
  if (!c) throw notFound("Credential");
  const secret = `sim-token-${randomToken(16)}`;
  return storeCredential(db, ctx, c.integrationId, c.name, secret);
}

/** Emergency control: a revoked credential makes downstream execution fail closed. */
export async function revokeCredential(db: TenantDb, ctx: OrgContext, credentialId: string, reason: string) {
  assertPermission(ctx, "agents:control");
  const c = await db.credential.update({ where: { id: credentialId }, data: { revokedAt: new Date() } });
  await appendEvidence(db, ctx, { type: "credential.revoked", subjectType: "integration", subjectId: c.integrationId, payload: { name: c.name, reason } });
  return c;
}

export async function readCredentialForExecution(db: TenantDb, integrationId: string, name: string): Promise<string | null> {
  const c = await db.credential.findUnique({ where: { integrationId_name: { integrationId, name } } });
  if (!c || c.revokedAt) return null;
  return decryptSecret(c.secretEnc, `credential:${c.id}:${c.name}`);
}

// ---------- Webhook verification ----------

const REPLAY_WINDOW_MS = 5 * 60_000;

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type WebhookCheck = { ok: true } | { ok: false; reason: "missing_headers" | "stale_timestamp" | "bad_signature" | "unknown_integration" };

/** Verifies X-Aegis-Timestamp and X-Aegis-Signature (hex HMAC-SHA256 over "timestamp.body"). */
export async function verifyWebhook(db: TenantDb, integrationKey: string, headers: { timestamp?: string; signature?: string }, rawBody: string, now = Date.now()): Promise<WebhookCheck> {
  const integ = await db.integration.findFirst({ where: { key: integrationKey } });
  if (!integ || !integ.webhookSecretEnc) return { ok: false, reason: "unknown_integration" };
  if (!headers.timestamp || !headers.signature) return { ok: false, reason: "missing_headers" };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > REPLAY_WINDOW_MS) return { ok: false, reason: "stale_timestamp" };
  const secret = decryptSecret(integ.webhookSecretEnc, `integration:${integ.key}`);
  const expected = signWebhook(secret, headers.timestamp, rawBody);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(headers.signature.replace(/^sha256=/, ""), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}

export async function webhookSecretFor(db: TenantDb, ctx: OrgContext, integrationId: string): Promise<string> {
  assertPermission(ctx, "integrations:write");
  const integ = await db.integration.findUnique({ where: { id: integrationId } });
  if (!integ?.webhookSecretEnc) throw notFound("Integration");
  await appendEvidence(db, ctx, { type: "integration.webhook_secret_viewed", subjectType: "integration", subjectId: integrationId, payload: {} });
  return decryptSecret(integ.webhookSecretEnc, `integration:${integ.key}`);
}

export async function recordIntegrationHealth(db: TenantDb, integrationId: string, ok: boolean) {
  await db.integration.update({ where: { id: integrationId }, data: { lastHealthAt: new Date(), lastHealthOk: ok } });
}

export type { Prisma };
