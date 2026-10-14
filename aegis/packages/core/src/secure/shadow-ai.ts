import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { env } from "../env.js";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { hmacHex, sha256Hex } from "../lib/crypto.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { assertPermission } from "../orgs/orgs.js";
import { createSecurityEvent } from "../shield/security-events.js";
import { normalizePlan, planIncludes } from "../commercial/plans.js";

/**
 * Shadow AI discovery (docs/SHADOW_AI.md).
 *
 * AEGIS reads logs the organization already has and is authorized to share (identity-provider sign-ins,
 * DNS, managed browser, endpoint, secure web gateway, CASB and SaaS inventory exports) and keeps only the
 * entries that match a known AI application. Everything else in those logs is discarded on read and never
 * stored, so importing a DNS log does not copy anyone's browsing history into AEGIS.
 *
 * Every stored signal says how sure it is:
 * - confirmed: an authenticated sign-in to the app (identity provider), or a request through the AEGIS AI gateway
 * - observed: a managed browser, endpoint sensor, secure web gateway or CASB saw the app in use
 * - inferred: DNS or network metadata, or a SaaS inventory listing, suggests use
 *
 * None of these sources shows what was typed. AEGIS never claims to know prompt contents from them, and it
 * never claims an application was blocked: discovery observes; the AI gateway is where blocking happens.
 */

export type Confidence = "confirmed" | "observed" | "inferred";
export type SourceType = "identity" | "browser" | "endpoint" | "network" | "inventory";
const CONFIDENCE_RANK: Record<Confidence, number> = { inferred: 0, observed: 1, confirmed: 2 };

// ---------- catalog ----------

export interface CatalogApp {
  key: string;
  name: string;
  vendor: string;
  category: "chat" | "coding" | "api" | "search" | "local" | "image" | "platform";
  domains: string[];
  /** Names the app is listed under in identity providers and SaaS inventories (compared case-insensitively). */
  aliases: string[];
  processes: string[];
}

/** Well-known AI applications and the hostnames they serve from. Organizations add their own. */
export const AI_APP_CATALOG: CatalogApp[] = [
  { key: "chatgpt", name: "ChatGPT", vendor: "OpenAI", category: "chat", domains: ["chatgpt.com", "chat.openai.com"], aliases: ["chatgpt", "chatgpt enterprise", "chatgpt team"], processes: ["ChatGPT", "ChatGPT.exe"] },
  { key: "openai-api", name: "OpenAI API", vendor: "OpenAI", category: "api", domains: ["api.openai.com"], aliases: ["openai", "openai platform"], processes: [] },
  { key: "claude", name: "Claude", vendor: "Anthropic", category: "chat", domains: ["claude.ai"], aliases: ["claude", "claude for work", "claude enterprise"], processes: ["Claude", "Claude.exe"] },
  { key: "anthropic-api", name: "Anthropic API", vendor: "Anthropic", category: "api", domains: ["api.anthropic.com", "console.anthropic.com"], aliases: ["anthropic", "anthropic console"], processes: [] },
  { key: "gemini", name: "Gemini", vendor: "Google", category: "chat", domains: ["gemini.google.com", "bard.google.com"], aliases: ["gemini", "google gemini"], processes: [] },
  { key: "google-ai-studio", name: "Google AI Studio and Gemini API", vendor: "Google", category: "api", domains: ["aistudio.google.com", "generativelanguage.googleapis.com"], aliases: ["google ai studio"], processes: [] },
  { key: "microsoft-copilot", name: "Microsoft Copilot", vendor: "Microsoft", category: "chat", domains: ["copilot.microsoft.com"], aliases: ["microsoft copilot", "copilot"], processes: [] },
  { key: "github-copilot", name: "GitHub Copilot", vendor: "GitHub", category: "coding", domains: ["api.githubcopilot.com", "copilot-proxy.githubusercontent.com"], aliases: ["github copilot"], processes: [] },
  { key: "cursor", name: "Cursor", vendor: "Anysphere", category: "coding", domains: ["cursor.com", "cursor.sh"], aliases: ["cursor"], processes: ["Cursor", "Cursor.exe", "cursor"] },
  { key: "deepseek", name: "DeepSeek", vendor: "DeepSeek", category: "chat", domains: ["deepseek.com", "chat.deepseek.com", "api.deepseek.com"], aliases: ["deepseek"], processes: [] },
  { key: "perplexity", name: "Perplexity", vendor: "Perplexity", category: "search", domains: ["perplexity.ai"], aliases: ["perplexity", "perplexity enterprise"], processes: ["Perplexity"] },
  { key: "mistral", name: "Le Chat and Mistral API", vendor: "Mistral AI", category: "chat", domains: ["chat.mistral.ai", "api.mistral.ai", "console.mistral.ai"], aliases: ["mistral", "le chat"], processes: [] },
  { key: "grok", name: "Grok", vendor: "xAI", category: "chat", domains: ["grok.com", "api.x.ai"], aliases: ["grok"], processes: [] },
  { key: "huggingface", name: "Hugging Face", vendor: "Hugging Face", category: "platform", domains: ["huggingface.co", "hf.co"], aliases: ["hugging face"], processes: [] },
  { key: "poe", name: "Poe", vendor: "Quora", category: "chat", domains: ["poe.com"], aliases: ["poe"], processes: [] },
  { key: "ollama", name: "Ollama (local models)", vendor: "Ollama", category: "local", domains: ["ollama.com", "registry.ollama.ai"], aliases: ["ollama"], processes: ["ollama", "ollama.exe", "Ollama"] },
  { key: "lm-studio", name: "LM Studio (local models)", vendor: "LM Studio", category: "local", domains: ["lmstudio.ai"], aliases: ["lm studio"], processes: ["LM Studio", "LM Studio.exe", "lms"] },
  { key: "llama-cpp", name: "llama.cpp server (local models)", vendor: "Open source", category: "local", domains: [], aliases: [], processes: ["llama-server", "llama-server.exe"] },
];

