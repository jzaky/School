import { z } from "zod";
import { rawPrisma, withTenant, type TenantDb } from "@aegis/db";
import { appendEvidence } from "../evidence/ledger.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import { makeContext, type OrgContext } from "../lib/context.js";
import { conflict, forbidden, notFound, validation } from "../lib/errors.js";
import { assertPermission, slugSchema } from "../orgs/orgs.js";
import { SYSTEM_ROLES } from "../identity/permissions.js";
import { effectiveLimits, normalizePlan, PLAN_KEYS, PLANS, trialState, usageAgainstLimits, type PlanKey, type PlanLimits } from "./plans.js";

/**
 * Commercial records (docs/COMMERCIAL.md): contracts, usage metering, invoices and support requests.
 * AEGIS keeps these records; it is not connected to a payment provider, never charges a card and never
 * collects money. A provider records payment it received elsewhere. Writes that set commercial terms
 * are for platform administrators only.
 */

// ---------- platform administrators ----------

export async function assertPlatformAdmin(userId: string) {
  const u = await rawPrisma().user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } });
  if (!u?.isPlatformAdmin) throw forbidden("Platform administrators only");
}

function platformCtx(orgId: string, userId: string): OrgContext {
  return makeContext(orgId, { type: "user", id: userId, label: "Platform administrator", permissions: [] });
}

// ---------- organization creation with a first administrator ----------

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
  adminEmail: z.string().trim().toLowerCase().email().max(254),
  plan: z.enum(PLAN_KEYS).default("trial"),
  trialDays: z.coerce.number().int().min(1).max(180).default(30),
  demoMode: z.boolean().default(false),
});

/**
 * Creates a customer organization with no members and an owner invitation for its first administrator.
 * The invitation link is returned once; this deployment does not send email on its own.
 */
export async function platformCreateOrganization(actorUserId: string, raw: z.input<typeof createCustomerSchema>, now = new Date()) {
  await assertPlatformAdmin(actorUserId);
  const input = createCustomerSchema.parse(raw);
  const db0 = rawPrisma();
  if (await db0.organization.findUnique({ where: { slug: input.slug } })) throw conflict("Slug already taken");
  const org = await db0.organization.create({ data: { name: input.name, slug: input.slug, plan: input.plan, demoMode: input.demoMode, trialEndsAt: input.plan === "trial" ? new Date(now.getTime() + input.trialDays * 86_400_000) : null } });
  const token = randomToken(24);
  await withTenant(org.id, async (db) => {
    const ctx = platformCtx(org.id, actorUserId);
    const roles = await Promise.all(SYSTEM_ROLES.map((r) => db.role.create({ data: { orgId: org.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, isSystem: true } })));
    const owner = roles.find((r) => r.key === "owner")!;
    const inv = await db.invitation.create({ data: { orgId: org.id, email: input.adminEmail, roleId: owner.id, tokenHash: sha256Hex(token), invitedBy: actorUserId, expiresAt: new Date(now.getTime() + 7 * 86_400_000) } });
    await appendEvidence(db, ctx, { type: "org.created", subjectType: "organization", subjectId: org.id, payload: { name: org.name, slug: org.slug, plan: input.plan, createdBy: "platform administrator" } });
    await appendEvidence(db, ctx, { type: "invitation.created", subjectType: "invitation", subjectId: inv.id, payload: { role: "owner", firstAdministrator: true } });
    const { ensureDefaultDataClasses } = await import("../shield/data-classes.js");
    await ensureDefaultDataClasses(db, ctx);
  });
  await db0.platformEvent.create({ data: { type: "platform.org_created", actorId: actorUserId, orgId: org.id, detail: { slug: org.slug, plan: input.plan } } });
  return { org, invitationToken: token };
}

// ---------- plan and trial ----------

export const setPlanSchema = z.object({ plan: z.enum(PLAN_KEYS), trialEndsAt: z.coerce.date().nullable().optional() });

export async function platformSetPlan(actorUserId: string, orgId: string, raw: unknown) {
  await assertPlatformAdmin(actorUserId);
  const input = setPlanSchema.parse(raw);
  const before = await rawPrisma().organization.findUnique({ where: { id: orgId } });
  if (!before) throw notFound("Organization");
  const trialEndsAt = input.plan === "trial" ? (input.trialEndsAt ?? before.trialEndsAt ?? null) : null;
  const org = await rawPrisma().organization.update({ where: { id: orgId }, data: { plan: input.plan, trialEndsAt } });
  await withTenant(orgId, (db) => appendEvidence(db, platformCtx(orgId, actorUserId), { type: "org.plan_changed", subjectType: "organization", subjectId: orgId, payload: { from: normalizePlan(before.plan), to: input.plan, trialEndsAt: trialEndsAt?.toISOString() ?? null } }));
  return org;
}

