import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { EventDestination, EvidenceEvent, Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { env } from "../env.js";
import { appendEvidence } from "../evidence/ledger.js";
import { decryptSecret, encryptSecret, randomToken } from "../lib/crypto.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { assertPermission } from "../orgs/orgs.js";
import { signWebhook } from "./service.js";

/**
 * Event destinations (docs/INTEGRATIONS.md): AEGIS sends governance events to the systems an
 * organization already watches.
 *
 * Source: the evidence ledger. A dispatcher walks each destination's cursor over new evidence
 * events, records one delivery per (destination, event) under a unique key, and delivers it with
 * retries and backoff. Nothing in the event paths changes, a delivery is never duplicated by AEGIS,
 * and failures stay visible with a retry.
 *
 * Network safety: destinations must use HTTPS and resolve to public addresses (checked on save and
 * before every delivery); redirects are not followed. AEGIS_ALLOW_PRIVATE_DESTINATIONS relaxes this
 * for local fakes and is refused in production.
 */

export const DESTINATION_KINDS = ["webhook", "slack", "teams", "splunk_hec", "datadog_logs", "servicenow"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

/** Event categories and the evidence types each one carries. */
export const EVENT_CATEGORIES: Record<string, { label: string; types: string[] }> = {
  security: { label: "Security events and incidents", types: ["security_event.created", "incident.created", "incident.status_changed"] },
  approvals: { label: "Approvals requested and expired", types: ["approval.requested", "approval.expired"] },
  decisions: { label: "Refused and quarantined actions", types: ["gateway.decision.deny", "gateway.decision.quarantine", "gateway.decision.error"] },
  agents: { label: "Agent suspensions, revocations and autonomy changes", types: ["agent.suspended", "agent.revoked", "autonomy.lowered", "autonomy.automatic_downgrade", "autonomy.raised", "access.requested"] },
  monitoring: { label: "Monitoring alerts", types: ["monitoring.alert_raised"] },
  governance: { label: "Policy, model and data governance changes", types: ["policy.activated", "model.approved", "model.retired", "model.enforcement_changed", "shield.injection_response_changed", "regulatory.change_recorded", "data.deletion_requested"] },
  lab: { label: "Attack Simulation Lab results", types: ["lab.run_completed", "lab.run_failed"] },
  audit: { label: "Reports and assessments", types: ["report.generated", "assessment.completed"] },
};
export const CATEGORY_KEYS = Object.keys(EVENT_CATEGORIES) as [string, ...string[]];

const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
export const DATADOG_SITES = ["datadoghq.com", "us3.datadoghq.com", "us5.datadoghq.com", "datadoghq.eu", "ap1.datadoghq.com", "ddog-gov.com"] as const;

const urlish = z.string().trim().min(8).max(500);
export const destinationInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("webhook"), url: urlish }),
  z.object({ kind: z.literal("slack"), webhookUrl: urlish }),
  z.object({ kind: z.literal("teams"), webhookUrl: urlish }),
  z.object({ kind: z.literal("splunk_hec"), url: urlish, token: z.string().trim().min(8).max(200), index: z.string().trim().max(80).default("") }),
  z.object({ kind: z.literal("datadog_logs"), site: z.enum(DATADOG_SITES), apiKey: z.string().trim().min(16).max(200), baseUrl: urlish.optional() }),
  z.object({ kind: z.literal("servicenow"), instanceUrl: urlish, username: z.string().trim().min(1).max(120), password: z.string().min(1).max(200) }),
]);
export const destinationCommonSchema = z.object({
  name: z.string().trim().min(2).max(120),
  categories: z.array(z.enum(CATEGORY_KEYS)).min(1).max(CATEGORY_KEYS.length),
  minSeverity: z.enum(["low", "medium", "high", "critical"]).nullable().default(null),
});
export type DestinationInput = z.input<typeof destinationInputSchema> & z.input<typeof destinationCommonSchema>;

function requirePerson(ctx: OrgContext, what: string) {
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden(`Only a person can ${what}`);
}

// ---- Network safety ----

