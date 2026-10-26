// Billing: the lines one family owes for one instalment, and billing runs that invoice every family in batches.
// A run is processed by the worker ("fees" queue), BILLING_BATCH accounts per transaction. Each batch moves a cursor
// on the run, and an invoice is unique per (run, account), so a crashed or repeated batch never bills twice and a
// stopped run resumes where it left off.
import type { BillingRun, FeeAward, FeeDiscount, FeeItem, InstalmentPart, InstalmentPlan, Prisma } from "@prisma/client";
import type { Effect, ExecCtx, Tx } from "@/server/db";
import { loadFinanceConfig, taxInvoiceBlockers, type FinanceConfig } from "./config";
import { FeeError, issueInvoice, type Actor } from "./ledger";
import { computeLine, instalmentAmount, prorataFraction, siblingBp, siblingOrder, totalsOf, type DiscountRule, type LineInput } from "./money";
import { notifyInvoiceIssued } from "./notices";

export const BILLING_BATCH = 25;
export const FEES_QUEUE = "fees";

export type BillingStudent = {
  id: string;
  firstNameEn: string;
  lastNameEn: string;
  firstNameAr: string;
  lastNameAr: string;
  gradeLevel: number;
  dateOfBirth: Date | null;
  studentNo: string;
  enrolledOn: Date | null;
  transportZone: string | null;
};

export type PartWithShare = InstalmentPart & { cumBpBefore: number };

export type BillingInputs = {
  cfg: FinanceConfig;
  items: FeeItem[];
  part: PartWithShare;
  awards: Array<FeeAward & { discount: FeeDiscount }>;
};

const nameOf = (s: BillingStudent) => ({ en: `${s.firstNameEn} ${s.lastNameEn}`, ar: `${s.firstNameAr} ${s.lastNameAr}` });

function awardRule(a: FeeAward & { discount: FeeDiscount }, part: PartWithShare): DiscountRule {
  const d = a.discount;
  return {
    kind: d.kind,
    method: d.method,
    percentBp: d.percentBp,
    // A fixed award is an annual amount: each instalment gets its share, like the fee.
    amountFils: d.method === "FIXED" ? instalmentAmount(d.amountFils ?? 0, part.cumBpBefore, part.shareBp) : null,
    labelEn: d.nameEn,
    labelAr: d.nameAr,
  };
}

/**
 * Lines for one family and one instalment: tuition by grade and transport by zone (each the instalment's share of
 * the annual fee, pro rata for children who joined during the period), one-off items billed automatically on the
 * first instalment, with award and sibling discounts on discountable items. Children are taken eldest first.
 */
export function buildAccountLines(students: BillingStudent[], inputs: BillingInputs): LineInput[] {
  const { cfg, items, part } = inputs;
  const rule = { basis: cfg.proRataBasis, cutoffDay: cfg.proRataCutoffDay };
  const period = { start: part.periodStart, end: part.periodEnd };
  const lines: LineInput[] = [];
  const tuitionFor = (g: number) => items.find((i) => i.active && i.kind === "TUITION" && i.autoBill && i.gradeLevels.includes(g));
  // Sibling position counts children who are billed tuition in this period.
  const billed = siblingOrder(students).filter((s) => {
    const t = tuitionFor(s.gradeLevel);
    return t && (!t.proRata || prorataFraction(period, s.enrolledOn, null, rule).num > 0);
  });
  const ordered = siblingOrder(students);
  for (const s of ordered) {
    const name = nameOf(s);
    const position = billed.findIndex((b) => b.id === s.id) + 1;
    const studentAwards = inputs.awards.filter((a) => a.studentId === s.id && a.status === "APPROVED" && a.discount.active);
    const auto = items.filter(
      (i) =>
        i.active &&
        i.autoBill &&
        (i.gradeLevels.length === 0 || i.gradeLevels.includes(s.gradeLevel)) &&
        (i.kind !== "TRANSPORT" || (s.transportZone !== null && i.zone === s.transportZone)) &&
        (i.kind !== "TUITION" || i.gradeLevels.includes(s.gradeLevel)),
    );
    for (const item of auto) {
      if (!item.recurring && part.seq !== 1) continue;
      const unit = item.recurring ? instalmentAmount(item.amountFils, part.cumBpBefore, part.shareBp) : item.amountFils;
      if (unit <= 0) continue;
      const fraction = item.recurring && item.proRata ? prorataFraction(period, s.enrolledOn, null, rule) : { num: 1, den: 1 };
      if (fraction.num === 0) continue;
      const discounts: DiscountRule[] = [];
      if (item.discountable) {
        for (const a of studentAwards) discounts.push(awardRule(a, part));
        const sib = item.kind === "TUITION" ? siblingBp(position, cfg) : 0;
        if (sib > 0) discounts.push({ kind: "SIBLING", method: "PERCENT", percentBp: sib, labelEn: `Sibling discount (child ${position})`, labelAr: `خصم الأخوة (الطفل ${position})` });
      }
      const label = item.recurring ? { en: `, ${part.labelEn}`, ar: `، ${part.labelAr}` } : { en: "", ar: "" };
      const prorataNote = fraction.num !== fraction.den ? { en: ` (pro rata ${fraction.num}/${fraction.den})`, ar: ` (بالتناسب ${fraction.num}/${fraction.den})` } : { en: "", ar: "" };
      lines.push({
        studentId: s.id,
        feeItemId: item.id,
        kind: item.kind,
        descriptionEn: `${item.nameEn}${label.en}${prorataNote.en}: ${name.en}`,
        descriptionAr: `${item.nameAr}${label.ar}${prorataNote.ar}: ${name.ar}`,
        quantity: 1,
        unitFils: unit,
        vatTreatment: item.vatTreatment,
        prorata: fraction,
        discounts,
      });
    }
  }
  return lines;
}