export const SOURCES: Record<string, { label: string; type: SourceType; confidence: Confidence; sees: string; misses: string }> = {
  entra: { label: "Microsoft Entra ID sign-in logs", type: "identity", confidence: "confirmed", sees: "Sign-ins with work accounts to apps connected to single sign-on", misses: "Personal accounts, apps not connected to single sign-on, anything typed" },
  entra_consent: { label: "Microsoft Entra ID app consents", type: "identity", confidence: "confirmed", sees: "A person or administrator granting an app access to organizational data", misses: "Apps used without consent to organizational data, personal accounts" },
  okta: { label: "Okta System Log", type: "identity", confidence: "confirmed", sees: "Single sign-on to apps assigned in Okta", misses: "Personal accounts, apps outside Okta, anything typed" },
  managed_browser: { label: "Managed browser telemetry", type: "browser", confidence: "observed", sees: "AI sites visited in the managed browser, with the signed-in work identity", misses: "Other browsers, personal devices, page contents unless the browser policy captures them" },
  endpoint: { label: "Endpoint security", type: "endpoint", confidence: "observed", sees: "AI desktop apps and local model runtimes running on managed devices", misses: "Unmanaged devices, browser use, what the app was asked" },
  swg: { label: "Secure web gateway or proxy", type: "network", confidence: "observed", sees: "Requests to AI sites through the proxy, usually with the user", misses: "Traffic that bypasses the proxy (home networks, mobile data); encrypted contents unless TLS inspection is on" },
  casb: { label: "CASB", type: "network", confidence: "observed", sees: "Use of cloud AI apps the CASB recognizes", misses: "Apps it does not recognize, unmanaged paths" },
  dns: { label: "DNS logs", type: "network", confidence: "inferred", sees: "Lookups of AI hostnames, by device address", misses: "Who used it unless addresses map to people, whether it was used at all (lookups can be background), anything typed. Encrypted DNS bypasses it" },
  saas_inventory: { label: "SaaS application inventory", type: "inventory", confidence: "inferred", sees: "AI apps connected to the tenant or found by expense and OAuth reviews", misses: "Whether and how often they are used" },
};

export const IMPORT_FORMATS = ["entra_signin_json", "okta_system_log_json", "dns_jsonl", "managed_browser_jsonl", "endpoint_jsonl", "swg_jsonl", "saas_inventory_json"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
const FORMAT_SOURCE: Record<ImportFormat, keyof typeof SOURCES> = { entra_signin_json: "entra", okta_system_log_json: "okta", dns_jsonl: "dns", managed_browser_jsonl: "managed_browser", endpoint_jsonl: "endpoint", swg_jsonl: "swg", saas_inventory_json: "saas_inventory" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function hostOf(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!s) return null;
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname || null;
  } catch {
    return null;
  }
}

