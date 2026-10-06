// Background job handlers. Pure functions of (job data, now) so they can be tested without Redis.
// Every handler is idempotent: outbound rows are claimed with a conditional update, one-off jobs
// record a JobRun row keyed by an idempotency key, and workflow steps carry their own keys.
// Never log recipient addresses, names or message content here: only ids, channels and counts.
import type { Prisma, PrismaClient, RetentionAction, Sensitivity } from "@prisma/client";
import { tenantDb, tenantTx, type TenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { fmtWhen } from "@/server/appointments/booking";
import { advanceRun } from "@/server/workflows/engine";
import { flushEffects } from "@/server/queue-core";

export type FlushFn = (effects: Effect[]) => Promise<void>;

export type HandlerOpts = {
  now?: Date;
  /** Where post-commit effects go. Defaults to the BullMQ queues. */
  flush?: FlushFn;
};

// ---------------------------------------------------------------------------
// JobRun ledger: at most one successful run per (orgId, idempotencyKey)
// ---------------------------------------------------------------------------

/** Claims an idempotency key inside a tenant transaction. Returns false if it was already used. */
async function claimJob(tx: TenantTx, orgId: string, queueName: string, name: string, key: string) {
  // ON CONFLICT DO NOTHING keeps the transaction usable when the key already exists.
  const res = await tx.jobRun.createMany({ data: [{ orgId, queue: queueName, name, idempotencyKey: key, status: "RUNNING" }], skipDuplicates: true });
  return res.count === 1;
}

async function finishJob(tx: TenantTx, orgId: string, key: string, now: Date, result: Record<string, unknown>) {
  await tx.jobRun.update({
    where: { orgId_idempotencyKey: { orgId, idempotencyKey: key } },
    data: { status: "COMPLETED", finishedAt: now, result: result as Prisma.InputJsonValue },
  });
}

// ---------------------------------------------------------------------------
// Outbound delivery (queue "notify", job "deliver")
// ---------------------------------------------------------------------------

export type DeliverJob = { orgId: string; outboundId: string; locale?: "en" | "ar"; body?: string | null; href?: string | null };

export type OutgoingMessage = {
  id: string;
  orgId: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP" | "IN_APP";
  to: string;
  subject: string | null;
  body: string | null;
  href: string | null;
  locale: "en" | "ar";
  idempotencyKey: string;
  /** Absolute link for emails that point outside the school portal (public site). Overrides href. */
  linkUrl?: string | null;
  linkLabel?: string | null;
};

export type Sender = (msg: OutgoingMessage) => Promise<{ providerId: string }>;

// RFC 2606 / 6761 reserved domains. The demo school uses these, so nothing is ever sent to them.
const RESERVED_DOMAIN = /\.(example|test|invalid|localhost)$/i;

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function appLink(msg: OutgoingMessage) {
  const base = (process.env.APP_URL ?? process.env.AUTH_URL ?? "").replace(/\/+$/, "");
  if (!base || !msg.href) return null;
  const path = msg.href.startsWith("/") ? msg.href : `/${msg.href}`;
  return `${base}/${msg.locale}${path}`;
}

export function renderEmail(msg: OutgoingMessage) {
  const dir = msg.locale === "ar" ? "rtl" : "ltr";
  const link = msg.linkUrl ?? appLink(msg);
  const linkLabel = msg.linkLabel ?? (msg.locale === "ar" ? "فتح في المنصة" : "Open in the school portal");
  const subject = msg.subject ?? "";
  const body = msg.body ?? "";
  const html = [
    `<div dir="${dir}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111">`,
    `<p style="font-weight:600">${escapeHtml(subject)}</p>`,
    body ? `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>` : "",
    link ? `<p><a href="${escapeHtml(link)}">${linkLabel}</a></p>` : "",
    `</div>`,
  ].join("");
  const text = [subject, body, link ? `${linkLabel}: ${link}` : ""].filter(Boolean).join("\n\n");
  return { html, text };
}

/** Default provider: Resend over HTTPS for email when configured, otherwise the console provider. */
export const defaultSender: Sender = async (msg) => {
  if (msg.channel === "EMAIL" && RESERVED_DOMAIN.test(msg.to.split("@")[1] ?? "")) {
    return { providerId: "suppressed:reserved-domain" };
  }
  const key = process.env.RESEND_API_KEY;
  if (msg.channel === "EMAIL" && key) {
    const { html, text } = renderEmail(msg);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Resend drops repeats of the same key, a second guard behind the database claim.
        "Idempotency-Key": `${msg.orgId}:${msg.idempotencyKey}`.slice(0, 256),
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Horizon School <onboarding@resend.dev>",
        to: [msg.to],
        subject: msg.subject ?? "",
        html,
        text,
      }),
    });
    if (!res.ok) {
      // The response body can echo the recipient, so only the status is surfaced.
      throw new Error(`resend_http_${res.status}`);
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { providerId: json.id ?? "resend" };
  }
  // SMS, WhatsApp and unconfigured email: console provider. Never print recipient or content.
  console.log(`[worker] outbound ${msg.id} channel=${msg.channel}`);
  return { providerId: "console" };
};

