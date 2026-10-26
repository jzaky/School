// Roster connections: where a school's roster comes from and how to read it. Credentials are encrypted with
// FIELD_ENCRYPTION_KEY and never leave the server; the settings page only learns whether they are set.
// No "server-only" marker: the worker imports this.
import type { RosterConnection } from "@prisma/client";
import { decryptField, encryptField } from "@/lib/crypto";
import { cleverApiBase } from "@/server/sso/providers";
import { cleverPage, oneRosterPage, type FetchCursor, type FetchPage, type RosterAuth } from "./client";
import { readOptions } from "@/lib/rostering/options";
import { tenantDb } from "@/lib/tenant-db";
import { buildDemoFeed, isDemoFeed } from "./demo-feed";

export const ROSTER_PROVIDERS = ["classlink", "clever", "oneroster"] as const;
export type RosterProvider = (typeof ROSTER_PROVIDERS)[number];
export const isRosterProvider = (v: unknown): v is RosterProvider => typeof v === "string" && (ROSTER_PROVIDERS as readonly string[]).includes(v);
export const AUTH_MODES = ["OAUTH1", "OAUTH2", "BEARER"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];
export const MAX_CONNECTIONS = 6;

export type Credentials = { key?: string; secret?: string; token?: string };

export function encryptCredentials(mode: AuthMode, c: Credentials): string | null {
  if (mode === "BEARER") return c.token ? encryptField(JSON.stringify({ t: c.token })) : null;
  return c.key && c.secret ? encryptField(JSON.stringify({ k: c.key, s: c.secret })) : null;
}

export class ConnectionError extends Error {
  constructor(public code: "CREDENTIALS" | "URL" | "TOKEN_URL") {
    super(`roster-connection:${code}`);
  }
}

export function authFor(conn: Pick<RosterConnection, "authMode" | "credentialsEnc" | "tokenUrl">): RosterAuth {
  if (!conn.credentialsEnc) throw new ConnectionError("CREDENTIALS");
  let data: { k?: string; s?: string; t?: string };
  try {
    data = JSON.parse(decryptField(conn.credentialsEnc));
  } catch {
    throw new ConnectionError("CREDENTIALS");
  }
  if (conn.authMode === "BEARER") {
    if (!data.t) throw new ConnectionError("CREDENTIALS");
    return { mode: "BEARER", token: data.t };
  }
  if (!data.k || !data.s) throw new ConnectionError("CREDENTIALS");
  if (conn.authMode === "OAUTH2") {
    if (!conn.tokenUrl) throw new ConnectionError("TOKEN_URL");
    return { mode: "OAUTH2", tokenUrl: conn.tokenUrl, clientId: data.k, clientSecret: data.s };
  }
  return { mode: "OAUTH1", key: data.k, secret: data.s };
}

/** One page of the connection's feed. `since` asks OneRoster servers for changed records only. */
export async function fetchPage(conn: RosterConnection, cursor: FetchCursor, since: Date | null): Promise<FetchPage> {
  const opts = readOptions(conn.options);
  if (isDemoFeed(conn.baseUrl)) {
    // The demo school's built-in feed (src/server/rostering/demo-feed.ts). Never available to a real school.
    const db = tenantDb(conn.orgId);
    const org = await db.organization.findUnique({ where: { id: conn.orgId }, select: { isDemo: true } });
    if (!org?.isDemo) throw new ConnectionError("URL");
    // Records the feed already knows; with none (a new demo connection) it lists the whole school.
    const links = await db.rosterLink.findMany({ where: { orgId: conn.orgId, provider: conn.provider, deactivatedAt: null, kind: { in: ["staff", "student", "guardian", "class", "enrollment"] } }, select: { externalId: true } });
    const feed = await buildDemoFeed(db as unknown as Parameters<typeof buildDemoFeed>[0], conn.orgId, links.length ? new Set(links.map((l) => l.externalId)) : undefined);
    return { records: feed.records, cursor: { step: 1, offset: 0, next: null }, done: true, total: feed.records.length, step: "demo" };
  }
  const auth = authFor(conn);
  if (conn.provider === "clever") {
    if (auth.mode !== "BEARER") throw new ConnectionError("CREDENTIALS");
    return cleverPage({ apiBase: conn.baseUrl || cleverApiBase(), token: auth.token, contacts: opts.importGuardians }, cursor);
  }
  if (!conn.baseUrl) throw new ConnectionError("URL");
  return oneRosterPage({ baseUrl: conn.baseUrl, auth, since, demographics: opts.importDemographics }, cursor);
}

/** Base URL rules: HTTPS, no credentials in the address, the OneRoster path is the school's to give. */
export function cleanBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.username || u.password || u.search || u.hash) return null;
    if (u.protocol !== "https:" && !(process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS === "true" && u.protocol === "http:")) return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