export interface MatchableApp {
  key: string;
  domains: string[];
  aliases: string[];
  processes: string[];
}

export function matchDomain(host: string, apps: MatchableApp[]): string | null {
  for (const a of apps) if (a.domains.some((d) => host === d || host.endsWith(`.${d}`))) return a.key;
  return null;
}
export function matchAppName(name: string, apps: MatchableApp[]): string | null {
  const n = norm(name);
  if (!n) return null;
  for (const a of apps) if (a.aliases.some((x) => norm(x) === n)) return a.key;
  return null;
}
export function matchProcess(proc: string, apps: MatchableApp[]): string | null {
  const base = proc.split(/[\\/]/).pop()!.trim();
  for (const a of apps) if (a.processes.some((p) => p.toLowerCase() === base.toLowerCase())) return a.key;
  return null;
}

// ---------- parsing ----------

/** A record reduced to what discovery keeps. */
export interface RawObservation {
  at: Date;
  domain?: string | null;
  appName?: string | null;
  process?: string | null;
  identity?: string | null;
  device?: string | null;
}

const MAX_RECORDS = 50_000;

function jsonLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      out.push(null);
    }
    if (out.length > MAX_RECORDS) throw validation(`More than ${MAX_RECORDS} records; split the file`);
  }
  return out;
}

function jsonArray(text: string): unknown[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw validation("The file is not valid JSON");
  }
  const arr = Array.isArray(v) ? v : Array.isArray((v as { value?: unknown })?.value) ? (v as { value: unknown[] }).value : null;
  if (!arr) throw validation("Expected a JSON array (or an object with a value array, as Microsoft Graph returns)");
  if (arr.length > MAX_RECORDS) throw validation(`More than ${MAX_RECORDS} records; split the file`);
  return arr;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