// ---------- usage metering ----------

export function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodBounds(period: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw validation("Period must be YYYY-MM");
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(y, mo, 1)), end: new Date(Date.UTC(y, mo + 1, 1)) };
}

export interface MeasuredUsage {
  period: string;
  agents: number;
  members: number;
  monthlyDecisions: number;
  approvalsDecided: number;
  evidenceEvents: number;
}

/** Usage measured from the organization's own records. Attack Simulation Lab traffic is never counted. */
export async function measureUsage(db: TenantDb, orgId: string, period: string): Promise<MeasuredUsage> {
  const { start, end } = periodBounds(period);
  const [agents, members, monthlyDecisions, approvalsDecided, evidenceEvents] = await Promise.all([
    db.agent.count({ where: { orgId, isLab: false, status: { not: "archived" } } }),
    db.membership.count({ where: { orgId, status: "active" } }),
    db.authorizationDecision.count({ where: { orgId, createdAt: { gte: start, lt: end }, request: { agent: { isLab: false } } } }),
    db.approvalRequest.count({ where: { orgId, status: { in: ["approved", "rejected"] }, updatedAt: { gte: start, lt: end }, request: { agent: { isLab: false } } } }),
    db.evidenceEvent.count({ where: { orgId, occurredAt: { gte: start, lt: end } } }),
  ]);
  return { period, agents, members, monthlyDecisions, approvalsDecided, evidenceEvents };
}

/** Records the period's usage. Idempotent: one row per organization, period and metric, overwritten with the latest count. */
export async function snapshotUsage(db: TenantDb, orgId: string, period: string, now = new Date()) {
  const u = await measureUsage(db, orgId, period);
  const metrics: [string, number][] = [["agents", u.agents], ["members", u.members], ["monthly_decisions", u.monthlyDecisions], ["approvals_decided", u.approvalsDecided], ["evidence_events", u.evidenceEvents]];
  for (const [metric, value] of metrics) {
    await db.usageRecord.upsert({ where: { orgId_period_metric: { orgId, period, metric } }, create: { orgId, period, metric, value: BigInt(value), computedAt: now }, update: { value: BigInt(value), computedAt: now } });
  }
  return u;
}

async function activeContract(db: TenantDb, orgId: string) {
  return db.commercialContract.findFirst({ where: { orgId, active: true }, orderBy: { createdAt: "desc" } });
}

function limitOverrides(raw: unknown): Partial<PlanLimits> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: Partial<PlanLimits> = {};
  for (const k of ["agents", "members", "monthlyDecisions"] as const) if (k in o && (o[k] === null || typeof o[k] === "number")) out[k] = o[k] as number | null;
  return out;
}

/** What an organization's people see on the Billing page. */
export async function subscriptionSummary(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "org:read");
  const now = ctx.now ?? new Date();
  const org = await rawPrisma().organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { plan: true, trialEndsAt: true } });
  const plan = normalizePlan(org.plan);
  const contract = await activeContract(db, ctx.orgId);
  const period = periodOf(now);
  const usage = await measureUsage(db, ctx.orgId, period);
  const limits = effectiveLimits(plan, contract ? limitOverrides(contract.limits) : null);
  const invoices = await db.invoice.findMany({ where: { orgId: ctx.orgId, status: { in: ["issued", "paid"] } }, orderBy: { issuedAt: "desc" }, take: 24 });
  return {
    plan: PLANS[plan],
    trial: trialState(plan, org.trialEndsAt, now),
    period,
    usage,
    lines: usageAgainstLimits(limits, usage),
    contract: contract ? contractView(contract) : null,
    invoices: invoices.map(invoiceView),
  };
}

// ---------- contracts ----------

const money = z.coerce.number().min(0).max(1e12);

