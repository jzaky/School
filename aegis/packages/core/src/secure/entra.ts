import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Integration, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { env } from "../env.js";
import { appendEvidence } from "../evidence/ledger.js";
import { encryptSecret, randomToken } from "../lib/crypto.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { m } from "../lib/metrics.js";
import { assertPermission } from "../orgs/orgs.js";
import { pinnedLookup } from "../integrations/destinations.js";
import { readCredentialForExecution, storeCredential } from "../integrations/service.js";
import { ingestObservations, type RawObservation } from "./shadow-ai.js";

/**
 * Microsoft Entra ID connector (docs/ENTRA_CONNECTOR.md).
 *
 * Reads, with an app registration the customer creates and consents to, two Microsoft Graph feeds:
 * - sign-ins (GET /auditLogs/signIns): which work accounts signed in to which applications;
 * - application consents (GET /auditLogs/directoryAudits, "Consent to application"): who granted an app
 *   access to organizational data.
 * Both feed Shadow AI discovery, which keeps only entries that match an AI application.
 *
 * Least privilege: application permissions AuditLog.Read.All and Directory.Read.All, which Microsoft lists as
 * the least privileged for sign-ins. Nothing is written to the tenant.
 *
 * Incremental sync works in time windows: a window is read completely (every page) before the cursor moves
 * to its end, so the order Graph returns results in does not matter. A window that has more pages than one
 * run may read is halved. The newest 15 minutes are left for the next run because sign-in records can
 * arrive late; records delayed longer than that can be missed, which the status says.
 */

export const ENTRA_TYPE = "entra_id";
export const ENTRA_KEY = "microsoft-entra-id";
const SECRET_NAME = "client_secret";
const LAG_MS = 15 * 60_000;
const MAX_WINDOW_MS = 6 * 3600_000;
const MIN_WINDOW_MS = 5 * 60_000;
const MAX_PAGES_PER_WINDOW = 20;
const PAGE_SIZE = 500;

// ---------- transport ----------

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export type EntraSender = (req: { method: "GET" | "POST"; url: string; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>;

const defaultSender: EntraSender = (req) =>
  new Promise((resolve, reject) => {
    const url = new URL(req.url);
    const client = url.protocol === "https:" ? httpsRequest : httpRequest;
    const r = client(url, { method: req.method, headers: req.headers, lookup: pinnedLookup(env().AEGIS_ALLOW_PRIVATE_DESTINATIONS), timeout: 30_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(",") : String(v ?? "")])), body: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("timeout", () => r.destroy(new Error("Microsoft did not answer within 30 seconds")));
    r.on("error", reject);
    r.end(req.body);
  });

let sender: EntraSender = defaultSender;
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Tests replace the transport and the clock used for back-off. */
export function setEntraTransport(s: EntraSender | null, sleeper?: (ms: number) => Promise<void>) {
  sender = s ?? defaultSender;
  sleep = sleeper ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
}

// ---------- configuration ----------

export interface EntraSettings {
  tenantId: string;
  clientId: string;
  authorityUrl: string;
  graphUrl: string;
  backfillDays: number;
  cursorSignIns: string | null;
  cursorConsents: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastResult: { signIns: number; consents: number; matched: number; windows: number; caughtUp: boolean } | null;
}

const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "a GUID such as 00000000-0000-0000-0000-000000000000");
export const entraConnectSchema = z
  .object({
    tenantId: guid,
    clientId: guid,
    clientSecret: z.string().min(8).max(500),
    backfillDays: z.number().int().min(1).max(30).default(7),
    /** Overrides for tests and sovereign clouds; must be HTTPS outside a test environment. */
    authorityUrl: z.string().url().optional(),
    graphUrl: z.string().url().optional(),
  })
  .strict();

export function readEntraSettings(i: Pick<Integration, "settings">): EntraSettings {
  const s = (i.settings ?? {}) as Partial<EntraSettings>;
  return {
    tenantId: s.tenantId ?? "",
    clientId: s.clientId ?? "",
    authorityUrl: s.authorityUrl ?? "https://login.microsoftonline.com",
    graphUrl: s.graphUrl ?? "https://graph.microsoft.com/v1.0",
    backfillDays: s.backfillDays ?? 7,
    cursorSignIns: s.cursorSignIns ?? null,
    cursorConsents: s.cursorConsents ?? null,
    lastRunAt: s.lastRunAt ?? null,
    lastSuccessAt: s.lastSuccessAt ?? null,
    lastError: s.lastError ?? null,
    lastResult: s.lastResult ?? null,
  };
}