function date(v: unknown): Date | null {
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const get = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

/** Parses a log export into observations. Unparseable records are counted, not guessed at. */
export function parseImport(format: ImportFormat, text: string): { observations: RawObservation[]; rejected: number } {
  const obs: RawObservation[] = [];
  let rejected = 0;
  const push = (o: RawObservation | null) => (o ? obs.push(o) : rejected++);
  switch (format) {
    case "entra_signin_json":
      // Microsoft Graph signIn resource: createdDateTime, userPrincipalName, appDisplayName, status.errorCode, deviceDetail.deviceId.
      for (const r of jsonArray(text)) {
        const at = date(get(r, "createdDateTime"));
        const app = str(get(r, "appDisplayName"));
        const code = get(get(r, "status"), "errorCode");
        if (!at || !app) push(null);
        else if (code !== undefined && code !== 0) continue; // a failed sign-in is not use
        else push({ at, appName: app, identity: str(get(r, "userPrincipalName")), device: str(get(get(r, "deviceDetail"), "deviceId")) });
      }
      break;
    case "okta_system_log_json":
      // Okta System Log event: published, eventType, actor.alternateId, target[].type AppInstance, outcome.result.
      for (const r of jsonArray(text)) {
        const at = date(get(r, "published"));
        const targets = get(r, "target");
        const app = Array.isArray(targets) ? str(get(targets.find((t) => get(t, "type") === "AppInstance"), "displayName")) : null;
        const result = str(get(get(r, "outcome"), "result"));
        if (!at || !app) push(null);
        else if (result && result !== "SUCCESS") continue;
        else push({ at, appName: app, identity: str(get(get(r, "actor"), "alternateId")), device: str(get(get(r, "client"), "ipAddress")) });
      }
      break;
    case "dns_jsonl":
      // Generic DNS JSON lines and Zeek dns.log in JSON: ts, client or id.orig_h, query.
      for (const r of jsonLines(text)) {
        const at = date(get(r, "ts") ?? get(r, "timestamp"));
        const q = str(get(r, "query") ?? get(r, "qname"));
        const host = q ? hostOf(q) : null;
        push(at && host ? { at, domain: host, device: str(get(r, "client") ?? get(r, "id.orig_h") ?? get(r, "src_ip")), identity: str(get(r, "user")) } : null);
      }
      break;
    case "managed_browser_jsonl":
    case "swg_jsonl":
      for (const r of jsonLines(text)) {
        const at = date(get(r, "ts") ?? get(r, "timestamp"));
        const u = str(get(r, "url") ?? get(r, "domain") ?? get(r, "host"));
        const host = u ? hostOf(u) : null;
        push(at && host ? { at, domain: host, identity: str(get(r, "user")), device: str(get(r, "device") ?? get(r, "client")) } : null);
      }
      break;
    case "endpoint_jsonl":
      for (const r of jsonLines(text)) {
        const at = date(get(r, "ts") ?? get(r, "timestamp"));
        const p = str(get(r, "process") ?? get(r, "process_name"));
        push(at && p ? { at, process: p, identity: str(get(r, "user")), device: str(get(r, "device") ?? get(r, "hostname")) } : null);
      }
      break;
    case "saas_inventory_json":
      for (const r of jsonArray(text)) {
        const app = str(get(r, "app") ?? get(r, "name"));
        const at = date(get(r, "lastSeen") ?? get(r, "discoveredAt")) ?? new Date();
        push(app ? { at, appName: app, identity: str(get(r, "user") ?? get(r, "owner")) } : null);
      }
      break;
  }
  return { observations: obs, rejected };
}

// ---------- register ----------

export async function registerApps(db: TenantDb, orgId: string): Promise<(MatchableApp & { name: string; vendor: string; category: string; custom: boolean; status: string; note: string; controls: Record<string, unknown>; reviewedAt: Date | null })[]> {
  const rows = await db.shadowAiApp.findMany({ where: { orgId } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = AI_APP_CATALOG.map((c) => {
    const r = byKey.get(c.key);
    return { ...c, domains: [...new Set([...c.domains, ...(r?.domains ?? [])])], processes: [...new Set([...c.processes, ...(r?.processes ?? [])])], custom: false, status: r?.status ?? "unreviewed", note: r?.note ?? "", controls: (r?.controls ?? {}) as Record<string, unknown>, reviewedAt: r?.reviewedAt ?? null };
  });
  for (const r of rows) if (r.custom) out.push({ key: r.key, name: r.name, vendor: r.vendor, category: r.category as CatalogApp["category"], domains: r.domains, aliases: [r.name], processes: r.processes, custom: true, status: r.status, note: r.note, controls: r.controls as Record<string, unknown>, reviewedAt: r.reviewedAt });
  return out;
}

export const APP_STATUSES = ["unreviewed", "approved", "tolerated", "unapproved"] as const;
export const reviewAppSchema = z
  .object({
    key: z.string().min(2).max(60),
    status: z.enum(APP_STATUSES),
    note: z.string().max(1000).default(""),
    controls: z.object({ sso: z.boolean().optional(), dataRetentionAgreed: z.boolean().optional(), dpaSigned: z.boolean().optional(), adminConsole: z.boolean().optional() }).default({}),
  })
  .strict();

/** The organization's decision about an app. Controls are the organization's own statements about its contract. */
export async function reviewShadowAiApp(db: TenantDb, ctx: OrgContext, raw: z.input<typeof reviewAppSchema>) {
  assertPermission(ctx, "security:write");
  const input = reviewAppSchema.parse(raw);
  const cat = AI_APP_CATALOG.find((c) => c.key === input.key);
  const existing = await db.shadowAiApp.findUnique({ where: { orgId_key: { orgId: ctx.orgId, key: input.key } } });
  if (!cat && !existing) throw notFound("AI application");
  const data = { status: input.status, note: input.note, controls: input.controls as Prisma.InputJsonValue, reviewedBy: ctx.actor.id, reviewedAt: ctx.now ?? new Date() };
  const row = existing ? await db.shadowAiApp.update({ where: { id: existing.id }, data }) : await db.shadowAiApp.create({ data: { orgId: ctx.orgId, key: cat!.key, name: cat!.name, vendor: cat!.vendor, category: cat!.category, ...data } });
  await appendEvidence(db, ctx, { type: "shadow_ai.app_reviewed", subjectType: "shadow_ai_app", subjectId: row.id, payload: { key: row.key, status: row.status, controls: input.controls } });
  return row;
}

export const customAppSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,58}$/, "lowercase letters, digits and hyphens"),
    name: z.string().trim().min(2).max(120),
    vendor: z.string().trim().max(120).default(""),
    category: z.enum(["chat", "coding", "api", "search", "local", "image", "platform"]).default("chat"),
    domains: z.array(z.string().trim().min(3).max(200)).max(20).default([]),
    processes: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  })
  .strict();

