"use server";

// Integrations page actions: API keys and sync sources. Thin wrappers: check integrations.manage, validate,
// call the services (which audit), refresh the page. Errors come back as codes the page translates.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/server/context";
import { queue } from "@/server/queue";
import { suggestMapping, cleanMapping, missingAfterMapping } from "@/lib/integrations/mapping";
import { isSyncSchedule } from "@/lib/integrations/schedule";
import { audit } from "@/server/audit/audit";
import { createApiKey, KeyError, revokeApiKey } from "./keys";
import { checkSourceUrl, fetchExport, FetchExportError, type SyncAuth } from "./fetch-export";
import { decryptAuth, encryptAuth, headersFromFile, isSyncKind, MAX_SOURCES, runSync, SYNC_COLUMNS, SyncError, type SyncKind } from "./sync";

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const PAGE = "/[locale]/admin/integrations";

async function admin() {
  const ctx = await getCtx();
  if (!ctx.can("integrations.manage")) return null;
  return ctx;
}

export async function createApiKeyAction(input: { label: string; scopes: string[] }): Promise<{ ok: true; key: string; prefix: string } | Fail> {
  const ctx = await admin();
  if (!ctx) return fail("FORBIDDEN");
  try {
    const res = await createApiKey({ orgId: ctx.orgId, membershipId: ctx.membershipId, userId: ctx.user.id }, input);
    revalidatePath(PAGE, "page");
    return { ok: true, key: res.key, prefix: res.prefix };
  } catch (e) {
    if (e instanceof KeyError) return fail(e.code);
    throw e;
  }
}

export async function revokeApiKeyAction(id: string): Promise<{ ok: true } | Fail> {
  const ctx = await admin();
  if (!ctx) return fail("FORBIDDEN");
  try {
    await revokeApiKey({ orgId: ctx.orgId, membershipId: ctx.membershipId, userId: ctx.user.id }, String(id));
    revalidatePath(PAGE, "page");
    return { ok: true };
  } catch (e) {
    if (e instanceof KeyError) return fail(e.code);
    throw e;
  }
}

const credentials = z.object({
  authType: z.enum(["NONE", "BASIC", "BEARER"]),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  token: z.string().max(4000).optional(),
});

const sourceSchema = credentials.extend({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.string(),
  url: z.string().trim().min(1).max(2000),
  mapping: z.record(z.string().max(200), z.string().max(60)).optional(),
  schedule: z.string(),
  hour: z.number().int().min(0).max(23),
  enabled: z.boolean(),
});

/** Credentials from the form, or null when the form left them blank (keep the saved ones). */
function authFrom(input: z.infer<typeof credentials>): SyncAuth | null | "INVALID" {
  if (input.authType === "NONE") return { type: "NONE" };
  if (input.authType === "BASIC") {
    if (!input.username && !input.password) return null;
    return input.username && input.password ? { type: "BASIC", username: input.username, password: input.password } : "INVALID";
  }
  return input.token ? { type: "BEARER", token: input.token.trim() } : null;
}

export async function saveSyncSourceAction(raw: unknown): Promise<{ ok: true; id: string } | Fail> {
  const ctx = await admin();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = sourceSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID");
  const input = parsed.data;
  if (!isSyncKind(input.kind) || !isSyncSchedule(input.schedule)) return fail("INVALID");
  if (checkSourceUrl(input.url)) return fail("URL");
  const auth = authFrom(input);
  if (auth === "INVALID") return fail("CREDENTIALS");
  const { db } = ctx;
  const existing = input.id ? await db.syncSource.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !existing) return fail("NOT_FOUND");
  if (!existing && (await db.syncSource.count()) >= MAX_SOURCES) return fail("TOO_MANY");
  // New credentials, or keep the saved ones when the type is unchanged and the fields were left blank.
  let secretEnc: string | null;
  try {
    if (auth) secretEnc = encryptAuth(auth);
    else if (existing && existing.authType === input.authType) secretEnc = existing.secretEnc;
    else return fail("CREDENTIALS");
  } catch {
    return fail("NO_ENCRYPTION_KEY");
  }
  const data = {
    name: input.name,
    kind: input.kind,
    url: input.url,
    authType: input.authType,
    secretEnc,
    mapping: cleanMapping(input.mapping ?? {}, SYNC_COLUMNS[input.kind]),
    schedule: input.schedule,
    hour: input.hour,
    enabled: input.enabled,
  };
  const row = existing
    ? await db.syncSource.update({ where: { id: existing.id }, data })
    : await db.syncSource.create({ data: { ...data, orgId: ctx.orgId, createdById: ctx.membershipId } });
  await audit(db, ctx.orgId, {
    actorId: ctx.membershipId,
    actorUserId: ctx.user.id,
    action: existing ? "integrations.sync_source_updated" : "integrations.sync_source_created",
    entityType: "SyncSource",
    entityId: row.id,
    meta: { name: row.name, kind: row.kind, host: new URL(row.url).host, authType: row.authType, schedule: row.schedule, enabled: row.enabled, mappedColumns: Object.keys(data.mapping).length, credentialsChanged: !!auth && auth.type !== "NONE" },
  });
  revalidatePath(PAGE, "page");
  return { ok: true, id: row.id };
}