export const contractSchema = z
  .object({
    plan: z.enum(["core", "secure", "enterprise"]),
    termStart: z.coerce.date(),
    termEnd: z.coerce.date(),
    billingPeriod: z.enum(["monthly", "quarterly", "annual"]).default("monthly"),
    currency: z.string().regex(/^[A-Z]{3}$/).default("AED"),
    periodFee: money,
    includedDecisions: z.coerce.number().int().min(0).nullable().default(null),
    overageUnitPrice: z.coerce.number().min(0).max(1000).nullable().default(null),
    taxRatePercent: z.coerce.number().min(0).max(100).default(0),
    paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
    purchaseOrder: z.string().trim().max(120).optional(),
    limits: z.object({ agents: z.number().int().positive().nullable().optional(), members: z.number().int().positive().nullable().optional(), monthlyDecisions: z.number().int().positive().nullable().optional() }).default({}),
    notes: z.string().max(2000).default(""),
  })
  .refine((c) => c.termEnd > c.termStart, { message: "The term must end after it starts", path: ["termEnd"] });

/** Major units to minor units without floating-point drift (2 decimal places). */
export function toMinor(major: number): bigint {
  return BigInt(Math.round(major * 100));
}

export async function platformSetContract(actorUserId: string, orgId: string, raw: unknown) {
  await assertPlatformAdmin(actorUserId);
  const c = contractSchema.parse(raw);
  return withTenant(orgId, async (db) => {
    const ctx = platformCtx(orgId, actorUserId);
    await db.commercialContract.updateMany({ where: { orgId, active: true }, data: { active: false } });
    const row = await db.commercialContract.create({
      data: {
        orgId,
        plan: c.plan,
        termStart: c.termStart,
        termEnd: c.termEnd,
        billingPeriod: c.billingPeriod,
        currency: c.currency,
        periodFeeMinor: toMinor(c.periodFee),
        includedDecisions: c.includedDecisions,
        overageUnitPrice4: c.overageUnitPrice === null ? null : BigInt(Math.round(c.overageUnitPrice * 10_000)),
        taxRateBp: Math.round(c.taxRatePercent * 100),
        paymentTermsDays: c.paymentTermsDays,
        purchaseOrder: c.purchaseOrder || null,
        limits: c.limits,
        notes: c.notes,
        createdBy: actorUserId,
      },
    });
    await rawPrisma().organization.update({ where: { id: orgId }, data: { plan: c.plan, trialEndsAt: null } });
    await appendEvidence(db, ctx, { type: "contract.recorded", subjectType: "contract", subjectId: row.id, payload: { plan: c.plan, termStart: c.termStart.toISOString(), termEnd: c.termEnd.toISOString(), billingPeriod: c.billingPeriod, currency: c.currency } });
    return contractView(row);
  });
}

type ContractRow = NonNullable<Awaited<ReturnType<typeof activeContract>>>;

export function contractView(c: ContractRow) {
  return {
    id: c.id,
    plan: normalizePlan(c.plan) as PlanKey,
    active: c.active,
    termStart: c.termStart,
    termEnd: c.termEnd,
    billingPeriod: c.billingPeriod,
    currency: c.currency,
    periodFee: Number(c.periodFeeMinor) / 100,
    includedDecisions: c.includedDecisions,
    overageUnitPrice: c.overageUnitPrice4 === null ? null : Number(c.overageUnitPrice4) / 10_000,
    taxRatePercent: c.taxRateBp / 100,
    paymentTermsDays: c.paymentTermsDays,
    purchaseOrder: c.purchaseOrder,
    limits: limitOverrides(c.limits),
    notes: c.notes,
  };
}

// ---------- invoices ----------

export interface InvoiceLine {
  description: string;
  quantity: number;
  /** Unit price in ten-thousandths of the major unit, so per-decision prices keep their precision. */
  unitPrice4: string;
  amountMinor: string;
}

/** Pure: the lines and totals for one period. All arithmetic is in integers. */
export function computeInvoice(input: { periodFeeMinor: bigint; includedDecisions: number | null; overageUnitPrice4: bigint | null; decisionsUsed: number; taxRateBp: number; periodLabel: string; planName: string }) {
  const lines: InvoiceLine[] = [{ description: `${input.planName} plan, ${input.periodLabel}`, quantity: 1, unitPrice4: (input.periodFeeMinor * 100n).toString(), amountMinor: input.periodFeeMinor.toString() }];
  let subtotal = input.periodFeeMinor;
  if (input.includedDecisions !== null && input.overageUnitPrice4 !== null && input.decisionsUsed > input.includedDecisions) {
    const over = BigInt(input.decisionsUsed - input.includedDecisions);
    // price4 is 1/10000 of the major unit; minor is 1/100, so divide by 100 with half-up rounding.
    const amount = (over * input.overageUnitPrice4 + 50n) / 100n;
    lines.push({ description: `Gateway decisions above the ${input.includedDecisions.toLocaleString("en-GB")} included`, quantity: Number(over), unitPrice4: input.overageUnitPrice4.toString(), amountMinor: amount.toString() });
    subtotal += amount;
  }
  const tax = (subtotal * BigInt(input.taxRateBp) + 5000n) / 10_000n;
  return { lines, subtotalMinor: subtotal, taxMinor: tax, totalMinor: subtotal + tax };
}