/** Adds an application AEGIS does not know (an internal tool calling an AI API, a niche vendor). */
export async function addCustomShadowAiApp(db: TenantDb, ctx: OrgContext, raw: z.input<typeof customAppSchema>) {
  assertPermission(ctx, "security:write");
  const input = customAppSchema.parse(raw);
  if (AI_APP_CATALOG.some((c) => c.key === input.key)) throw validation("That key belongs to a catalog app");
  const domains = input.domains.map((d) => hostOf(d)).filter((d): d is string => !!d);
  if (!domains.length && !input.processes.length) throw validation("Give at least one hostname or process name to recognize it by");
  const row = await db.shadowAiApp.create({ data: { orgId: ctx.orgId, key: input.key, name: input.name, vendor: input.vendor, category: input.category, domains, processes: input.processes, custom: true } });
  await appendEvidence(db, ctx, { type: "shadow_ai.app_added", subjectType: "shadow_ai_app", subjectId: row.id, payload: { key: row.key, domains, processes: input.processes } });
  return row;
}

// ---------- ingestion ----------

function identityKey(orgId: string) {
  return sha256Hex(`aegis-discovery-identity:${orgId}:${env().AEGIS_MASTER_KEY}`);
}

export interface ImportResult {
  importId: string;
  received: number;
  accepted: number;
  matched: number;
  duplicates: number;
  unmatched: number;
  rejected: number;
  unapprovedApps: string[];
}

/**
 * Ingests observations from one authorized source. Only observations that match an AI application are
 * stored. Identities that match a member are linked to that member; others are stored as a keyed hash.
 * Re-importing the same file adds nothing (each signal has a dedupe key).
 */
export async function ingestObservations(db: TenantDb, ctx: OrgContext, input: { source: keyof typeof SOURCES; format: string; label?: string; observations: RawObservation[]; rejected?: number }): Promise<ImportResult> {
  // People need security:write. An integration (a log forwarder) is allowed when the API route has checked
  // its key carries discovery:report. Agents never report discovery data.
  if (ctx.actor.type === "agent") throw forbidden("Agents cannot report discovery data");
  if (ctx.actor.type === "user") assertPermission(ctx, "security:write");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { plan: true } });
  if (!planIncludes(normalizePlan(org.plan), "shadow_ai")) throw forbidden("Shadow AI discovery is not part of this organization's plan");
  const src = SOURCES[input.source];
  if (!src) throw validation(`Unknown source ${String(input.source)}`);
  const apps = await registerApps(db, ctx.orgId);
  const members = await db.membership.findMany({ where: { orgId: ctx.orgId }, select: { userId: true, user: { select: { email: true } } } });
  const byEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.userId]));
  const ik = identityKey(ctx.orgId);
  const imp = await db.discoveryImport.create({ data: { orgId: ctx.orgId, source: input.source, format: input.format, label: (input.label ?? "").slice(0, 200), received: input.observations.length + (input.rejected ?? 0), rejected: input.rejected ?? 0, createdBy: ctx.actor.type === "user" ? ctx.actor.id : null } });
  const unmatchedNames = new Map<string, number>();
  let matched = 0;
  let unmatched = 0;
  const rows: Prisma.DiscoverySignalCreateManyInput[] = [];
  for (const o of input.observations) {
    const appKey = o.domain ? matchDomain(o.domain, apps) : o.process ? matchProcess(o.process, apps) : o.appName ? matchAppName(o.appName, apps) : null;
    if (!appKey) {
      unmatched++;
      // Only app names from identity providers and inventories are kept as hints; domains from network logs are never kept.
      if (o.appName && (src.type === "identity" || src.type === "inventory")) unmatchedNames.set(o.appName.slice(0, 80), (unmatchedNames.get(o.appName.slice(0, 80)) ?? 0) + 1);
      continue;
    }
    matched++;
    const ident = o.identity?.toLowerCase() ?? null;
    const userId = ident ? byEmail.get(ident) ?? null : null;
    const identityHash = ident && !userId ? hmacHex(ik, ident) : null;
    const deviceHash = o.device ? hmacHex(ik, `device:${o.device.toLowerCase()}`) : null;
    const minute = new Date(Math.floor(o.at.getTime() / 60_000) * 60_000);
    const dedupeKey = sha256Hex([input.source, appKey, userId ?? identityHash ?? "", deviceHash ?? "", minute.toISOString()].join("|"));
    rows.push({ orgId: ctx.orgId, importId: imp.id, source: input.source, sourceType: src.type, confidence: src.confidence, appKey, domain: o.domain ?? null, process: o.process ? o.process.split(/[\\/]/).pop()!.slice(0, 120) : null, userId, identityHash, deviceHash, occurredAt: o.at, dedupeKey });
  }
  let accepted = 0;
  for (let i = 0; i < rows.length; i += 1000) accepted += (await db.discoverySignal.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true })).count;
  const duplicates = rows.length - accepted;
  const unmatchedTop = [...unmatchedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count }));
  await db.discoveryImport.update({ where: { id: imp.id }, data: { accepted, matched, duplicates, unmatched, unmatchedTop: unmatchedTop as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "shadow_ai.import", subjectType: "discovery_import", subjectId: imp.id, payload: { source: input.source, format: input.format, received: imp.received, accepted, matched, duplicates, unmatched, rejected: input.rejected ?? 0 } });

  // Use of an application the organization has marked unapproved: one security event per app per import.
  const statusOf = new Map(apps.map((a) => [a.key, a.status]));
  const newKeys = [...new Set(rows.map((r) => r.appKey!))];
  const unapprovedApps = newKeys.filter((k) => statusOf.get(k) === "unapproved");
  for (const k of unapprovedApps) {
    const count = rows.filter((r) => r.appKey === k).length;
    const app = apps.find((a) => a.key === k)!;
    await createSecurityEvent(db, ctx, { type: "shadow_ai.unapproved_use", severity: "medium", title: `${src.confidence === "inferred" ? "Possible" : src.confidence === "observed" ? "Observed" : "Confirmed"} use of unapproved AI app ${app.name} (${src.label})`, detail: { appKey: k, source: input.source, confidence: src.confidence, signals: count, importId: imp.id, blocked: false }, escalate: false });
  }
  return { importId: imp.id, received: imp.received, accepted, matched, duplicates, unmatched, rejected: input.rejected ?? 0, unapprovedApps };
}