export type DeliverResult = "sent" | "skipped" | "failed";

/**
 * Deliver one OutboundMessage. The row is claimed atomically (QUEUED to SENT) before the provider is
 * called, so two workers, a retry and the sweeper can never send the same message twice.
 */
export async function deliverOutbound(data: DeliverJob, opts: HandlerOpts & { send?: Sender } = {}): Promise<DeliverResult> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? defaultSender;
  const db = tenantDb(data.orgId);
  const claimed = await db.outboundMessage.updateMany({ where: { id: data.outboundId, orgId: data.orgId, status: "QUEUED" }, data: { status: "SENT" } });
  if (claimed.count !== 1) return "skipped";
  const row = await db.outboundMessage.findUnique({ where: { id: data.outboundId } });
  if (!row) return "skipped";
  try {
    const res = await send({
      id: row.id,
      orgId: row.orgId,
      channel: row.channel,
      to: row.to,
      subject: row.subject,
      body: data.body ?? null,
      href: data.href ?? null,
      locale: data.locale === "ar" ? "ar" : "en",
      idempotencyKey: row.idempotencyKey,
    });
    await db.outboundMessage.update({ where: { id: row.id }, data: { sentAt: now, providerId: res.providerId.slice(0, 200), error: null } });
    return "sent";
  } catch (err) {
    const message = err instanceof Error ? err.message : "send_failed";
    await db.outboundMessage.update({ where: { id: row.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    console.error(`[worker] outbound ${row.id} channel=${row.channel} failed`);
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Appointment reminders (queue "reminders", job "appointment")
// ---------------------------------------------------------------------------

export type ReminderJob = { orgId: string; appointmentId: string; window: string };

const SENSITIVE: Sensitivity[] = ["WELLBEING", "SAFEGUARDING"];

function relativeText(start: Date, now: Date) {
  const mins = Math.max(1, Math.ceil((start.getTime() - now.getTime()) / 60_000));
  if (mins < 90) return { en: `in ${mins} minutes`, ar: `خلال ${mins} دقيقة` };
  const hours = Math.round(mins / 60);
  return { en: `in ${hours} hours`, ar: `خلال ${hours} ساعة` };
}

export async function sendAppointmentReminder(data: ReminderJob, opts: HandlerOpts = {}) {
  const now = opts.now ?? new Date();
  const flush = opts.flush ?? flushEffects;
  const key = `reminder:${data.appointmentId}:${data.window}`;
  const out = await tenantTx(data.orgId, async (tx) => {
    const ec = execCtx(tx, data.orgId, { now });
    if (!(await claimJob(tx, data.orgId, "reminders", "appointment", key))) return { status: "duplicate" as const, effects: [] as Effect[] };
    const appt = await tx.appointment.findUnique({ where: { id: data.appointmentId }, include: { type: true, attendees: true } });
    if (!appt || appt.status !== "CONFIRMED" || appt.startsAt <= now) {
      await finishJob(tx, data.orgId, key, now, { outcome: "skipped" });
      return { status: "skipped" as const, effects: [] as Effect[] };
    }
    let recipients = [appt.hostId, ...appt.attendees.map((a) => a.membershipId)].filter((m): m is string => Boolean(m));
    if (appt.caseId) {
      // Wellbeing and safeguarding meetings: only the host is reminded automatically.
      const c = await tx.case.findUnique({ where: { id: appt.caseId }, select: { sensitivity: true } });
      if (c && SENSITIVE.includes(c.sensitivity)) recipients = [appt.hostId];
    }
    const host = await tx.membership.findUnique({ where: { id: appt.hostId }, include: { user: true } });
    const res = await notify(ec, {
      recipients,
      templateKey: "appointment_reminder",
      kind: "appointment_reminder",
      vars: {
        title: { en: appt.type.nameEn, ar: appt.type.nameAr },
        relative: relativeText(appt.startsAt, now),
        when: fmtWhen(appt.startsAt),
        host: { en: host?.user.nameEn ?? "", ar: host?.user.nameAr ?? host?.user.nameEn ?? "" },
        location: { en: appt.locationEn ?? "", ar: appt.locationAr ?? appt.locationEn ?? "" },
      },
      href: `/meetings/${appt.id}`,
      channels: ["IN_APP", "EMAIL"],
      idempotencyBase: key,
    });
    await finishJob(tx, data.orgId, key, now, { outcome: "sent", inApp: res.inApp, outbound: res.outbound });
    return { status: "sent" as const, effects: ec.effects };
  });
  await flush(out.effects);
  return out.status;
}

// ---------------------------------------------------------------------------
// Workflow resume (queue "workflow", job "resume")
// ---------------------------------------------------------------------------

export type ResumeJob = { orgId: string; runId: string };

/** Re-evaluates a waiting run. advanceRun is safe to call repeatedly (each step has an idempotency key). */
export async function resumeWorkflowRun(data: ResumeJob, opts: HandlerOpts = {}) {
  const now = opts.now ?? new Date();
  const flush = opts.flush ?? flushEffects;
  const effects = await tenantTx(
    data.orgId,
    async (tx) => {
      const run = await tx.workflowRun.findUnique({ where: { id: data.runId }, select: { status: true } });
      if (!run || (run.status !== "WAITING" && run.status !== "RUNNING")) return [] as Effect[];
      const ec = execCtx(tx, data.orgId, { now });
      await advanceRun(ec, data.runId);
      return ec.effects;
    },
    { timeout: 60_000 },
  );
  await flush(effects);
  return effects.length;
}

// ---------------------------------------------------------------------------
// Sweeper (every minute): lost outbound jobs, due reminders, elapsed waits
// ---------------------------------------------------------------------------

export async function sweepOrg(orgId: string, opts: HandlerOpts & { send?: Sender } = {}) {
  const now = opts.now ?? new Date();
  const db = tenantDb(orgId);
  const counts = { outbound: 0, reminders: 0, waits: 0 };

  // 1. Outbound rows still QUEUED a minute after creation: their job was lost or Redis was down.
  const stale = await db.outboundMessage.findMany({
    where: { orgId, status: "QUEUED", createdAt: { lt: new Date(now.getTime() - 60_000) } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const o of stale) {
    if ((await deliverOutbound({ orgId, outboundId: o.id }, opts)) === "sent") counts.outbound++;
  }

  // 2. Reminders that are due. Mirrors bookAppointment: a window only applies if the booking
  // was made before it opened. The JobRun key matches the delayed job, so each is sent once.
  const upcoming = await db.appointment.findMany({
    where: { orgId, status: "CONFIRMED", startsAt: { gt: now, lte: new Date(now.getTime() + 24 * 3600_000) } },
    select: { id: true, startsAt: true, createdAt: true },
    take: 500,
  });
  const due: { appointmentId: string; window: string; key: string }[] = [];
  for (const a of upcoming) {
    const oneHour = new Date(a.startsAt.getTime() - 3600_000);
    const oneDay = new Date(a.startsAt.getTime() - 24 * 3600_000);
    let window: string | null = null;
    if (now >= oneHour && a.createdAt < oneHour) window = "1h";
    else if (now < oneHour && now >= oneDay && a.createdAt < oneDay) window = "24h";
    if (window) due.push({ appointmentId: a.id, window, key: `reminder:${a.id}:${window}` });
  }
  const done = new Set(
    due.length
      ? (await db.jobRun.findMany({ where: { orgId, idempotencyKey: { in: due.map((d) => d.key) } }, select: { idempotencyKey: true } })).map((j) => j.idempotencyKey)
      : [],
  );
  for (const d of due) {
    if (done.has(d.key)) continue;
    if ((await sendAppointmentReminder({ orgId, appointmentId: d.appointmentId, window: d.window }, opts)) === "sent") counts.reminders++;
  }

  // 3. Workflow wait steps whose time has come.
  const waits = await db.workflowStepRun.findMany({
    where: { orgId, status: "WAITING", nodeType: "wait", scheduledFor: { lte: now } },
    select: { runId: true },
    distinct: ["runId"],
    take: 100,
  });
  for (const w of waits) {
    await resumeWorkflowRun({ orgId, runId: w.runId }, opts);
    counts.waits++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Retention sweep (daily)
// ---------------------------------------------------------------------------

export type RetentionOutcome = "deleted" | "flagged" | "requires_owner" | "unsupported";
export type RetentionResult = { recordType: string; action: RetentionAction; count: number; outcome: RetentionOutcome };

/**
 * Applies each RetentionPolicy conservatively:
 * - DELETE removes only in-app notifications and AI drafts older than the period.
 * - Audit events are append-only for the app role, so they are counted and left for the owner.
 * - REVIEW and ANONYMIZE never change records: eligible rows are counted and flagged for a human.
 * One run per organization per UTC day (JobRun key), and one AuditEvent summarizing the counts.
 */
export async function sweepRetention(orgId: string, opts: HandlerOpts = {}) {
  const now = opts.now ?? new Date();
  const key = `retention:${now.toISOString().slice(0, 10)}`;
  return tenantTx(
    orgId,
    async (tx) => {
      if (!(await claimJob(tx, orgId, "maintenance", "retention", key))) return null;
      const policies = await tx.retentionPolicy.findMany({ where: { orgId }, orderBy: { recordType: "asc" } });
      const results: RetentionResult[] = [];
      for (const p of policies) {
        const cutoff = new Date(now.getTime() - p.retentionDays * 86_400_000);
        const r = await applyPolicy(tx, orgId, p.recordType, p.action, cutoff);
        results.push({ recordType: p.recordType, action: p.action, ...r });
        await tx.retentionPolicy.update({ where: { id: p.id }, data: { lastRunAt: now, lastRunCount: r.count } });
      }
      await tx.auditEvent.create({
        data: {
          orgId,
          actorId: null,
          action: "retention.sweep",
          entityType: "RetentionPolicy",
          entityId: null,
          meta: { date: key.slice("retention:".length), results } as unknown as Prisma.InputJsonValue,
          createdAt: now,
        },
      });
      await finishJob(tx, orgId, key, now, { results });
      return results;
    },
    { timeout: 120_000 },
  );
}

async function applyPolicy(tx: TenantTx, orgId: string, recordType: string, action: RetentionAction, cutoff: Date): Promise<{ count: number; outcome: RetentionOutcome }> {
  const old = { lt: cutoff };
  const flag = (count: number) => ({ count, outcome: "flagged" as const });
  switch (recordType) {
    case "notification":
      if (action === "DELETE") return { count: (await tx.notification.deleteMany({ where: { orgId, createdAt: old } })).count, outcome: "deleted" };
      return flag(await tx.notification.count({ where: { orgId, createdAt: old } }));
    case "ai_interaction":
      if (action === "DELETE") return { count: (await tx.aiInteraction.deleteMany({ where: { orgId, createdAt: old } })).count, outcome: "deleted" };
      return flag(await tx.aiInteraction.count({ where: { orgId, createdAt: old } }));
    case "audit": {
      const count = await tx.auditEvent.count({ where: { orgId, createdAt: old } });
      return { count, outcome: action === "DELETE" ? "requires_owner" : "flagged" };
    }
    case "request":
      return flag(await tx.request.count({ where: { orgId, status: { in: ["COMPLETED", "REJECTED", "CANCELLED"] }, updatedAt: old } }));
    case "case_standard":
      return flag(await tx.case.count({ where: { orgId, sensitivity: { notIn: SENSITIVE }, status: "CLOSED", updatedAt: old } }));
    case "case_wellbeing":
      return flag(await tx.case.count({ where: { orgId, sensitivity: "WELLBEING", status: "CLOSED", updatedAt: old } }));
    case "case_safeguarding":
      return flag(await tx.case.count({ where: { orgId, sensitivity: "SAFEGUARDING", status: "CLOSED", updatedAt: old } }));
    case "student_record":
      return flag(await tx.student.count({ where: { orgId, status: { in: ["GRADUATED", "WITHDRAWN", "INACTIVE"] }, updatedAt: old } }));
    case "medical":
      return flag(await tx.studentMedical.count({ where: { orgId, updatedAt: old, student: { status: { in: ["GRADUATED", "WITHDRAWN", "INACTIVE"] } } } }));
    default:
      return { count: 0, outcome: "unsupported" };
  }
}

// ---------------------------------------------------------------------------
// Idempotency probe (queue "maintenance", job "test.idempotent")
// ---------------------------------------------------------------------------

export type TestIdempotentJob = { orgId: string; key: string };

/** Records one JobRun per key. Running it again with the same key returns "duplicate". */
export async function testIdempotent(data: TestIdempotentJob, opts: HandlerOpts = {}) {
  const now = opts.now ?? new Date();
  const key = `test:${data.key}`;
  return tenantTx(data.orgId, async (tx) => {
    if (!(await claimJob(tx, data.orgId, "maintenance", "test.idempotent", key))) return "duplicate" as const;
    await finishJob(tx, data.orgId, key, now, { ok: true });
    return "done" as const;
  });
}

// ---------------------------------------------------------------------------
// Platform helper: which organizations to iterate
// ---------------------------------------------------------------------------

/** Lists organization ids with a platform (owner) client. Organization rows hold no student data. */
export async function listOrgIds(platform: PrismaClient) {
  const orgs = await platform.organization.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  return orgs.map((o) => o.id);
}
