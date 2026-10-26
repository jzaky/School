// Reading rosters page by page: OneRoster 1.1 and 1.2 REST (ClassLink Roster Server or any certified server) and
// the Clever data API v3.0. Each call fetches one page and returns the cursor for the next, so a run can stop
// and resume anywhere (src/server/rostering/run.ts). Requests go through the guarded HTTP client
// (src/server/sso/http.ts). Credentials are never logged; errors carry a code only.
//
// OneRoster 1.1 requests are signed with OAuth 1.0a, HMAC-SHA256 (RFC 5849), as the OneRoster 1.1 specification
// and ClassLink Roster Server require. OneRoster 1.2 uses OAuth 2.0 client credentials. A bearer token covers
// Clever district tokens and roster proxies that sign for you.
// No "server-only" marker: the worker imports this.
import { createHmac } from "node:crypto";
import { HttpError, basicAuth, form, httpJson } from "@/server/sso/http";
import { randomToken } from "@/server/sso/seal";
import { cleverSchool, cleverSection, cleverTerm, cleverUser, oneRosterClass, oneRosterCourse, oneRosterDemographic, oneRosterEnrollment, oneRosterOrg, oneRosterSession, oneRosterUser, type Staged } from "@/lib/rostering/records";

export type RosterAuth =
  | { mode: "OAUTH1"; key: string; secret: string }
  | { mode: "OAUTH2"; tokenUrl: string; clientId: string; clientSecret: string; scope?: string }
  | { mode: "BEARER"; token: string };

export class RosterFetchError extends Error {
  constructor(public code: "AUTH" | "HTTP" | "FORMAT" | "URL" | "TOO_LARGE" | "TIMEOUT" | "NETWORK") {
    super(`roster:${code}`);
  }
}

// ---------------------------------------------------------------------------
// OAuth 1.0a (HMAC-SHA256) for OneRoster 1.1
// ---------------------------------------------------------------------------

