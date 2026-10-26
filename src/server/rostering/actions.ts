"use server";

// Rostering page actions (roster.manage): connections, a connection test that lists the feed's schools, preview,
// apply, and OneRoster CSV uploads. Thin wrappers: check the permission, validate, call the services (which
// audit), refresh the page. Credentials are write-only: the page never receives them back.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { opensSensitiveRecords, audienceOfRole } from "@/server/access/permission-catalog";
import { DEFAULT_OPTIONS, STAFF_FEED_ROLES, normalizeGradeCode, readOptions } from "@/lib/rostering/options";
import { MIN_GRADE_LEVEL, MAX_GRADE_LEVEL } from "@/lib/grade-levels";
import { AUTH_MODES, MAX_CONNECTIONS, authFor, cleanBaseUrl, encryptCredentials, fetchPage, isRosterProvider, ConnectionError, type AuthMode } from "./connections";
import { RosterFetchError, START_CURSOR } from "./client";
import { applyRun, createRun, stageRecords, RosterRunError } from "./run";
import { startRosterRun } from "./jobs";
import { CsvRosterError, MAX_ZIP_BYTES, parseOneRosterZip } from "./csv";
import { isDemoFeed } from "./demo-feed";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const PAGE = "/[locale]/admin/rostering";

async function manager() {
  const ctx = await getCtx();
  return ctx.can("roster.manage") ? ctx : null;
}

const connectionSchema = z.object({
  id: z.string().max(40).optional(),
  provider: z.string(),
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().max(500),
  authMode: z.string(),
  tokenUrl: z.string().trim().max(500),
  key: z.string().max(500),
  secret: z.string().max(2000),
  token: z.string().max(4000),
  schoolIds: z.array(z.string().trim().min(1).max(200)).max(50),
  schedule: z.enum(["OFF", "DAILY", "HOURLY"]),
  hour: z.number().int().min(0).max(23),
  enabled: z.boolean(),
  options: z.object({
    importStaff: z.boolean(),
    importStudents: z.boolean(),
    importGuardians: z.boolean(),
    importClasses: z.boolean(),
    importDemographics: z.boolean(),
    gradeMap: z.record(z.string().max(12), z.number().int().nullable()),
    roleMap: z.record(z.string().max(20), z.string().max(40).nullable()),
    removalLimitPercent: z.number().int().min(1).max(100),
  }),
});
export type ConnectionInput = z.input<typeof connectionSchema>;

export async function saveConnectionAction(raw: ConnectionInput): Promise<{ ok: true; id: string } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = connectionSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID");
  const d = parsed.data;
  if (!isRosterProvider(d.provider)) return fail("INVALID");
  if (!(AUTH_MODES as readonly string[]).includes(d.authMode)) return fail("INVALID");
  const mode = d.authMode as AuthMode;
  if (d.provider === "clever" && mode !== "BEARER") return fail("CLEVER_TOKEN");
  // The demo school keeps its built-in feed address (demo://); real schools need https.
  const baseUrl = d.baseUrl ? (ctx.org.isDemo && isDemoFeed(d.baseUrl) ? d.baseUrl.trim() : cleanBaseUrl(d.baseUrl)) : null;
  if (d.provider !== "clever" && !baseUrl) return fail("URL");
  if (d.baseUrl && !baseUrl) return fail("URL");
  const tokenUrl = mode === "OAUTH2" ? cleanBaseUrl(d.tokenUrl) : null;
  if (mode === "OAUTH2" && !tokenUrl) return fail("TOKEN_URL");
  // Horizon roles new staff may get: staff roles that open no sensitive records.
  const roles = await ctx.db.role.findMany({ select: { key: true, permissions: true } });
  for (const r of STAFF_FEED_ROLES) {
    const key = d.options.roleMap[r];
    if (!key) continue;
    const role = roles.find((x) => x.key === key);
    if (!role || audienceOfRole(key) !== "staff" || opensSensitiveRecords(role.permissions) || key === "school_admin") return fail("ROLE");
  }
  for (const [code, level] of Object.entries(d.options.gradeMap)) {
    if (!normalizeGradeCode(code)) return fail("GRADE");
    if (level !== null && (level < MIN_GRADE_LEVEL || level > MAX_GRADE_LEVEL)) return fail("GRADE");
  }
  const existing = d.id ? await ctx.db.rosterConnection.findUnique({ where: { id: d.id } }) : null;
  if (d.id && !existing) return fail("NOT_FOUND");
  if (!existing && (await ctx.db.rosterConnection.count()) >= MAX_CONNECTIONS) return fail("TOO_MANY");
  const fresh = encryptCredentials(mode, { key: d.key.trim(), secret: d.secret, token: d.token.trim() });
  const credentialsEnc = fresh ?? (existing && existing.authMode === mode ? existing.credentialsEnc : null);
  if (!credentialsEnc) return fail("CREDENTIALS");
  const options = readOptions(d.options);
  const data = {
    provider: d.provider,
    name: d.name,
    baseUrl,
    authMode: mode,
    tokenUrl,
    credentialsEnc,
    schoolIds: [...new Set(d.schoolIds)],
    schedule: d.schedule,
    hour: d.hour,
    enabled: d.enabled,
    options: options as unknown as Prisma.InputJsonValue,
  };
  const row = existing ? await ctx.db.rosterConnection.update({ where: { id: existing.id }, data }) : await ctx.db.rosterConnection.create({ data: { orgId: ctx.orgId, createdById: ctx.membershipId, ...data } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: existing ? "roster.connection_updated" : "roster.connection_created", entityType: "RosterConnection", entityId: row.id, meta: { provider: d.provider, authMode: mode, schedule: d.schedule, credentialsChanged: !!fresh, schools: data.schoolIds.length } });
  revalidatePath(PAGE, "page");
  return { ok: true, id: row.id };
}