export async function importDiscoveryFile(db: TenantDb, ctx: OrgContext, input: { format: ImportFormat; text: string; label?: string }) {
  if (ctx.actor.type === "user") assertPermission(ctx, "security:write");
  if (!IMPORT_FORMATS.includes(input.format)) throw validation("Unknown format");
  if (input.text.length > 20 * 1024 * 1024) throw validation("The file is larger than 20 MB; split it");
  const { observations, rejected } = parseImport(input.format, input.text);
  return ingestObservations(db, ctx, { source: FORMAT_SOURCE[input.format], format: input.format, label: input.label, observations, rejected });
}

// ---------- views ----------

export interface ShadowAiAppView {
  key: string;
  name: string;
  vendor: string;
  category: string;
  custom: boolean;
  status: string;
  note: string;
  controls: Record<string, unknown>;
  signals: number;
  people: number;
  devices: number;
  bestConfidence: Confidence | null;
  sources: string[];
  firstSeen: Date | null;
  lastSeen: Date | null;
  /** Requests for this app's provider that went through the AEGIS AI gateway in the window. */
  viaGateway: number;
  /** "violation" when an unapproved app was seen; "review" when an unreviewed app was seen. */
  finding: "violation" | "review" | null;
}

export async function listShadowAiApps(db: TenantDb, ctx: OrgContext, days = 30): Promise<ShadowAiAppView[]> {
  assertPermission(ctx, "security:read");
  const since = new Date((ctx.now ?? new Date()).getTime() - days * 86400_000);
  const [apps, signals] = await Promise.all([registerApps(db, ctx.orgId), db.discoverySignal.findMany({ where: { orgId: ctx.orgId, occurredAt: { gte: since }, appKey: { not: null } }, select: { appKey: true, source: true, confidence: true, userId: true, identityHash: true, deviceHash: true, occurredAt: true } })]);
  const gateway = await db.aiGatewayEvent.groupBy({ by: ["providerKey"], where: { orgId: ctx.orgId, createdAt: { gte: since }, forwarded: true }, _count: { _all: true } });
  const out: ShadowAiAppView[] = apps.map((a) => {
    const mine = signals.filter((s) => s.appKey === a.key);
    let best: Confidence | null = null;
    for (const s of mine) if (!best || CONFIDENCE_RANK[s.confidence as Confidence] > CONFIDENCE_RANK[best]) best = s.confidence as Confidence;
    const times = mine.map((s) => s.occurredAt.getTime());
    const seen = mine.length > 0;
    return {
      key: a.key,
      name: a.name,
      vendor: a.vendor,
      category: a.category,
      custom: a.custom,
      status: a.status,
      note: a.note,
      controls: a.controls,
      signals: mine.length,
      people: new Set(mine.map((s) => s.userId ?? s.identityHash).filter(Boolean)).size,
      devices: new Set(mine.map((s) => s.deviceHash).filter(Boolean)).size,
      bestConfidence: best,
      sources: [...new Set(mine.map((s) => s.source))].sort(),
      firstSeen: seen ? new Date(Math.min(...times)) : null,
      lastSeen: seen ? new Date(Math.max(...times)) : null,
      viaGateway: 0,
      finding: seen && a.status === "unapproved" ? "violation" : seen && a.status === "unreviewed" ? "review" : null,
    };
  });
  // Gateway traffic is attributed by provider key when an organization names its provider after the app.
  for (const g of gateway) {
    const v = out.find((o) => o.key === g.providerKey);
    if (v) v.viaGateway = g._count._all;
  }
  return out.sort((x, y) => (y.finding === "violation" ? 1 : 0) - (x.finding === "violation" ? 1 : 0) || y.signals - x.signals || x.name.localeCompare(y.name));
}

