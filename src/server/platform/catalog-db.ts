// Platform catalog database access.
//
// This is the "platform admin" exception to CLAUDE.md hard rule 2 (never use a raw Prisma client in
// request code). Global catalog rows (orgId null) in University, UniversityProgram, RequirementSource,
// RequirementExtraction, ProgramRequirement and its child tables and RequirementChange can only be
// written by the owner role: the app role is limited by RLS to its own organization's rows. Pipeline
// writes to the global catalog therefore go through this client, which connects with
// PLATFORM_DATABASE_URL (falling back to MIGRATION_DATABASE_URL).
//
// Rules for using it:
// - Reads for pages always go through ctx.db (tenantDb). Only writes to global catalog rows use this.
// - Every request-path write first calls assertCatalogWrite(actor): the member needs catalog.review
//   AND the organization must be the demo school, or the member's email must be listed in
//   PLATFORM_ADMIN_EMAILS (comma separated).
// - Every publish writes an AuditEvent in the actor's own organization through tenantDb.
// - Never read or write school (tenant) data through this client, except in the platform notification
//   fan-out, which only counts affected students per organization and then writes through tenantTx.
// No "server-only" marker: the worker imports it too.
import { PrismaClient } from "@prisma/client";

export type CatalogDb = PrismaClient;

export function catalogDbUrl(): string | null {
  return process.env.PLATFORM_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || null;
}

/** True when an owner connection is configured, so global catalog rows can be written. */
export function catalogWritable(): boolean {
  return catalogDbUrl() !== null;
}

const g = globalThis as unknown as { __catalogDb?: PrismaClient; __catalogDbUrl?: string };

/** Lazily created owner client for global catalog writes, or null when no owner URL is configured. */
export function catalogDb(): CatalogDb | null {
  const url = catalogDbUrl();
  if (!url) return null;
  if (!g.__catalogDb || g.__catalogDbUrl !== url) {
    g.__catalogDb = new PrismaClient({ datasourceUrl: url });
    g.__catalogDbUrl = url;
  }
  return g.__catalogDb;
}

export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Demo personas use reserved domains (horizon.example) and their sign-in is public, so in production an
// address on a reserved domain is never a platform admin, even if it is listed by mistake.
const RESERVED_DOMAIN = /\.(example|test|invalid|localhost)$/i;

export function isPlatformAdminEmail(email: string | null | undefined, env: string | undefined = process.env.NODE_ENV): boolean {
  const e = email?.trim().toLowerCase();
  if (!e || !platformAdminEmails().includes(e)) return false;
  return !(env === "production" && RESERVED_DOMAIN.test(e.split("@")[1] ?? ""));
}

/** Who is asking to write global catalog rows. Built from the request context. */
export type CatalogActor = {
  orgId: string;
  orgIsDemo: boolean;
  email: string | null;
  canReview: boolean;
  membershipId: string | null;
  userId: string | null;
};

export type CatalogDenial = "forbidden" | "not_platform_reviewer" | "no_owner_url";

/** Why this actor may not write global catalog rows, or null when they may. */
export function catalogWriteDenial(actor: CatalogActor, opts: { writable?: boolean } = {}): CatalogDenial | null {
  if (!actor.canReview) return "forbidden";
  const email = actor.email?.trim().toLowerCase() ?? "";
  if (!actor.orgIsDemo && !(email && platformAdminEmails().includes(email))) return "not_platform_reviewer";
  if (!(opts.writable ?? catalogWritable())) return "no_owner_url";
  return null;
}

export class CatalogAccessError extends Error {
  constructor(public code: CatalogDenial) {
    super(`catalog:${code}`);
  }
}

/** Throws CatalogAccessError unless the actor may write global catalog rows. */
export function assertCatalogWrite(actor: CatalogActor, opts: { writable?: boolean } = {}) {
  const denial = catalogWriteDenial(actor, opts);
  if (denial) throw new CatalogAccessError(denial);
}