export async function deleteConnectionAction(id: string): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const row = await ctx.db.rosterConnection.findUnique({ where: { id: String(id) } });
  if (!row) return fail("NOT_FOUND");
  // Links stay so the records the feed created keep their history; runs keep their log.
  await ctx.db.rosterConnection.delete({ where: { id: row.id } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "roster.connection_deleted", entityType: "RosterConnection", entityId: row.id, meta: { provider: row.provider } });
  revalidatePath(PAGE, "page");
  return { ok: true };
}

/** Reads the first page of schools to prove the address and credentials work, and to pick schools. */
export async function testConnectionAction(id: string): Promise<{ ok: true; schools: Array<{ id: string; name: string }> } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const conn = await ctx.db.rosterConnection.findUnique({ where: { id: String(id) } });
  if (!conn) return fail("NOT_FOUND");
  try {
    authFor(conn);
    const page = await fetchPage(conn, START_CURSOR, null);
    const schools = page.records.filter((r) => r.kind === "org").map((r) => ({ id: r.externalId, name: (r.data as { name: string }).name }));
    return { ok: true, schools: schools.slice(0, 50) };
  } catch (e) {
    if (e instanceof RosterFetchError) return fail(`FETCH_${e.code}`);
    if (e instanceof ConnectionError) return fail(`CONNECTION_${e.code}`);
    return fail("FETCH_HTTP");
  }
}

export async function startPreviewAction(input: { connectionId: string; mode: "FULL" | "DELTA" }): Promise<{ ok: true; runId: string } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const conn = await ctx.db.rosterConnection.findUnique({ where: { id: String(input.connectionId) } });
  if (!conn) return fail("NOT_FOUND");
  const busy = await ctx.db.rosterRun.count({ where: { connectionId: conn.id, status: { in: ["QUEUED", "FETCHING", "PLANNING", "APPLYING"] } } });
  if (busy) return fail("BUSY");
  const run = await createRun({ orgId: ctx.orgId, connectionId: conn.id, provider: conn.provider, source: "API", trigger: "MANUAL", mode: input.mode === "DELTA" && conn.lastDeltaAt && conn.provider !== "clever" ? "DELTA" : "FULL", dryRun: true, actorId: ctx.membershipId });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "roster.preview_started", entityType: "RosterRun", entityId: run.id, meta: { provider: conn.provider, mode: run.mode } });
  await startRosterRun(ctx.orgId, run.id);
  revalidatePath(PAGE, "page");
  return { ok: true, runId: run.id };
}

export async function applyRunAction(input: { runId: string; allowMassDelete: boolean }): Promise<{ ok: true } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  try {
    await applyRun(ctx.orgId, String(input.runId), { actorId: ctx.membershipId, allowMassDelete: !!input.allowMassDelete });
  } catch (e) {
    if (e instanceof RosterRunError) return fail(e.code);
    throw e;
  }
  await startRosterRun(ctx.orgId, String(input.runId));
  revalidatePath(PAGE, "page");
  return { ok: true };
}

/** A OneRoster CSV zip: staged and previewed like a feed. The upload can belong to a connection (same ids). */
export async function uploadOneRosterAction(form: FormData): Promise<{ ok: true; runId: string } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("FILE");
  if (file.size > MAX_ZIP_BYTES) return fail("TOO_LARGE");
  const connectionId = String(form.get("connectionId") ?? "") || null;
  const conn = connectionId ? await ctx.db.rosterConnection.findUnique({ where: { id: connectionId } }) : null;
  if (connectionId && !conn) return fail("NOT_FOUND");
  let parsed;
  try {
    parsed = parseOneRosterZip(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return fail(e instanceof CsvRosterError ? `CSV_${e.code}` : "CSV_UNREADABLE");
  }
  const run = await createRun({ orgId: ctx.orgId, connectionId: conn?.id ?? null, provider: conn?.provider ?? "oneroster", source: "CSV", trigger: "UPLOAD", mode: parsed.mode, dryRun: true, actorId: ctx.membershipId });
  await stageRecords(ctx.orgId, run.id, parsed.records);
  const options = conn ? readOptions(conn.options) : { ...DEFAULT_OPTIONS };
  await ctx.db.rosterRun.update({ where: { id: run.id }, data: { cursor: { fetchDone: true, staged: parsed.records.length, options } as unknown as Prisma.InputJsonValue } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "roster.csv_uploaded", entityType: "RosterRun", entityId: run.id, meta: { files: parsed.files, records: parsed.records.length, mode: parsed.mode } });
  await startRosterRun(ctx.orgId, run.id);
  revalidatePath(PAGE, "page");
  return { ok: true, runId: run.id };
}

/** Progress of a run, for the page while it works. Counts and status only. */
export async function runProgressAction(runId: string): Promise<{ ok: true; status: string; done: number; total: number; phase: string | null } | Fail> {
  const ctx = await manager();
  if (!ctx) return fail("FORBIDDEN");
  const r = await ctx.db.rosterRun.findUnique({ where: { id: String(runId) }, select: { status: true, progressDone: true, progressTotal: true, phase: true } });
  if (!r) return fail("NOT_FOUND");
  return { ok: true, status: r.status, done: r.progressDone, total: r.progressTotal, phase: r.phase };
}