/** Lines for one-off charges waiting on the account (uniform, books, trips, exams). */
export function chargeLines(
  charges: Array<{ id: string; studentId: string | null; feeItemId: string; quantity: number; unitFils: number; descriptionEn: string | null; descriptionAr: string | null }>,
  items: Array<Pick<FeeItem, "id" | "kind" | "nameEn" | "nameAr" | "vatTreatment">>,
  students: BillingStudent[],
): LineInput[] {
  const out: LineInput[] = [];
  for (const c of charges) {
    const item = items.find((i) => i.id === c.feeItemId);
    if (!item) continue;
    const s = students.find((x) => x.id === c.studentId);
    const who = s ? nameOf(s) : null;
    out.push({
      studentId: c.studentId,
      feeItemId: item.id,
      kind: item.kind,
      descriptionEn: `${c.descriptionEn?.trim() || item.nameEn}${who ? `: ${who.en}` : ""}`,
      descriptionAr: `${c.descriptionAr?.trim() || item.nameAr}${who ? `: ${who.ar}` : ""}`,
      quantity: c.quantity,
      unitFils: c.unitFils,
      vatTreatment: item.vatTreatment,
    });
  }
  return out;
}

/** The instalment with its cumulative share (parts before it), for exact instalment amounts. */
export async function partWithShare(tx: Tx, orgId: string, partId: string): Promise<{ part: PartWithShare; plan: InstalmentPlan & { parts: InstalmentPart[] } }> {
  const part = await tx.instalmentPart.findFirst({ where: { id: partId, orgId } });
  if (!part) throw new FeeError("NOT_FOUND");
  const plan = await tx.instalmentPlan.findFirstOrThrow({ where: { id: part.planId, orgId }, include: { parts: { orderBy: { seq: "asc" } } } });
  const cumBpBefore = plan.parts.filter((p) => p.seq < part.seq).reduce((s, p) => s + p.shareBp, 0);
  return { part: { ...part, cumBpBefore }, plan };
}

/** Which family accounts a plan bills: those that chose it, plus those with no choice when it is the default. */
export function accountsForPlanWhere(orgId: string, plan: Pick<InstalmentPlan, "key" | "isDefault">): Prisma.FeeAccountWhereInput {
  return {
    orgId,
    students: { some: {} },
    OR: plan.isDefault ? [{ planKey: plan.key }, { planKey: null }] : [{ planKey: plan.key }],
  };
}