function checkUrl(u: string) {
  const url = new URL(u);
  if (url.protocol !== "https:" && !env().AEGIS_ALLOW_PRIVATE_DESTINATIONS) throw validation("Microsoft endpoints must use HTTPS");
  return url.toString().replace(/\/$/, "");
}

/** Stores the app registration. The client secret goes to the credential vault and is never shown again. */
export async function connectEntra(db: TenantDb, ctx: OrgContext, raw: z.input<typeof entraConnectSchema>) {
  assertPermission(ctx, "integrations:write");
  if (ctx.actor.type !== "user") throw forbidden("A person connects an identity provider");
  const input = entraConnectSchema.parse(raw);
  const settings: Partial<EntraSettings> = { tenantId: input.tenantId, clientId: input.clientId, backfillDays: input.backfillDays, ...(input.authorityUrl ? { authorityUrl: checkUrl(input.authorityUrl) } : {}), ...(input.graphUrl ? { graphUrl: checkUrl(input.graphUrl) } : {}) };
  const existing = await db.integration.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: ENTRA_KEY } } });
  const row = existing
    ? await db.integration.update({ where: { id: existing.id }, data: { status: "active", statusReason: null, settings: { ...readEntraSettings(existing), ...settings, lastError: null } as unknown as Prisma.InputJsonValue } })
    : await db.integration.create({ data: { orgId: ctx.orgId, key: ENTRA_KEY, name: "Microsoft Entra ID", type: ENTRA_TYPE, description: "Sign-ins and app consents read through Microsoft Graph for Shadow AI discovery", baseUrl: "https://graph.microsoft.com", webhookSecretEnc: encryptSecret(randomToken(24), `integration:${ENTRA_KEY}`), settings: settings as unknown as Prisma.InputJsonValue } });
  await storeCredential(db, ctx, row.id, SECRET_NAME, input.clientSecret, 180);
  await appendEvidence(db, ctx, { type: "connector.entra.connected", subjectType: "integration", subjectId: row.id, payload: { tenantId: input.tenantId, clientId: input.clientId, backfillDays: input.backfillDays } });
  return row;
}

export async function disconnectEntra(db: TenantDb, ctx: OrgContext, reason: string) {
  assertPermission(ctx, "integrations:write");
  const row = await db.integration.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: ENTRA_KEY } } });
  if (!row) throw notFound("Microsoft Entra ID connection");
  await db.integration.update({ where: { id: row.id }, data: { status: "disabled", statusReason: reason.slice(0, 300) || "Disconnected" } });
  await db.credential.updateMany({ where: { integrationId: row.id, revokedAt: null }, data: { revokedAt: ctx.now ?? new Date() } });
  await appendEvidence(db, ctx, { type: "connector.entra.disconnected", subjectType: "integration", subjectId: row.id, payload: { reason } });
}

export async function entraStatus(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "integrations:read");
  const row = await db.integration.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: ENTRA_KEY } }, include: { credentials: { select: { name: true, revokedAt: true, rotationDueAt: true } } } });
  if (!row) return null;
  const s = readEntraSettings(row);
  const cred = row.credentials.find((c) => c.name === SECRET_NAME);
  return { id: row.id, active: row.status === "active", statusReason: row.statusReason, tenantId: s.tenantId, clientId: s.clientId, backfillDays: s.backfillDays, cursorSignIns: s.cursorSignIns, cursorConsents: s.cursorConsents, lastRunAt: s.lastRunAt, lastSuccessAt: s.lastSuccessAt, lastError: s.lastError, lastResult: s.lastResult, secret: cred ? (cred.revokedAt ? "revoked" : "stored") : "missing", secretRotationDueAt: cred?.rotationDueAt ?? null };
}

// ---------- Microsoft identity platform and Graph client ----------