export async function platformDraftInvoice(actorUserId: string, orgId: string, input: { period: string }) {
  await assertPlatformAdmin(actorUserId);
  return withTenant(orgId, async (db) => {
    const contract = await activeContract(db, orgId);
    if (!contract) throw validation("Record a contract before drafting an invoice");
    const { start, end } = periodBounds(input.period);
    const existing = await db.invoice.findFirst({ where: { orgId, periodStart: start, status: { not: "void" } } });
    if (existing) throw conflict(`Invoice ${existing.number} already covers ${input.period}`);
    const usage = await snapshotUsage(db, orgId, input.period);
    const computed = computeInvoice({ periodFeeMinor: contract.periodFeeMinor, includedDecisions: contract.includedDecisions, overageUnitPrice4: contract.overageUnitPrice4, decisionsUsed: usage.monthlyDecisions, taxRateBp: contract.taxRateBp, periodLabel: input.period, planName: PLANS[normalizePlan(contract.plan)].name });
    const count = await db.invoice.count({ where: { orgId } });
    const org = await rawPrisma().organization.findUniqueOrThrow({ where: { id: orgId }, select: { slug: true } });
    const number = `${org.slug.slice(0, 12).toUpperCase()}-${input.period.replace("-", "")}-${String(count + 1).padStart(3, "0")}`;
    const row = await db.invoice.create({ data: { orgId, contractId: contract.id, number, periodStart: start, periodEnd: end, currency: contract.currency, lines: computed.lines as unknown as object, subtotalMinor: computed.subtotalMinor, taxMinor: computed.taxMinor, totalMinor: computed.totalMinor, createdBy: actorUserId } });
    await appendEvidence(db, platformCtx(orgId, actorUserId), { type: "invoice.drafted", subjectType: "invoice", subjectId: row.id, payload: { number, period: input.period, totalMinor: computed.totalMinor.toString(), currency: contract.currency } });
    return invoiceView(row);
  });
}

export const invoiceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("issue") }),
  z.object({ action: z.literal("mark_paid"), paymentReference: z.string().trim().min(2).max(120), paidAt: z.coerce.date().optional() }),
  z.object({ action: z.literal("void"), reason: z.string().trim().min(5).max(500) }),
]);

/** Draft to issued to paid, or to void. Amounts never change after drafting; a mistake is voided and redrafted. */
export async function platformInvoiceAction(actorUserId: string, orgId: string, invoiceId: string, raw: z.input<typeof invoiceActionSchema>, now = new Date()) {
  await assertPlatformAdmin(actorUserId);
  const a = invoiceActionSchema.parse(raw);
  return withTenant(orgId, async (db) => {
    const inv = await db.invoice.findFirst({ where: { id: invoiceId, orgId }, include: { contract: true } });
    if (!inv) throw notFound("Invoice");
    let data: Record<string, unknown>;
    if (a.action === "issue") {
      if (inv.status !== "draft") throw conflict(`Only a draft can be issued; this invoice is ${inv.status}`);
      data = { status: "issued", issuedAt: now, dueAt: new Date(now.getTime() + inv.contract.paymentTermsDays * 86_400_000) };
    } else if (a.action === "mark_paid") {
      if (inv.status !== "issued") throw conflict(`Only an issued invoice can be marked paid; this invoice is ${inv.status}`);
      data = { status: "paid", paidAt: a.paidAt ?? now, paymentReference: a.paymentReference };
    } else {
      if (inv.status === "void" || inv.status === "paid") throw conflict(`A ${inv.status} invoice cannot be voided`);
      data = { status: "void", voidReason: a.reason };
    }
    const row = await db.invoice.update({ where: { id: inv.id }, data });
    await appendEvidence(db, platformCtx(orgId, actorUserId), { type: `invoice.${a.action === "mark_paid" ? "paid" : a.action === "issue" ? "issued" : "voided"}`, subjectType: "invoice", subjectId: inv.id, payload: { number: inv.number, ...(a.action === "void" ? { reason: a.reason } : {}), ...(a.action === "mark_paid" ? { reference: a.paymentReference } : {}) } });
    return invoiceView(row);
  });
}