async function studentsOf(tx: Tx, orgId: string, accountIds: string[]) {
  const profiles = await tx.studentFeeProfile.findMany({ where: { orgId, accountId: { in: accountIds } } });
  const students = await tx.student.findMany({
    where: { orgId, id: { in: profiles.map((p) => p.studentId) }, status: "ACTIVE" },
    select: { id: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true, gradeLevel: true, dateOfBirth: true, studentNo: true, enrolledOn: true },
  });
  const byAccount = new Map<string, BillingStudent[]>();
  for (const p of profiles) {
    const s = students.find((x) => x.id === p.studentId);
    if (!s) continue;
    if (!byAccount.has(p.accountId)) byAccount.set(p.accountId, []);
    byAccount.get(p.accountId)!.push({ ...s, transportZone: p.transportZone });
  }
  return byAccount;
}

/** The lines one family would be billed for one instalment, and the charges they would use up. */
async function accountBillLines(
  tx: Tx,
  orgId: string,
  input: { accountId: string; part: PartWithShare; includeCharges: boolean; academicYearId: string },
  cache?: { cfg: FinanceConfig; items: FeeItem[] },
) {
  const cfg = cache?.cfg ?? (await loadFinanceConfig(tx, orgId));
  const items = cache?.items ?? (await tx.feeItem.findMany({ where: { orgId, academicYearId: input.academicYearId } }));
  const students = (await studentsOf(tx, orgId, [input.accountId])).get(input.accountId) ?? [];
  const awards = students.length
    ? await tx.feeAward.findMany({ where: { orgId, academicYearId: input.academicYearId, studentId: { in: students.map((s) => s.id) }, status: "APPROVED" }, include: { discount: true } })
    : [];
  const charges = input.includeCharges ? await tx.feeCharge.findMany({ where: { orgId, accountId: input.accountId, invoiceId: null }, orderBy: { createdAt: "asc" } }) : [];
  const chargeItems = charges.length ? await tx.feeItem.findMany({ where: { orgId, id: { in: charges.map((c) => c.feeItemId) } } }) : [];
  const lines = [...buildAccountLines(students, { cfg, items, part: input.part, awards }), ...chargeLines(charges, chargeItems, students)];
  return { cfg, lines, charges };
}

/** What one family would be billed for an instalment, without issuing anything (same maths as the invoice). */
export async function previewAccountBill(tx: Tx, orgId: string, input: { accountId: string; part: PartWithShare; includeCharges: boolean; academicYearId: string }) {
  const { cfg, lines } = await accountBillLines(tx, orgId, input);
  return totalsOf(lines.map((l, i) => computeLine(l, i + 1, cfg)));
}