/** Plain-language reasons for the errors a customer can fix. */
export function explainGraphError(status: number, body: string): string {
  const code = (() => {
    try {
      const j = JSON.parse(body) as { error?: { code?: string; message?: string } | string; error_description?: string };
      return typeof j.error === "string" ? `${j.error} ${j.error_description ?? ""}` : `${j.error?.code ?? ""} ${j.error?.message ?? ""}`;
    } catch {
      return body.slice(0, 200);
    }
  })();
  if (/Authentication_RequestFromNonPremiumTenantOrB2CTenant/i.test(code)) return "Microsoft refused: this tenant's sign-in logs are not available through the API (Microsoft requires a premium Entra ID licence for this). App consents can still be read.";
  if (/invalid_client|AADSTS7000215|AADSTS7000222/i.test(code)) return "Microsoft rejected the client secret: it is wrong or has expired. Create a new secret and update the connection.";
  if (/AADSTS700016|unauthorized_client/i.test(code)) return "Microsoft does not know this application in this tenant: check the tenant ID and the application (client) ID.";
  if (/AADSTS90002|invalid_tenant/i.test(code) || (code.toLowerCase().includes("tenant") && code.toLowerCase().includes("not found"))) return "Microsoft does not know this tenant ID.";
  if (status === 403 || /Authorization_RequestDenied|Forbidden/i.test(code)) return "Microsoft refused access: grant the application permissions AuditLog.Read.All and Directory.Read.All and give admin consent.";
  if (status === 401) return "Microsoft did not accept the access token.";
  if (status === 429) return "Microsoft is throttling requests; the next run continues from where this one stopped.";
  return `Microsoft answered ${status}${code.trim() ? `: ${code.trim().slice(0, 200)}` : ""}`;
}

class GraphError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface TokenEntry {
  token: string;
  expiresAt: number;
}
const tokens = new Map<string, TokenEntry>();

/** Client credentials flow. Tokens are kept in memory only and refreshed five minutes before they expire. */
async function accessToken(s: EntraSettings, secret: string, force = false): Promise<string> {
  const key = `${s.authorityUrl}|${s.tenantId}|${s.clientId}`;
  const hit = tokens.get(key);
  if (!force && hit && hit.expiresAt - Date.now() > 5 * 60_000) return hit.token;
  const body = new URLSearchParams({ client_id: s.clientId, client_secret: secret, scope: `${new URL(s.graphUrl).origin}/.default`, grant_type: "client_credentials" }).toString();
  const res = await sender({ method: "POST", url: `${s.authorityUrl}/${encodeURIComponent(s.tenantId)}/oauth2/v2.0/token`, headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (res.status !== 200) throw new GraphError(res.status, explainGraphError(res.status, res.body));
  const j = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new GraphError(500, "Microsoft returned no access token");
  tokens.set(key, { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

/** Forget cached tokens (tests, and after a secret change). */
export function clearEntraTokens() {
  tokens.clear();
}

/** GET with retries: 429, 502, 503 and 504 honour Retry-After (capped at 60 s) or back off; a 401 refreshes the token once. */
async function graphGet(s: EntraSettings, secret: string, url: string): Promise<unknown> {
  let refreshed = false;
  for (let attempt = 1; ; attempt++) {
    const token = await accessToken(s, secret);
    let res: HttpResponse;
    try {
      res = await sender({ method: "GET", url, headers: { authorization: `Bearer ${token}`, accept: "application/json", ConsistencyLevel: "eventual" } });
    } catch (e) {
      if (attempt >= 5) throw new GraphError(0, `Microsoft could not be reached: ${e instanceof Error ? e.message : String(e)}`);
      m.connectorRetries.inc({ connector: "entra", reason: "network" });
      await sleep(Math.min(30_000, 500 * 2 ** attempt));
      continue;
    }
    if (res.status === 200) return JSON.parse(res.body);
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      await accessToken(s, secret, true);
      continue;
    }
    if ([429, 502, 503, 504].includes(res.status) && attempt < 5) {
      const ra = Number(res.headers["retry-after"]);
      m.connectorRetries.inc({ connector: "entra", reason: String(res.status) });
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(60, ra) * 1000 : Math.min(30_000, 500 * 2 ** attempt));
      continue;
    }
    throw new GraphError(res.status, explainGraphError(res.status, res.body));
  }
}

/** Every page of one query. Only follows nextLink on the Graph host it started from. */
async function allPages(s: EntraSettings, secret: string, first: string): Promise<{ items: unknown[]; complete: boolean }> {
  const origin = new URL(s.graphUrl).origin;
  const items: unknown[] = [];
  let url: string | null = first;
  for (let page = 0; url; page++) {
    if (page >= MAX_PAGES_PER_WINDOW) return { items, complete: false };
    const j = (await graphGet(s, secret, url)) as { value?: unknown[]; "@odata.nextLink"?: string };
    items.push(...(j.value ?? []));
    const next = j["@odata.nextLink"];
    if (next && new URL(next).origin !== origin) throw new GraphError(500, "Microsoft returned a next page on an unexpected host; refusing to follow it");
    url = next ?? null;
  }
  return { items, complete: true };
}

// ---------- mapping ----------

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const get = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

/** Successful sign-ins only: a failed sign-in is not use. */
export function signInsToObservations(items: unknown[]): RawObservation[] {
  const out: RawObservation[] = [];
  for (const r of items) {
    const at = str(get(r, "createdDateTime"));
    const app = str(get(r, "appDisplayName"));
    const code = get(get(r, "status"), "errorCode");
    if (!at || !app || (code !== undefined && code !== 0)) continue;
    out.push({ at: new Date(at), appName: app, identity: str(get(r, "userPrincipalName")), device: str(get(get(r, "deviceDetail"), "deviceId")) });
  }
  return out;
}

export function consentsToObservations(items: unknown[]): RawObservation[] {
  const out: RawObservation[] = [];
  for (const r of items) {
    const at = str(get(r, "activityDateTime"));
    if (!at || str(get(r, "result")) !== "success") continue;
    const target = (get(r, "targetResources") as unknown[] | undefined)?.find((t) => str(get(t, "type")) === "ServicePrincipal") ?? (get(r, "targetResources") as unknown[] | undefined)?.[0];
    const app = str(get(target, "displayName"));
    if (!app) continue;
    out.push({ at: new Date(at), appName: app, identity: str(get(get(get(r, "initiatedBy"), "user"), "userPrincipalName")) });
  }
  return out;
}

// ---------- sync ----------

export type EntraRunner = <T>(fn: (db: TenantDb) => Promise<T>) => Promise<T>;

interface Loaded {
  integrationId: string;
  settings: EntraSettings;
  secret: string;
}

async function load(run: EntraRunner, ctx: OrgContext): Promise<Loaded> {
  return run(async (db) => {
    const row = await db.integration.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: ENTRA_KEY } } });
    if (!row || row.status !== "active") throw notFound("Active Microsoft Entra ID connection");
    const secret = await readCredentialForExecution(db, row.id, SECRET_NAME);
    if (!secret) throw validation("The client secret is missing or revoked; reconnect with a new secret");
    return { integrationId: row.id, settings: readEntraSettings(row), secret };
  });
}