export interface CoverageView {
  sources: { key: string; label: string; type: SourceType; confidence: Confidence; sees: string; misses: string; connected: boolean; lastSignalAt: Date | null; lastImportAt: Date | null }[];
  typesConnected: number;
  typesTotal: number;
  /** Active members seen in identity-provider signals in the window, out of all active members. Null when no identity source is connected. */
  people: { seen: number; total: number } | null;
  gatewayConnected: boolean;
  statement: string;
}

/** What discovery can and cannot see right now. Never a percentage of AI use found: that cannot be known. */
export async function shadowAiCoverage(db: TenantDb, ctx: OrgContext, days = 30): Promise<CoverageView> {
  assertPermission(ctx, "security:read");
  const since = new Date((ctx.now ?? new Date()).getTime() - days * 86400_000);
  const [lastBySource, imports, members, idSeen, gw] = await Promise.all([
    db.discoverySignal.groupBy({ by: ["source"], where: { orgId: ctx.orgId, occurredAt: { gte: since } }, _max: { occurredAt: true } }),
    db.discoveryImport.groupBy({ by: ["source"], where: { orgId: ctx.orgId, createdAt: { gte: since } }, _max: { createdAt: true } }),
    db.membership.count({ where: { orgId: ctx.orgId, status: "active" } }),
    db.discoverySignal.findMany({ where: { orgId: ctx.orgId, sourceType: "identity", occurredAt: { gte: since }, userId: { not: null } }, select: { userId: true }, distinct: ["userId"] }),
    db.aiGatewayEvent.count({ where: { orgId: ctx.orgId, createdAt: { gte: since } } }),
  ]);
  const sigAt = new Map(lastBySource.map((r) => [r.source, r._max.occurredAt]));
  const impAt = new Map(imports.map((r) => [r.source, r._max.createdAt]));
  const sources = Object.entries(SOURCES).map(([key, s]) => ({ key, ...s, connected: impAt.has(key), lastSignalAt: sigAt.get(key) ?? null, lastImportAt: impAt.get(key) ?? null }));
  const types: SourceType[] = ["identity", "browser", "endpoint", "network", "inventory"];
  const connectedTypes = new Set(sources.filter((s) => s.connected).map((s) => s.type));
  const identityConnected = connectedTypes.has("identity");
  const missing = types.filter((t) => !connectedTypes.has(t));
  const statement = connectedTypes.size === 0 ? "No discovery source has sent data in the last 30 days, so AEGIS cannot say anything about AI use outside the AI gateway." : `${connectedTypes.size} of ${types.length} kinds of source sent data in the last ${days} days.${missing.length ? ` Not covered: ${missing.join(", ")}.` : ""} AI use on personal devices, personal accounts and networks AEGIS has no logs for is not visible.`;
  return { sources, typesConnected: connectedTypes.size, typesTotal: types.length, people: identityConnected ? { seen: idSeen.length, total: members } : null, gatewayConnected: gw > 0, statement };
}

export async function listDiscoveryImports(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "security:read");
  return db.discoveryImport.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 20 });
}