export async function deleteSyncSourceAction(id: string): Promise<{ ok: true } | Fail> {
  const ctx = await admin();
  if (!ctx) return fail("FORBIDDEN");
  const row = await ctx.db.syncSource.findUnique({ where: { id: String(id) }, select: { id: true, name: true, kind: true } });
  if (!row) return fail("NOT_FOUND");
  await ctx.db.syncSource.delete({ where: { id: row.id } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "integrations.sync_source_deleted", entityType: "SyncSource", entityId: row.id, meta: { name: row.name, kind: row.kind } });
  revalidatePath(PAGE, "page");
  return { ok: true };
}

/** Starts a run now: queued for the worker, or run here when no queue is configured. */
export async function runSyncNowAction(id: string): Promise<{ ok: true; status: string } | Fail> {
  const ctx = await admin();
  if (!ctx) return fail("FORBIDDEN");
  const source = await ctx.db.syncSource.findUnique({ where: { id: String(id) }, select: { id: true } });
  if (!source) return fail("NOT_FOUND");
  const running = await ctx.db.syncRun.count({ where: { sourceId: source.id, status: { in: ["QUEUED", "RUNNING"] }, startedAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
  if (running) return fail("ALREADY_RUNNING");
  const slot = `m:${new Date().toISOString()}`;
  const run = await ctx.db.syncRun.create({ data: { orgId: ctx.orgId, sourceId: source.id, slot, trigger: "MANUAL", status: "QUEUED", actorId: ctx.membershipId } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "integrations.sync_run_requested", entityType: "SyncSource", entityId: source.id, meta: { runId: run.id } });
  const q = queue("integrations");
  let queued = false;
  if (q) {
    try {
      await q.add("sync", { orgId: ctx.orgId, sourceId: source.id, slot }, { jobId: `sync:${run.id}`, attempts: 1 });
      queued = true;
    } catch {
      queued = false;
    }
  }
  if (!queued) await runSync(ctx.orgId, source.id, { slot, trigger: "MANUAL", actorId: ctx.membershipId });
  revalidatePath(PAGE, "page");
  return { ok: true, status: queued ? "QUEUED" : "DONE" };
}

/** Fetches the source file and returns its header row with suggested columns. Header names only. */
export async function previewHeadersAction(raw: unknown): Promise<{ ok: true; headers: Array<{ header: string; key: string | null }>; missing: string[] } | Fail> {
  const ctx = await admin();
  if (!ctx) return fail("FORBIDDEN");
  const parsed = credentials.extend({ id: z.string().max(40).optional(), kind: z.string(), url: z.string().trim().min(1).max(2000), mapping: z.record(z.string().max(200), z.string().max(60)).optional() }).safeParse(raw);
  if (!parsed.success || !isSyncKind(parsed.data.kind)) return fail("INVALID");
  const input = parsed.data;
  const kind = parsed.data.kind as SyncKind;
  if (checkSourceUrl(input.url)) return fail("URL");
  let auth = authFrom(input);
  if (auth === "INVALID") return fail("CREDENTIALS");
  if (!auth) {
    const existing = input.id ? await ctx.db.syncSource.findUnique({ where: { id: input.id }, select: { authType: true, secretEnc: true } }) : null;
    if (!existing || existing.authType !== input.authType) return fail("CREDENTIALS");
    try {
      auth = decryptAuth(existing.authType, existing.secretEnc);
    } catch {
      return fail("CREDENTIALS");
    }
  }
  try {
    const file = await fetchExport(input.url, auth, { timeoutMs: 20_000 });
    const headers = headersFromFile(file.buf);
    const columns = SYNC_COLUMNS[kind];
    return { ok: true, headers: suggestMapping(headers, columns), missing: missingAfterMapping(headers, cleanMapping(input.mapping ?? {}, columns), columns) };
  } catch (e) {
    if (e instanceof FetchExportError) return fail(`FETCH_${e.code}`);
    if (e instanceof SyncError) return fail(e.code);
    throw e;
  }
}