type InvoiceRow = Awaited<ReturnType<TenantDb["invoice"]["create"]>>;

export function invoiceView(i: InvoiceRow) {
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    currency: i.currency,
    lines: (i.lines as unknown as InvoiceLine[]).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: Number(l.unitPrice4) / 10_000, amount: Number(l.amountMinor) / 100 })),
    subtotal: Number(i.subtotalMinor) / 100,
    tax: Number(i.taxMinor) / 100,
    total: Number(i.totalMinor) / 100,
    issuedAt: i.issuedAt,
    dueAt: i.dueAt,
    paidAt: i.paidAt,
    paymentReference: i.paymentReference,
    voidReason: i.voidReason,
  };
}

/** An organization's people may open their own issued and paid invoices; drafts stay with the provider. */
export async function getInvoiceForOrg(db: TenantDb, ctx: OrgContext, invoiceId: string) {
  assertPermission(ctx, "org:read");
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, orgId: ctx.orgId, status: { in: ["issued", "paid", "void"] } } });
  if (!inv) throw notFound("Invoice");
  return invoiceView(inv);
}

// ---------- support requests ----------

export const supportRequestSchema = z.object({
  subject: z.string().trim().min(4).max(160),
  body: z.string().trim().min(10).max(5000),
  severity: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export async function createSupportRequest(db: TenantDb, ctx: OrgContext, raw: z.input<typeof supportRequestSchema>) {
  assertPermission(ctx, "org:read");
  if (ctx.actor.type !== "user" || !ctx.actor.id) throw forbidden("Support requests come from people");
  const input = supportRequestSchema.parse(raw);
  const row = await db.supportRequest.create({ data: { orgId: ctx.orgId, createdBy: ctx.actor.id, subject: input.subject, body: input.body, severity: input.severity } });
  await appendEvidence(db, ctx, { type: "support.requested", subjectType: "support_request", subjectId: row.id, payload: { severity: input.severity } });
  await rawPrisma().platformEvent.create({ data: { type: "support.requested", actorId: ctx.actor.id, orgId: ctx.orgId, detail: { supportRequestId: row.id, severity: input.severity } } });
  return row;
}

export async function listSupportRequests(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "org:read");
  return db.supportRequest.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 100 });
}

export const supportUpdateSchema = z.object({ status: z.enum(["open", "in_progress", "resolved"]), resolution: z.string().trim().max(5000).default("") }).refine((s) => s.status !== "resolved" || s.resolution.length >= 5, { message: "Say how it was resolved", path: ["resolution"] });

export async function platformUpdateSupportRequest(actorUserId: string, orgId: string, id: string, raw: z.input<typeof supportUpdateSchema>, now = new Date()) {
  await assertPlatformAdmin(actorUserId);
  const input = supportUpdateSchema.parse(raw);
  return withTenant(orgId, async (db) => {
    const row = await db.supportRequest.findFirst({ where: { id, orgId } });
    if (!row) throw notFound("Support request");
    const updated = await db.supportRequest.update({ where: { id }, data: { status: input.status, resolution: input.resolution, resolvedAt: input.status === "resolved" ? now : null } });
    await appendEvidence(db, platformCtx(orgId, actorUserId), { type: "support.updated", subjectType: "support_request", subjectId: id, payload: { status: input.status } });
    return updated;
  });
}

// ---------- customer success ----------

export interface CustomerHealth {
  orgId: string;
  name: string;
  slug: string;
  plan: PlanKey;
  demoMode: boolean;
  trial: ReturnType<typeof trialState>;
  onboarding: { done: number; total: number };
  integrations: { active: number; failing: number };
  policyCoverage: { enforced: number; total: number };
  agentAdoption: { active: number; acting: number };
  enforcement: { decisions: number; refused: number; approvals: number };
  incidents: { last30: number; previous30: number };
  support: { open: number; urgent: number };
}

