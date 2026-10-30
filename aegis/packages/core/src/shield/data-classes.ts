import type { DataClass, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { conflict, notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { compileCustomPattern, DETECTOR_KEYS, type DataAction, type DataClassSpec } from "./detectors.js";

/**
 * Data classes: what Shield looks for in tool parameters and what it does when it finds it.
 * System classes are seeded per organization and can be tuned (action, severity, enabled) but not
 * deleted. Custom classes carry a customer supplied regular expression that is compiled defensively.
 */

export const DATA_ACTIONS = ["allow", "mask", "redact", "block", "require_approval"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export interface DefaultDataClass {
  key: string;
  name: string;
  description: string;
  detector: string;
  action: DataAction;
  severity: (typeof SEVERITIES)[number];
}

export const DEFAULT_DATA_CLASSES: DefaultDataClass[] = [
  { key: "email", name: "Email address", description: "Personal or business email addresses. Masked in free text; addressing fields are governed by destination rules.", detector: "email", action: "mask", severity: "low" },
  { key: "phone", name: "Phone number", description: "International and UAE local phone numbers.", detector: "phone", action: "mask", severity: "low" },
  { key: "iban", name: "IBAN", description: "International bank account numbers with a valid mod-97 checksum.", detector: "iban", action: "block", severity: "high" },
  { key: "card_number", name: "Payment card number", description: "13 to 19 digit card numbers with a valid Luhn checksum.", detector: "card_number", action: "block", severity: "high" },
  { key: "emirates_id", name: "Emirates ID", description: "UAE national identity numbers (784-YYYY-NNNNNNN-N).", detector: "emirates_id", action: "block", severity: "high" },
  { key: "api_key", name: "API key or access token", description: "Known key prefixes (aegis_ak_, sk-, AKIA, ghp_, xoxb-, AIza) and generic high-entropy tokens.", detector: "api_key", action: "block", severity: "critical" },
  { key: "jwt", name: "JSON Web Token", description: "Signed tokens in three base64url segments.", detector: "jwt", action: "block", severity: "critical" },
  { key: "private_key", name: "Private key", description: "PEM encoded private key material.", detector: "private_key", action: "block", severity: "critical" },
  { key: "password_assignment", name: "Password in text", description: "password=... or secret: ... assignments embedded in text.", detector: "password_assignment", action: "redact", severity: "high" },
  { key: "ip_address", name: "IP address", description: "IPv4 and IPv6 addresses. Recorded for policies, not rewritten.", detector: "ip_address", action: "allow", severity: "low" },
  { key: "url", name: "URL", description: "Web addresses. Recorded so policies and destination rules can reason about them.", detector: "url", action: "allow", severity: "low" },
];

// ---------- cache used by the inspector ----------

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; classes: DataClassSpec[] }>();

export function invalidateDataClassCache(orgId?: string) {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

/** Enabled classes for an org, cached in-process for 30 seconds. Writes through this module invalidate it. */
export async function loadEnabledDataClasses(db: TenantDb, orgId: string, now = Date.now()): Promise<DataClassSpec[]> {
  const hit = cache.get(orgId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.classes;
  const rows = await db.dataClass.findMany({ where: { orgId, enabled: true }, orderBy: { key: "asc" } });
  const classes = rows.map(toSpec);
  cache.set(orgId, { at: now, classes });
  return classes;
}

export function toSpec(row: DataClass): DataClassSpec {
  return { key: row.key, detector: row.detector, pattern: row.pattern, action: row.action as DataAction, severity: row.severity, enabled: row.enabled };
}

// ---------- seeding ----------

/**
 * Idempotent: creates missing system classes, refreshes name, description and detector of existing
 * ones, and never touches customer tuned action, severity or enabled flags.
 */
export async function ensureDefaultDataClasses(db: TenantDb, ctx: OrgContext): Promise<{ created: string[]; all: DataClass[] }> {
  const created: string[] = [];
  const now = ctx.now ?? new Date();
  for (const d of DEFAULT_DATA_CLASSES) {
    const existing = await db.dataClass.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: d.key } } });
    if (existing) {
      if (existing.name !== d.name || existing.description !== d.description || existing.detector !== d.detector || !existing.isSystem) {
        await db.dataClass.update({ where: { id: existing.id }, data: { name: d.name, description: d.description, detector: d.detector, isSystem: true } });
      }
      continue;
    }
    await db.dataClass.create({ data: { orgId: ctx.orgId, key: d.key, name: d.name, description: d.description, detector: d.detector, action: d.action, severity: d.severity, enabled: true, isSystem: true, createdAt: now, updatedAt: now } });
    created.push(d.key);
  }
  if (created.length > 0) {
    await appendEvidence(db, ctx, { type: "shield.data_classes_seeded", subjectType: "organization", subjectId: ctx.orgId, payload: { created } });
  }
  invalidateDataClassCache(ctx.orgId);
  const all = await db.dataClass.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ isSystem: "desc" }, { key: "asc" }] });
  return { created, all };
}