/** Bill one family for one instalment (also used outside runs, for a single family). Returns null when nothing is owed. */
export async function billAccount(
  tx: Tx,
  orgId: string,
  input: { accountId: string; part: PartWithShare; issueDate: Date; dueDate: Date; includeCharges: boolean; billingRunId?: string | null; academicYearId: string },
  actor: Actor,
  cache?: { cfg: FinanceConfig; items: FeeItem[] },
) {
  const { cfg, lines, charges } = await accountBillLines(tx, orgId, input, cache);
  if (!lines.length) return null;
  try {
    return await issueInvoice(
      tx,
      orgId,
      {
        kind: "TAX",
        accountId: input.accountId,
        academicYearId: input.academicYearId,
        billingRunId: input.billingRunId ?? null,
        planPartId: input.part.id,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        period: { start: input.part.periodStart, end: input.part.periodEnd, labelEn: input.part.labelEn, labelAr: input.part.labelAr },
        lines,
        chargeIds: charges.map((c) => c.id),
      },
      actor,
      cfg,
    );
  } catch (e) {
    // A fully discounted family (for example a 100% scholarship) owes nothing for this instalment.
    if (e instanceof FeeError && e.code === "ZERO_TOTAL") return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Billing runs
// ---------------------------------------------------------------------------------------------

export function billingJob(orgId: string, runId: string, n: number): Effect {
  return { kind: "job", queue: FEES_QUEUE, name: "billing.batch", data: { orgId, runId, n }, jobId: `fees-billing-${runId}-${n}` };
}

/** Create a run for one instalment. The caller flushes the returned effect after commit (or runs it inline). */
export async function createBillingRun(
  tx: Tx,
  orgId: string,
  input: { partId: string; issueDate: Date; dueDate: Date; includeCharges: boolean },
  actor: Actor,
): Promise<{ run: BillingRun; effect: Effect }> {
  const cfg = await loadFinanceConfig(tx, orgId);
  if (taxInvoiceBlockers(cfg).length) throw new FeeError("TAX_SETUP_INCOMPLETE");
  const { part, plan } = await partWithShare(tx, orgId, input.partId);
  const active = await tx.billingRun.findFirst({ where: { orgId, partId: part.id, status: { in: ["QUEUED", "RUNNING"] } } });
  if (active) throw new FeeError("RUN_IN_PROGRESS");
  const totalAccounts = await tx.feeAccount.count({ where: accountsForPlanWhere(orgId, plan) });
  if (!totalAccounts) throw new FeeError("NO_ACCOUNTS");
  const run = await tx.billingRun.create({
    data: {
      orgId,
      academicYearId: plan.academicYearId,
      planId: plan.id,
      partId: part.id,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      includeCharges: input.includeCharges,
      totalAccounts,
      createdById: actor.membershipId,
    },
  });
  await tx.auditEvent.create({
    data: { orgId, actorId: actor.membershipId, actorUserId: actor.userId, action: "fees.billing_run.start", entityType: "BillingRun", entityId: run.id, meta: { part: part.labelEn, plan: plan.key, totalAccounts } },
  });
  return { run, effect: billingJob(orgId, run.id, 1) };
}

/**
 * Process the next batch of a run. Locks the run row, so two workers never process the same run at once.
 * Returns done when the run has no accounts left (or was cancelled or failed).
 */
export async function processBillingBatch(ec: ExecCtx, runId: string, opts: { batchSize?: number; notifyFamilies?: boolean } = {}): Promise<{ done: boolean; created: number }> {
  const { tx, orgId, now } = ec;
  const batchSize = opts.batchSize ?? BILLING_BATCH;
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "BillingRun" WHERE "id" = ${runId} AND "orgId" = ${orgId} FOR UPDATE`;
  if (!locked.length) return { done: true, created: 0 };
  const run = await tx.billingRun.findFirstOrThrow({ where: { id: runId, orgId } });
  if (run.status !== "QUEUED" && run.status !== "RUNNING") return { done: true, created: 0 };
  const { part, plan } = await partWithShare(tx, orgId, run.partId);
  const cfg = await loadFinanceConfig(tx, orgId);
  const items = await tx.feeItem.findMany({ where: { orgId, academicYearId: run.academicYearId } });
  const accounts = await tx.feeAccount.findMany({
    where: { ...accountsForPlanWhere(orgId, plan), ...(run.cursor ? { id: { gt: run.cursor } } : {}) },
    orderBy: { id: "asc" },
    take: batchSize,
    select: { id: true },
  });
  let created = 0;
  let skipped = 0;
  let totalFils = 0;
  const actor: Actor = { membershipId: run.createdById, userId: null };
  for (const a of accounts) {
    const exists = await tx.invoice.findFirst({ where: { orgId, billingRunId: run.id, accountId: a.id }, select: { id: true } });
    if (exists) continue;
    const inv = await billAccount(
      tx,
      orgId,
      { accountId: a.id, part, issueDate: run.issueDate, dueDate: run.dueDate, includeCharges: run.includeCharges, billingRunId: run.id, academicYearId: run.academicYearId },
      actor,
      { cfg, items },
    );
    if (inv) {
      created++;
      totalFils += inv.totalFils;
      if (opts.notifyFamilies !== false) await notifyInvoiceIssued(ec, inv);
    } else skipped++;
  }
  const done = accounts.length < batchSize;
  await tx.billingRun.update({
    where: { id: run.id },
    data: {
      status: done ? "COMPLETED" : "RUNNING",
      startedAt: run.startedAt ?? now,
      finishedAt: done ? now : null,
      cursor: accounts.length ? accounts[accounts.length - 1].id : run.cursor,
      processed: { increment: accounts.length },
      invoicesCreated: { increment: created },
      skipped: { increment: skipped },
      totalFils: { increment: totalFils },
    },
  });
  if (done) {
    await tx.auditEvent.create({
      data: { orgId, actorId: run.createdById, action: "fees.billing_run.complete", entityType: "BillingRun", entityId: run.id, meta: { invoices: run.invoicesCreated + created, totalFils: run.totalFils + totalFils } },
    });
  }
  return { done, created };
}