/** True for loopback, private, link-local, CGNAT, multicast, reserved and cloud metadata addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    if (s.startsWith("::ffff:")) return isPrivateAddress(s.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}

/** Throws unless the URL is HTTPS and every address it resolves to is public (or private destinations are allowed). */
export async function assertSafeDestinationUrl(raw: string, resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw validation("Not a valid URL");
  }
  const allowPrivate = env().AEGIS_ALLOW_PRIVATE_DESTINATIONS;
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) throw validation("Destinations must use HTTPS");
  if (url.username || url.password) throw validation("Put credentials in the credential field, not in the URL");
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw validation("Destinations must be reachable on the public internet");
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => [] as string[]);
  if (addresses.length === 0) throw validation(`Could not resolve ${host}`);
  if (addresses.some(isPrivateAddress)) throw validation("Destinations must not resolve to private, loopback or metadata addresses");
  return url;
}

// ---- Secrets and config ----

interface Stored {
  config: Record<string, string>;
  secret: string;
}

function split(input: z.infer<typeof destinationInputSchema>): Stored {
  switch (input.kind) {
    case "webhook":
      // AEGIS generates the signing secret; the receiver verifies X-AEGIS-Signature with it.
      return { config: { url: input.url }, secret: `whsec_${randomToken(24)}` };
    case "slack":
    case "teams":
      return { config: { host: new URL(input.webhookUrl).hostname }, secret: input.webhookUrl };
    case "splunk_hec":
      return { config: { url: input.url, index: input.index }, secret: input.token };
    case "datadog_logs":
      return { config: { site: input.site, ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}) }, secret: input.apiKey };
    case "servicenow":
      return { config: { instanceUrl: input.instanceUrl, username: input.username }, secret: input.password };
  }
}

const aad = (orgId: string, kind: string) => `event-destination:${orgId}:${kind}`;

/** Encrypts a destination secret the way createDestination stores it. For seeds that cannot resolve DNS. */
export function sealDestinationSecret(orgId: string, kind: DestinationKind, secret: string): string {
  return encryptSecret(secret, aad(orgId, kind));
}

function targetUrl(d: Pick<EventDestination, "kind" | "config">, secret: string): string {
  const c = d.config as Record<string, string>;
  switch (d.kind) {
    case "webhook":
      return c.url!;
    case "slack":
    case "teams":
      return secret;
    case "splunk_hec":
      return `${c.url!.replace(/\/+$/, "")}/services/collector/event`;
    case "datadog_logs":
      return c.baseUrl ? `${c.baseUrl.replace(/\/+$/, "")}/api/v2/logs` : `https://http-intake.logs.${c.site}/api/v2/logs`;
    case "servicenow":
      return `${c.instanceUrl!.replace(/\/+$/, "")}/api/now/table/incident`;
    default:
      throw validation(`Unknown destination kind ${d.kind}`);
  }
}

// ---- Envelope and formatting ----

export interface EventEnvelope {
  id: string;
  type: string;
  category: string;
  occurredAt: string;
  organizationId: string;
  subject: { type: string; id: string | null };
  severity: string | null;
  title: string;
  link: string | null;
  data: Record<string, unknown>;
}

export function categoryOf(type: string): string | null {
  for (const [k, c] of Object.entries(EVENT_CATEGORIES)) if (c.types.includes(type)) return k;
  return null;
}