// ---------- CRUD ----------

export async function listDataClasses(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "security:read");
  const rows = await db.dataClass.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ isSystem: "desc" }, { severity: "asc" }, { key: "asc" }] });
  return rows.map((r) => ({ ...r, patternValid: r.detector === "custom_regex" ? isValidPattern(r.pattern) : true }));
}

function isValidPattern(p: string | null): boolean {
  if (!p) return false;
  try {
    compileCustomPattern(p);
    return true;
  } catch {
    return false;
  }
}

export const dataClassKeySchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z][a-z0-9_-]*$/, "lowercase letters, digits, underscore and hyphen");

export const updateDataClassSchema = z
  .object({
    name: z.string().min(2).max(80).optional(),
    description: z.string().max(500).optional(),
    action: z.enum(DATA_ACTIONS).optional(),
    severity: z.enum(SEVERITIES).optional(),
    enabled: z.boolean().optional(),
    pattern: z.string().min(1).max(500).optional(),
  })
  .strict();
export type UpdateDataClassInput = z.infer<typeof updateDataClassSchema>;

export async function updateDataClass(db: TenantDb, ctx: OrgContext, id: string, patch: UpdateDataClassInput) {
  assertPermission(ctx, "security:write");
  const row = await db.dataClass.findUnique({ where: { id } });
  if (!row || row.orgId !== ctx.orgId) throw notFound("Data class");
  if (patch.pattern !== undefined) {
    if (row.detector !== "custom_regex") throw validation("Only custom classes have a pattern");
    try {
      compileCustomPattern(patch.pattern);
    } catch (e) {
      throw validation(`Pattern rejected: ${e instanceof Error ? e.message : "invalid"}`);
    }
  }
  const changed = (Object.keys(patch) as (keyof UpdateDataClassInput)[]).filter((k) => patch[k] !== undefined && patch[k] !== (row as unknown as Record<string, unknown>)[k]);
  if (changed.length === 0) return row;
  const updated = await db.dataClass.update({ where: { id }, data: { ...patch, updatedAt: ctx.now ?? new Date() } });
  await appendEvidence(db, ctx, {
    type: "shield.data_class_updated",
    subjectType: "data_class",
    subjectId: id,
    payload: { key: row.key, fields: changed, before: pickFields(row, changed), after: pickFields(updated, changed) },
  });
  invalidateDataClassCache(ctx.orgId);
  return updated;
}

function pickFields(row: DataClass, fields: (keyof UpdateDataClassInput)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = (row as unknown as Record<string, unknown>)[f];
  return out;
}

export const createDataClassSchema = z
  .object({
    key: dataClassKeySchema,
    name: z.string().min(2).max(80),
    description: z.string().max(500).default(""),
    pattern: z.string().min(1).max(500),
    action: z.enum(DATA_ACTIONS).default("mask"),
    severity: z.enum(SEVERITIES).default("medium"),
    enabled: z.boolean().default(true),
  })
  .strict();
export type CreateDataClassInput = z.infer<typeof createDataClassSchema>;

export async function createCustomDataClass(db: TenantDb, ctx: OrgContext, input: CreateDataClassInput) {
  assertPermission(ctx, "security:write");
  try {
    compileCustomPattern(input.pattern);
  } catch (e) {
    throw validation(`Pattern rejected: ${e instanceof Error ? e.message : "invalid"}`);
  }
  if ((DETECTOR_KEYS as readonly string[]).includes(input.key) || DEFAULT_DATA_CLASSES.some((d) => d.key === input.key)) throw validation("Key is reserved for a system class");
  const existing = await db.dataClass.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.key } } });
  if (existing) throw conflict(`Data class ${input.key} already exists`);
  const now = ctx.now ?? new Date();
  const row = await db.dataClass.create({ data: { orgId: ctx.orgId, key: input.key, name: input.name.trim(), description: input.description, detector: "custom_regex", pattern: input.pattern, action: input.action, severity: input.severity, enabled: input.enabled, isSystem: false, createdAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "shield.data_class_created", subjectType: "data_class", subjectId: row.id, payload: { key: row.key, action: row.action, severity: row.severity, patternLength: input.pattern.length } });
  invalidateDataClassCache(ctx.orgId);
  return row;
}

export async function deleteDataClass(db: TenantDb, ctx: OrgContext, id: string) {
  assertPermission(ctx, "security:write");
  const row = await db.dataClass.findUnique({ where: { id } });
  if (!row || row.orgId !== ctx.orgId) throw notFound("Data class");
  if (row.isSystem) throw validation("System classes cannot be deleted. Disable the class instead.");
  await db.dataClass.delete({ where: { id } });
  await appendEvidence(db, ctx, { type: "shield.data_class_deleted", subjectType: "data_class", subjectId: id, payload: { key: row.key } });
  invalidateDataClassCache(ctx.orgId);
  return { id, key: row.key } as { id: string; key: string } & Partial<Prisma.DataClassGetPayload<object>>;
}