/** One customer's health, computed from its own records over the last 30 days. Lab traffic excluded. */
export async function customerHealth(db: TenantDb, org: { id: string; name: string; slug: string; plan: string; demoMode: boolean; trialEndsAt: Date | null; settings: unknown }, now = new Date()): Promise<CustomerHealth> {
  const orgId = org.id;
  const d30 = new Date(now.getTime() - 30 * 86_400_000);
  const d60 = new Date(now.getTime() - 60 * 86_400_000);
  const ctx = makeContext(orgId, { type: "system", id: null, label: "customer-success" }, { now });
  const { computeOnboarding, summarizeOnboarding } = await import("../onboarding/checklist.js");
  const { policyEnforcement } = await import("../policy/insights.js");
  const [steps, integrations, enforcement, activeAgents, acting, decisions, refused, approvals, inc30, incPrev, supportOpen, supportUrgent] = await Promise.all([
    computeOnboarding(db, ctx),
    db.integration.findMany({ where: { orgId, status: "active" }, select: { lastHealthOk: true } }),
    policyEnforcement(db, ctx),
    db.agent.count({ where: { orgId, isLab: false, status: "active" } }),
    db.actionRequest.groupBy({ by: ["agentId"], where: { orgId, createdAt: { gte: d30 }, agent: { isLab: false } } }),
    db.authorizationDecision.count({ where: { orgId, createdAt: { gte: d30 }, request: { agent: { isLab: false } } } }),
    db.authorizationDecision.count({ where: { orgId, createdAt: { gte: d30 }, result: "deny", request: { agent: { isLab: false } } } }),
    db.approvalRequest.count({ where: { orgId, createdAt: { gte: d30 }, request: { agent: { isLab: false } } } }),
    db.incident.count({ where: { orgId, createdAt: { gte: d30 } } }),
    db.incident.count({ where: { orgId, createdAt: { gte: d60, lt: d30 } } }),
    db.supportRequest.count({ where: { orgId, status: { not: "resolved" } } }),
    db.supportRequest.count({ where: { orgId, status: { not: "resolved" }, severity: "urgent" } }),
  ]);
  const summary = summarizeOnboarding(steps, (org.settings ?? {}) as Record<string, unknown>);
  const states = [...enforcement.values()];
  const plan = normalizePlan(org.plan);
  return {
    orgId,
    name: org.name,
    slug: org.slug,
    plan,
    demoMode: org.demoMode,
    trial: trialState(plan, org.trialEndsAt, now),
    onboarding: { done: summary.done, total: summary.total },
    integrations: { active: integrations.length, failing: integrations.filter((i) => i.lastHealthOk === false).length },
    policyCoverage: { enforced: states.filter((s) => s.state === "enforced").length, total: states.length },
    agentAdoption: { active: activeAgents, acting: acting.length },
    enforcement: { decisions, refused, approvals },
    incidents: { last30: inc30, previous30: incPrev },
    support: { open: supportOpen, urgent: supportUrgent },
  };
}

export async function platformCustomerOverview(actorUserId: string, now = new Date()) {
  await assertPlatformAdmin(actorUserId);
  await rawPrisma().platformEvent.create({ data: { type: "platform.customers_viewed", actorId: actorUserId } });
  const orgs = await rawPrisma().organization.findMany({ orderBy: { createdAt: "asc" } });
  const out: CustomerHealth[] = [];
  for (const o of orgs) out.push(await withTenant(o.id, (db) => customerHealth(db, o, now), { readOnly: true, lock: "lazy", timeout: 30_000 }));
  return out;
}

export async function platformCustomerDetail(actorUserId: string, orgId: string, now = new Date()) {
  await assertPlatformAdmin(actorUserId);
  const org = await rawPrisma().organization.findUnique({ where: { id: orgId } });
  if (!org) throw notFound("Organization");
  return withTenant(
    orgId,
    async (db) => {
      const health = await customerHealth(db, org, now);
      const contract = await activeContract(db, orgId);
      const period = periodOf(now);
      const usage = await measureUsage(db, orgId, period);
      const plan = normalizePlan(org.plan);
      const history = await db.usageRecord.findMany({ where: { orgId }, orderBy: [{ period: "desc" }, { metric: "asc" }], take: 60 });
      const invoices = await db.invoice.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 50 });
      const support = await db.supportRequest.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 50 });
      return {
        org: { id: org.id, name: org.name, slug: org.slug, demoMode: org.demoMode, trialEndsAt: org.trialEndsAt },
        health,
        contract: contract ? contractView(contract) : null,
        period,
        lines: usageAgainstLimits(effectiveLimits(plan, contract ? limitOverrides(contract.limits) : null), usage),
        usageHistory: history.map((h) => ({ period: h.period, metric: h.metric, value: Number(h.value) })),
        invoices: invoices.map(invoiceView),
        support,
      };
    },
    { timeout: 30_000 },
  );
}