function linkFor(e: Pick<EvidenceEvent, "subjectType" | "subjectId">): string | null {
  const base = env().WEB_PUBLIC_URL.replace(/\/+$/, "");
  const id = e.subjectId;
  if (!id) return null;
  const paths: Record<string, string> = { action_request: `/gateway/${id}`, approval_request: `/approvals/${id}`, security_event: `/security/events/${id}`, incident: `/security/incidents/${id}`, agent: `/agents/${id}`, attack_simulation_run: `/security/lab/${id}`, ai_model: `/governance/models/${id}`, regulatory_change: `/governance/regulatory/${id}`, policy: `/policies/${id}`, alert: `/alerts` };
  return paths[e.subjectType] ? `${base}${paths[e.subjectType]}` : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** A short human title for an event, from fields the evidence payload already carries. */
export function titleFor(e: Pick<EvidenceEvent, "type" | "payload">): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const reasons = Array.isArray(p.reasons) ? (p.reasons as unknown[]).filter((r) => typeof r === "string").slice(0, 2).join("; ") : "";
  switch (e.type) {
    case "security_event.created":
      return `Security event (${str(p.severity) ?? "unknown severity"}): ${str(p.title) ?? str(p.type) ?? "new event"}`;
    case "incident.created":
      return `Incident #${typeof p.number === "number" ? p.number : "?"} opened (${str(p.severity) ?? "unknown severity"})`;
    case "incident.status_changed":
      return `Incident ${str(p.to) ?? "updated"}${str(p.title) ? `: ${p.title}` : ""}`;
    case "approval.requested":
      return "An agent action is waiting for approval";
    case "approval.expired":
      return "An approval request expired without a decision";
    case "gateway.decision.deny":
      return `Action refused${reasons ? `: ${reasons}` : ""}`;
    case "gateway.decision.quarantine":
      return `Action held for security review${reasons ? `: ${reasons}` : ""}`;
    case "gateway.decision.error":
      return "Policy evaluation failed; action refused";
    case "monitoring.alert_raised":
      return `Monitoring alert: ${str(p.title) ?? str(p.rule) ?? "new alert"}`;
    case "lab.run_completed": {
      const counts = (p.counts ?? {}) as Record<string, number>;
      return `Attack Simulation Lab: ${counts.defended ?? 0} defended, ${counts.gap ?? 0} gaps`;
    }
    default:
      return `AEGIS: ${e.type.replace(/[._]/g, " ")}`;
  }
}

export function envelopeFor(e: EvidenceEvent): EventEnvelope {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  return {
    id: e.id,
    type: e.type,
    category: categoryOf(e.type) ?? "other",
    occurredAt: e.occurredAt.toISOString(),
    organizationId: e.orgId,
    subject: { type: e.subjectType, id: e.subjectId },
    severity: str(p.severity),
    title: titleFor(e),
    link: linkFor(e),
    data: p,
  };
}