async function saveState(run: EntraRunner, integrationId: string, patch: Partial<EntraSettings>) {
  await run(async (db) => {
    const row = await db.integration.findUniqueOrThrow({ where: { id: integrationId } });
    await db.integration.update({ where: { id: integrationId }, data: { settings: { ...readEntraSettings(row), ...patch } as unknown as Prisma.InputJsonValue } });
  });
}

/** Reads the token and one sign-in (or, without access to sign-ins, one audit record). Writes nothing to Microsoft. */
export async function testEntraConnection(run: EntraRunner, ctx: OrgContext): Promise<{ ok: boolean; signIns: boolean; consents: boolean; detail: string }> {
  assertPermission(ctx, "integrations:read");
  const l = await load(run, ctx);
  try {
    await accessToken(l.settings, l.secret, true);
  } catch (e) {
    return { ok: false, signIns: false, consents: false, detail: e instanceof Error ? e.message : String(e) };
  }
  let signIns = true;
  let consents = true;
  const notes: string[] = [];
  try {
    await graphGet(l.settings, l.secret, `${l.settings.graphUrl}/auditLogs/signIns?$top=1`);
  } catch (e) {
    signIns = false;
    notes.push(e instanceof Error ? e.message : String(e));
  }
  try {
    await graphGet(l.settings, l.secret, `${l.settings.graphUrl}/auditLogs/directoryAudits?$top=1`);
  } catch (e) {
    consents = false;
    notes.push(e instanceof Error ? e.message : String(e));
  }
  const ok = signIns || consents;
  await run((db) => appendEvidence(db, ctx, { type: "connector.entra.tested", subjectType: "integration", subjectId: l.integrationId, payload: { ok, signIns, consents } }));
  return { ok, signIns, consents, detail: ok && !notes.length ? "Token issued; sign-ins and audit logs readable" : notes.join(" ") || "ok" };
}

export interface EntraSyncResult {
  signIns: number;
  consents: number;
  matched: number;
  windows: number;
  caughtUp: boolean;
  errors: string[];
}