/** RFC 3986 percent-encoding as OAuth 1.0a requires. */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function oauth1Header(method: string, url: string, key: string, secret: string, opts: { nonce?: string; timestamp?: number } = {}): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: key,
    oauth_nonce: opts.nonce ?? randomToken(16),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };
  const params: Array<[string, string]> = [...u.searchParams.entries(), ...Object.entries(oauth)];
  const normalized = params
    .map(([k, v]) => [pct(k), pct(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const base = [method.toUpperCase(), pct(baseUrl), pct(normalized)].join("&");
  const signature = createHmac("sha256", `${pct(secret)}&`).update(base).digest("base64");
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature })
    .map(([k, v]) => `${k}="${pct(v)}"`)
    .join(", ")}`;
}

// ---------------------------------------------------------------------------
// Authorized GET
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __rosterTokens?: Map<string, { token: string; until: number }> };

async function oauth2Token(a: Extract<RosterAuth, { mode: "OAUTH2" }>): Promise<string> {
  g.__rosterTokens ??= new Map();
  const cacheKey = `${a.tokenUrl}|${a.clientId}`;
  const hit = g.__rosterTokens.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.token;
  try {
    const { data } = await httpJson<{ access_token?: string; expires_in?: number }>({
      method: "POST",
      url: a.tokenUrl,
      headers: { Authorization: basicAuth(a.clientId, a.clientSecret), "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "client_credentials", scope: a.scope }),
      timeoutMs: 15_000,
      maxBytes: 64 * 1024,
    });
    if (!data.access_token) throw new RosterFetchError("AUTH");
    g.__rosterTokens.set(cacheKey, { token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000 });
    return data.access_token;
  } catch (e) {
    if (e instanceof RosterFetchError) throw e;
    throw new RosterFetchError("AUTH");
  }
}

export async function rosterGet<T = Record<string, unknown>>(url: string, auth: RosterAuth): Promise<{ data: T; total: number | null }> {
  const headers: Record<string, string> = {};
  if (auth.mode === "OAUTH1") headers.Authorization = oauth1Header("GET", url, auth.key, auth.secret);
  else if (auth.mode === "OAUTH2") headers.Authorization = `Bearer ${await oauth2Token(auth)}`;
  else headers.Authorization = `Bearer ${auth.token}`;
  try {
    const { data, headers: h } = await httpJson<T>({ url, headers, timeoutMs: 60_000, maxBytes: 32 * 1024 * 1024 });
    const total = Number(h["x-total-count"]);
    return { data, total: Number.isFinite(total) && total >= 0 ? total : null };
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.code === "STATUS" && (e.status === 401 || e.status === 403)) throw new RosterFetchError("AUTH");
      if (e.code === "URL" || e.code === "BLOCKED_ADDRESS") throw new RosterFetchError("URL");
      if (e.code === "TOO_LARGE") throw new RosterFetchError("TOO_LARGE");
      if (e.code === "TIMEOUT") throw new RosterFetchError("TIMEOUT");
      if (e.code === "JSON") throw new RosterFetchError("FORMAT");
      if (e.code === "NETWORK") throw new RosterFetchError("NETWORK");
    }
    throw new RosterFetchError("HTTP");
  }
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

export type FetchCursor = { step: number; offset: number; next: string | null };
export const START_CURSOR: FetchCursor = { step: 0, offset: 0, next: null };
export type FetchPage = { records: Staged[]; cursor: FetchCursor; done: boolean; total: number | null; step: string };
export type FetchPlan = { steps: string[] };

type Row = Record<string, unknown>;

const OR_STEPS: Array<{ path: string; key: string; map: (r: Row) => Staged | null; demographics?: boolean }> = [
  { path: "orgs", key: "orgs", map: oneRosterOrg },
  { path: "academicSessions", key: "academicSessions", map: oneRosterSession },
  { path: "courses", key: "courses", map: oneRosterCourse },
  { path: "users", key: "users", map: oneRosterUser },
  { path: "classes", key: "classes", map: oneRosterClass },
  { path: "enrollments", key: "enrollments", map: oneRosterEnrollment },
  { path: "demographics", key: "demographics", map: oneRosterDemographic, demographics: true },
];
export const OR_PAGE = 1000;

export type OneRosterSource = { baseUrl: string; auth: RosterAuth; since: Date | null; demographics: boolean };

export function oneRosterSteps(src: Pick<OneRosterSource, "demographics">) {
  return OR_STEPS.filter((s) => !s.demographics || src.demographics);
}

/** One OneRoster page. A delta run asks only for records changed since the last applied run. */
export async function oneRosterPage(src: OneRosterSource, cursor: FetchCursor): Promise<FetchPage> {
  const steps = oneRosterSteps(src);
  const step = steps[cursor.step];
  if (!step) return { records: [], cursor, done: true, total: null, step: "done" };
  const url = new URL(`${src.baseUrl.replace(/\/+$/, "")}/${step.path}`);
  url.searchParams.set("limit", String(OR_PAGE));
  url.searchParams.set("offset", String(cursor.offset));
  if (src.since) url.searchParams.set("filter", `dateLastModified>'${src.since.toISOString()}'`);
  const { data, total } = await rosterGet<Row>(url.toString(), src.auth);
  const items = data[step.key];
  if (!Array.isArray(items)) throw new RosterFetchError("FORMAT");
  const records = (items as Row[]).map(step.map).filter((r): r is Staged => !!r);
  const nextOffset = cursor.offset + items.length;
  const stepDone = items.length < OR_PAGE || (total !== null && nextOffset >= total) || items.length === 0;
  const next: FetchCursor = stepDone ? { step: cursor.step + 1, offset: 0, next: null } : { step: cursor.step, offset: nextOffset, next: null };
  return { records, cursor: next, done: stepDone && cursor.step + 1 >= steps.length, total, step: step.path };
}

const CLEVER_STEPS = ["schools", "terms", "users?role=teacher", "users?role=staff", "users?role=student", "users?role=contact", "sections"] as const;
export const CLEVER_PAGE = 1000;

export type CleverSource = { apiBase: string; token: string; contacts: boolean };

export function cleverSteps(src: Pick<CleverSource, "contacts">) {
  return CLEVER_STEPS.filter((s) => src.contacts || s !== "users?role=contact");
}

/** One Clever page (v3.0, cursor paging through the "next" link). */
export async function cleverPage(src: CleverSource, cursor: FetchCursor): Promise<FetchPage> {
  const steps = cleverSteps(src);
  const step = steps[cursor.step];
  if (!step) return { records: [], cursor, done: true, total: null, step: "done" };
  const base = src.apiBase.replace(/\/+$/, "");
  const path = cursor.next && cursor.next.startsWith("/v3.0/") ? cursor.next : `/v3.0/${step}${step.includes("?") ? "&" : "?"}limit=${CLEVER_PAGE}`;
  const { data } = await rosterGet<{ data?: Array<{ data?: Row }>; links?: Array<{ rel?: string; uri?: string }> }>(`${base}${path}`, { mode: "BEARER", token: src.token });
  if (!Array.isArray(data.data)) throw new RosterFetchError("FORMAT");
  const rows = data.data.map((d) => d.data ?? {});
  const records: Staged[] = [];
  for (const r of rows) {
    if (step === "schools") records.push(...[cleverSchool(r)].filter((x): x is Staged => !!x));
    else if (step === "terms") records.push(...[cleverTerm(r)].filter((x): x is Staged => !!x));
    else if (step === "sections") records.push(...cleverSection(r));
    else records.push(...[cleverUser(r)].filter((x): x is Staged => !!x));
  }
  const nextLink = data.links?.find((l) => l.rel === "next")?.uri ?? null;
  const stepDone = !nextLink || rows.length === 0;
  const next: FetchCursor = stepDone ? { step: cursor.step + 1, offset: 0, next: null } : { step: cursor.step, offset: cursor.offset + rows.length, next: nextLink };
  return { records, cursor: next, done: stepDone && cursor.step + 1 >= steps.length, total: null, step: step.split("?")[0] };
}