interface DestinationRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Builds the HTTP request for a destination kind. Chat destinations get a human message; machine sinks get the full envelope. */
export function buildRequest(d: Pick<EventDestination, "kind" | "config" | "name">, secret: string, env_: EventEnvelope, deliveryId: string, now = new Date()): DestinationRequest {
  const url = targetUrl(d, secret);
  const json = { "content-type": "application/json", "user-agent": "AEGIS-Events/1" };
  const text = env_.link ? `${env_.title}\n${env_.link}` : env_.title;
  switch (d.kind) {
    case "webhook": {
      const body = JSON.stringify(env_);
      const ts = String(Math.floor(now.getTime() / 1000));
      return { url, body, headers: { ...json, "x-aegis-event": env_.type, "x-aegis-delivery": deliveryId, "x-aegis-timestamp": ts, "x-aegis-signature": signWebhook(secret, ts, body) } };
    }
    case "slack":
      return { url, headers: json, body: JSON.stringify({ text, blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${escapeSlack(env_.title)}*${env_.link ? `\n<${env_.link}|Open in AEGIS>` : ""}` } }, { type: "context", elements: [{ type: "mrkdwn", text: `${env_.type} | ${env_.occurredAt}` }] }] }) };
    case "teams":
      return {
        url,
        headers: json,
        body: JSON.stringify({
          type: "message",
          attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", text: env_.title, weight: "Bolder", wrap: true }, { type: "TextBlock", text: `${env_.type} | ${env_.occurredAt}`, isSubtle: true, wrap: true }], actions: env_.link ? [{ type: "Action.OpenUrl", title: "Open in AEGIS", url: env_.link }] : [] } }],
        }),
      };
    case "splunk_hec": {
      const index = (d.config as Record<string, string>).index;
      return { url, headers: { ...json, authorization: `Splunk ${secret}` }, body: JSON.stringify({ time: Math.floor(new Date(env_.occurredAt).getTime() / 1000), source: "aegis", sourcetype: "aegis:event", ...(index ? { index } : {}), event: env_ }) };
    }
    case "datadog_logs":
      return { url, headers: { ...json, "dd-api-key": secret }, body: JSON.stringify([{ ddsource: "aegis", service: "aegis", ddtags: `category:${env_.category},type:${env_.type}`, message: env_.title, aegis: env_ }]) };
    case "servicenow": {
      const c = d.config as Record<string, string>;
      const sev = env_.severity ? (SEVERITY_RANK[env_.severity] ?? 1) : 1;
      return {
        url,
        headers: { ...json, accept: "application/json", authorization: `Basic ${Buffer.from(`${c.username}:${secret}`).toString("base64")}` },
        body: JSON.stringify({ short_description: env_.title.slice(0, 160), description: `${env_.title}\n\nAEGIS event ${env_.type} at ${env_.occurredAt}.${env_.link ? `\n${env_.link}` : ""}`, urgency: String(3 - Math.min(2, sev)), impact: String(3 - Math.min(2, sev)), correlation_id: env_.id, correlation_display: "AEGIS" }),
      };
    }
    default:
      throw validation(`Unknown destination kind ${d.kind}`);
  }
}

function escapeSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- Management ----

export async function createDestination(db: TenantDb, ctx: OrgContext, raw: DestinationInput) {
  assertPermission(ctx, "integrations:write");
  requirePerson(ctx, "add an event destination");
  const common = destinationCommonSchema.parse(raw);
  const input = destinationInputSchema.parse(raw);
  const stored = split(input);
  await assertSafeDestinationUrl(targetUrl({ kind: input.kind, config: stored.config }, stored.secret));
  const last = await db.evidenceEvent.findFirst({ where: { orgId: ctx.orgId }, orderBy: { seq: "desc" }, select: { seq: true } });
  const now = ctx.now ?? new Date();
  const d = await db.eventDestination.create({ data: { orgId: ctx.orgId, kind: input.kind, name: common.name, categories: common.categories, minSeverity: common.minSeverity, config: stored.config as Prisma.InputJsonValue, secretEnvelope: encryptSecret(stored.secret, aad(ctx.orgId, input.kind)), cursorSeq: last?.seq ?? 0n, createdBy: ctx.actor.id, createdAt: now, updatedAt: now } });
  await appendEvidence(db, ctx, { type: "destination.created", subjectType: "event_destination", subjectId: d.id, payload: { kind: d.kind, name: d.name, categories: d.categories, minSeverity: d.minSeverity } });
  // The webhook signing secret is AEGIS-generated and shown once.
  const { secretEnvelope: _s, ...safe } = d;
  return { destination: { ...safe, cursorSeq: safe.cursorSeq.toString() }, signingSecret: input.kind === "webhook" ? stored.secret : null };
}

async function loadDestination(db: TenantDb, ctx: OrgContext, id: string) {
  const d = await db.eventDestination.findUnique({ where: { id } });
  if (!d || d.orgId !== ctx.orgId) throw notFound("Event destination");
  return d;
}

export async function updateDestination(db: TenantDb, ctx: OrgContext, id: string, patch: { name?: string; categories?: string[]; minSeverity?: string | null; enabled?: boolean }) {
  assertPermission(ctx, "integrations:write");
  requirePerson(ctx, "change an event destination");
  await loadDestination(db, ctx, id);
  const data = destinationCommonSchema.partial().extend({ enabled: z.boolean().optional() }).parse(patch);
  const d = await db.eventDestination.update({ where: { id }, data });
  await appendEvidence(db, ctx, { type: data.enabled === false ? "destination.disabled" : data.enabled === true ? "destination.enabled" : "destination.updated", subjectType: "event_destination", subjectId: id, payload: { fields: Object.keys(data) } });
  return d;
}

/** Replaces the stored secret (a new webhook URL, token or password). For signed webhooks, generates a new signing secret. */
export async function replaceDestinationSecret(db: TenantDb, ctx: OrgContext, id: string, secret: string | null) {
  assertPermission(ctx, "integrations:write");
  requirePerson(ctx, "replace a destination credential");
  const d = await loadDestination(db, ctx, id);
  const next = d.kind === "webhook" ? `whsec_${randomToken(24)}` : z.string().trim().min(8).max(500).parse(secret ?? "");
  if (d.kind === "slack" || d.kind === "teams") await assertSafeDestinationUrl(next);
  await db.eventDestination.update({ where: { id }, data: { secretEnvelope: encryptSecret(next, aad(ctx.orgId, d.kind)), verifiedAt: null, ...(d.kind === "slack" || d.kind === "teams" ? { config: { host: new URL(next).hostname } } : {}) } });
  await appendEvidence(db, ctx, { type: "destination.secret_replaced", subjectType: "event_destination", subjectId: id, payload: { kind: d.kind } });
  return { signingSecret: d.kind === "webhook" ? next : null };
}

export async function listDestinations(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "integrations:read");
  const [rows, counts] = await Promise.all([
    db.eventDestination.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "asc" } }),
    db.eventDelivery.groupBy({ by: ["destinationId", "status"], where: { orgId: ctx.orgId }, _count: { _all: true } }),
  ]);
  return rows.map((d) => {
    const { secretEnvelope, ...rest } = d;
    const c = Object.fromEntries(counts.filter((x) => x.destinationId === d.id).map((x) => [x.status, x._count._all]));
    return { ...rest, cursorSeq: rest.cursorSeq.toString(), secretHint: hintFor(d, secretEnvelope), deliveries: { delivered: c.delivered ?? 0, pending: c.pending ?? 0, failed: c.failed ?? 0 } };
  });
}

function hintFor(d: Pick<EventDestination, "orgId" | "kind">, envelope: string): string {
  try {
    const secret = decryptSecret(envelope, aad(d.orgId, d.kind));
    return `ending ${secret.slice(-4)}`;
  } catch {
    return "unreadable";
  }
}

export async function getDestination(db: TenantDb, ctx: OrgContext, id: string) {
  assertPermission(ctx, "integrations:read");
  const d = await loadDestination(db, ctx, id);
  const deliveries = await db.eventDelivery.findMany({ where: { destinationId: id }, orderBy: { createdAt: "desc" }, take: 100 });
  const { secretEnvelope, ...rest } = d;
  return { destination: { ...rest, cursorSeq: rest.cursorSeq.toString(), secretHint: hintFor(d, secretEnvelope) }, deliveries };
}

// ---- Delivery ----

export type Sender = (req: DestinationRequest) => Promise<{ status: number; body: string }>;

const defaultSender: Sender = async (req) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, redirect: "manual", signal: controller.signal });
    return { status: res.status, body: (await res.text()).slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
};

let sender: Sender = defaultSender;
/** Tests replace the HTTP sender; production uses fetch. */
export function setDestinationSender(s: Sender | null) {
  sender = s ?? defaultSender;
}

/** Backoff after each failed attempt; the delivery fails for good after the last. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

function permanentStatus(status: number) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export type DestinationRunner = <T>(fn: (db: TenantDb) => Promise<T>) => Promise<T>;

async function attempt(d: EventDestination, envelope: EventEnvelope, deliveryId: string, now: Date): Promise<{ ok: boolean; status: number | null; error: string | null; permanent: boolean }> {
  try {
    const secret = decryptSecret(d.secretEnvelope, aad(d.orgId, d.kind));
    const req = buildRequest(d, secret, envelope, deliveryId, now);
    await assertSafeDestinationUrl(req.url);
    const res = await sender(req);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, error: null, permanent: false };
    if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status, error: "The destination answered with a redirect, which AEGIS does not follow", permanent: true };
    return { ok: false, status: res.status, error: `HTTP ${res.status}${res.body ? `: ${res.body.slice(0, 200)}` : ""}`, permanent: permanentStatus(res.status) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const permanent = /HTTPS|private|resolve|valid URL|credential field/.test(msg);
    return { ok: false, status: null, error: msg.slice(0, 300), permanent };
  }
}

/**
 * One dispatch pass for one organization: claims each enabled destination, records deliveries for
 * new matching evidence events, and attempts every due delivery. HTTP calls run outside database
 * transactions. Safe to run concurrently: a destination is held by one dispatcher at a time and each
 * (destination, event) pair has one delivery row.
 */
export async function dispatchEvents(run: DestinationRunner, orgId: string, opts: { now?: Date; batch?: number } = {}) {
  const now = opts.now ?? new Date();
  const batch = opts.batch ?? 200;
  const destinations = await run((db) => db.eventDestination.findMany({ where: { orgId, enabled: true }, select: { id: true } }));
  let delivered = 0;
  let failed = 0;
  for (const { id } of destinations) {
    const claimed = await run((db) => db.eventDestination.updateMany({ where: { id, OR: [{ dispatchLockedUntil: null }, { dispatchLockedUntil: { lt: now } }] }, data: { dispatchLockedUntil: new Date(now.getTime() + 2 * 60_000) } }));
    if (claimed.count !== 1) continue;
    try {
      const d = await run(async (db) => {
        const dest = await db.eventDestination.findUniqueOrThrow({ where: { id } });
        const types = dest.categories.flatMap((c) => EVENT_CATEGORIES[c]?.types ?? []);
        const events = await db.evidenceEvent.findMany({ where: { orgId, seq: { gt: dest.cursorSeq } }, orderBy: { seq: "asc" }, take: batch, select: { id: true, seq: true, type: true, payload: true, subjectType: true, subjectId: true } });
        const candidates = events.filter((e) => types.includes(e.type) && passesSeverity(dest.minSeverity, e.type, e.payload));
        const lab = await labEventIds(db, candidates);
        const matching = candidates.filter((e) => !lab.has(e.id));
        if (matching.length) await db.eventDelivery.createMany({ data: matching.map((e) => ({ orgId, destinationId: id, evidenceEventId: e.id, eventType: e.type, nextAttemptAt: now, createdAt: now })), skipDuplicates: true });
        const last = events[events.length - 1];
        if (last) await db.eventDestination.update({ where: { id }, data: { cursorSeq: last.seq } });
        return dest;
      });
      const due = await run((db) => db.eventDelivery.findMany({ where: { destinationId: id, status: "pending", nextAttemptAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: 50 }));
      for (const del of due) {
        const ev = del.evidenceEventId ? await run((db) => db.evidenceEvent.findUnique({ where: { id: del.evidenceEventId! } })) : null;
        if (!ev) {
          await run((db) => db.eventDelivery.update({ where: { id: del.id }, data: { status: "failed", lastError: "Evidence event not found" } }));
          continue;
        }
        const r = await attempt(d, envelopeFor(ev), del.id, now);
        const attempts = del.attempts + 1;
        const giveUp = !r.ok && (r.permanent || attempts > RETRY_DELAYS_MS.length);
        await run(async (db) => {
          await db.eventDelivery.update({ where: { id: del.id }, data: { attempts, responseStatus: r.status, lastError: r.error, status: r.ok ? "delivered" : giveUp ? "failed" : "pending", deliveredAt: r.ok ? now : null, nextAttemptAt: r.ok || giveUp ? del.nextAttemptAt : new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]!) } });
          await db.eventDestination.update({ where: { id }, data: r.ok ? { lastDeliveredAt: now, lastError: null } : { lastError: r.error } });
        });
        if (r.ok) delivered += 1;
        else if (giveUp) failed += 1;
      }
    } catch (e) {
      logger.error({ orgId, destinationId: id, err: e instanceof Error ? e.message : String(e) }, "event dispatch failed for a destination");
    } finally {
      await run((db) => db.eventDestination.update({ where: { id }, data: { dispatchLockedUntil: null } }));
    }
  }
  return { destinations: destinations.length, delivered, failed };
}

/** Events about Attack Simulation Lab agents stay on the record but are never sent to a destination. */
async function labEventIds(db: TenantDb, events: { id: string; subjectType: string; subjectId: string | null }[]): Promise<Set<string>> {
  const ids = (t: string) => events.filter((e) => e.subjectType === t && e.subjectId).map((e) => e.subjectId!);
  const [requests, approvals, secEvents] = await Promise.all([
    ids("action_request").length ? db.actionRequest.findMany({ where: { id: { in: ids("action_request") }, agent: { isLab: true } }, select: { id: true } }) : [],
    ids("approval_request").length ? db.approvalRequest.findMany({ where: { id: { in: ids("approval_request") }, request: { agent: { isLab: true } } }, select: { id: true } }) : [],
    ids("security_event").length ? db.securityEvent.findMany({ where: { id: { in: ids("security_event") }, title: { startsWith: "[lab]" } }, select: { id: true } }) : [],
  ]);
  const labSubjects = new Set([...requests, ...approvals, ...secEvents].map((r) => r.id));
  return new Set(events.filter((e) => e.subjectId && labSubjects.has(e.subjectId)).map((e) => e.id));
}

function passesSeverity(min: string | null, type: string, payload: unknown): boolean {
  if (!min || type !== "security_event.created") return true;
  const sev = str((payload as Record<string, unknown> | null)?.severity);
  return (SEVERITY_RANK[sev ?? "low"] ?? 0) >= (SEVERITY_RANK[min] ?? 0);
}

/** Sends a test event now and records the result. A success marks the destination verified: the real endpoint accepted an AEGIS event. */
export async function sendTestEvent(run: DestinationRunner, ctx: OrgContext, id: string) {
  assertPermission(ctx, "integrations:write");
  requirePerson(ctx, "send a test event");
  const d = await run((db) => loadDestination(db, ctx, id));
  const now = ctx.now ?? new Date();
  const envelope: EventEnvelope = { id: `test-${randomToken(8)}`, type: "aegis.test", category: "test", occurredAt: now.toISOString(), organizationId: ctx.orgId, subject: { type: "event_destination", id }, severity: null, title: `AEGIS test event for ${d.name}`, link: `${env().WEB_PUBLIC_URL.replace(/\/+$/, "")}/integrations/destinations/${id}`, data: { test: true } };
  const delivery = await run((db) => db.eventDelivery.create({ data: { orgId: ctx.orgId, destinationId: id, evidenceEventId: null, eventType: "aegis.test", status: "pending", createdAt: now } }));
  const r = await attempt(d, envelope, delivery.id, now);
  await run(async (db) => {
    await db.eventDelivery.update({ where: { id: delivery.id }, data: { attempts: 1, responseStatus: r.status, lastError: r.error, status: r.ok ? "delivered" : "failed", deliveredAt: r.ok ? now : null } });
    await db.eventDestination.update({ where: { id }, data: r.ok ? { verifiedAt: now, lastDeliveredAt: now, lastError: null } : { lastError: r.error } });
    await appendEvidence(db, ctx, { type: r.ok ? "destination.test_delivered" : "destination.test_failed", subjectType: "event_destination", subjectId: id, payload: { kind: d.kind, status: r.status, error: r.error } });
  });
  return { ok: r.ok, status: r.status, error: r.error };
}

/** Puts a failed delivery back in the queue for the next dispatch. */
export async function retryDelivery(db: TenantDb, ctx: OrgContext, deliveryId: string) {
  assertPermission(ctx, "integrations:write");
  const del = await db.eventDelivery.findUnique({ where: { id: deliveryId } });
  if (!del || del.orgId !== ctx.orgId) throw notFound("Delivery");
  if (del.status !== "failed" || !del.evidenceEventId) throw validation("Only a failed event delivery can be retried");
  await db.eventDelivery.update({ where: { id: deliveryId }, data: { status: "pending", nextAttemptAt: ctx.now ?? new Date(), attempts: 0, lastError: null } });
  await appendEvidence(db, ctx, { type: "destination.delivery_retried", subjectType: "event_destination", subjectId: del.destinationId, payload: { deliveryId, eventType: del.eventType } });
}