async function syncFeed(run: EntraRunner, ctx: OrgContext, l: Loaded, feed: "signIns" | "consents", now: Date, maxWindows: number, counts: EntraSyncResult) {
  const cursorKey = feed === "signIns" ? "cursorSignIns" : "cursorConsents";
  const field = feed === "signIns" ? "createdDateTime" : "activityDateTime";
  const base = feed === "signIns" ? `${l.settings.graphUrl}/auditLogs/signIns` : `${l.settings.graphUrl}/auditLogs/directoryAudits`;
  let cursor = new Date(l.settings[cursorKey] ?? now.getTime() - l.settings.backfillDays * 86400_000);
  const horizon = new Date(now.getTime() - LAG_MS);
  let width = MAX_WINDOW_MS;
  let windows = 0;
  while (cursor < horizon && windows < maxWindows) {
    const end = new Date(Math.min(horizon.getTime(), cursor.getTime() + width));
    const range = `${field} ge ${cursor.toISOString()} and ${field} lt ${end.toISOString()}`;
    const filter = feed === "signIns" ? range : `${range} and startswith(activityDisplayName,'Consent to application')`;
    const url = `${base}?$filter=${encodeURIComponent(filter)}&$top=${PAGE_SIZE}`;
    const { items, complete } = await allPages(l.settings, l.secret, url);
    if (!complete && width > MIN_WINDOW_MS) {
      width = Math.max(MIN_WINDOW_MS, Math.floor(width / 2));
      continue;
    }
    windows++;
    counts.windows++;
    const obs = feed === "signIns" ? signInsToObservations(items) : consentsToObservations(items);
    m.connectorRecords.inc({ connector: "entra", kind: feed }, items.length);
    if (feed === "signIns") counts.signIns += items.length;
    else counts.consents += items.length;
    if (obs.length) {
      const r = await run((db) => ingestObservations(db, ctx, { source: feed === "signIns" ? "entra" : "entra_consent", format: feed === "signIns" ? "graph_signins" : "graph_directory_audits", label: `Entra ${feed === "signIns" ? "sign-ins" : "app consents"} ${cursor.toISOString()} to ${end.toISOString()}${complete ? "" : " (partial: page limit reached)"}`, observations: obs }));
      counts.matched += r.matched;
    }
    if (!complete) counts.errors.push(`${feed}: a ${MIN_WINDOW_MS / 60_000}-minute window had more than ${MAX_PAGES_PER_WINDOW * PAGE_SIZE} records; the rest of it was skipped`);
    cursor = end;
    await saveState(run, l.integrationId, { [cursorKey]: cursor.toISOString() });
    width = Math.min(MAX_WINDOW_MS, width * 2);
  }
  if (cursor < horizon) counts.caughtUp = false;
}

/**
 * One sync run. Safe to repeat: the cursor only moves after a window is stored, and signals carry dedupe
 * keys, so a crash mid-run re-reads at most one window without duplicating anything.
 */
export async function syncEntra(run: EntraRunner, ctx: OrgContext, opts: { now?: Date; maxWindows?: number } = {}): Promise<EntraSyncResult> {
  const l = await load(run, ctx);
  const now = opts.now ?? new Date();
  const counts: EntraSyncResult = { signIns: 0, consents: 0, matched: 0, windows: 0, caughtUp: true, errors: [] };
  let failed: string | null = null;
  for (const feed of ["signIns", "consents"] as const) {
    try {
      // Reload so the second feed starts from the state the first one saved.
      await syncFeed(run, ctx, { ...l, settings: (await load(run, ctx)).settings }, feed, now, opts.maxWindows ?? 24, counts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      counts.errors.push(`${feed}: ${msg}`);
      failed = msg;
    }
  }
  const ok = failed === null;
  m.connectorSyncs.inc({ connector: "entra", outcome: failed ? (counts.signIns + counts.consents > 0 ? "partial" : "failed") : "ok" });
  await saveState(run, l.integrationId, { lastRunAt: now.toISOString(), ...(failed ? {} : { lastSuccessAt: now.toISOString() }), lastError: counts.errors.length ? counts.errors.join(" ").slice(0, 1000) : null, lastResult: { signIns: counts.signIns, consents: counts.consents, matched: counts.matched, windows: counts.windows, caughtUp: counts.caughtUp } });
  await run((db) => appendEvidence(db, ctx, { type: "connector.entra.synced", subjectType: "integration", subjectId: l.integrationId, payload: { signIns: counts.signIns, consents: counts.consents, matched: counts.matched, caughtUp: counts.caughtUp, errors: counts.errors.length, ok } }));
  if (failed) logger.warn({ orgId: ctx.orgId, connector: "entra", errors: counts.errors.length }, "entra sync had errors");
  return counts;
}
