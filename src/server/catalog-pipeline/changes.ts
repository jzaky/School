// Change monitor: review of RequirementChange rows and the staff notification that follows.
// A change starts NEEDS_REVIEW. A reviewer marks it reviewed (confirmed) or dismissed (extractor noise);
// both set status ACKNOWLEDGED and keep the outcome in diff.review. Only a confirmed change notifies staff
// who have students with the program on a shortlist, in a course plan or in an application, in every school.
// Students and parents are never notified automatically: the counselor decides what to tell them.
// Notifications are in-app only, with an idempotency key per (change, recipient) held in JobRun.
import type { Prisma, PrismaClient } from "@prisma/client";
import { tenantTx, type TenantDb } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { execCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { CatalogAccessError, assertCatalogWrite, type CatalogActor } from "@/server/platform/catalog-db";
import type { ChangeDiff } from "./types";

export const CHANGE_TEMPLATE = "catalog_requirement_change";
const STAFF_PERMS = ["planner.approve", "applications.manage", "pathways.manage"];

export type ChangeDeps = { catalog: PrismaClient; tenant: TenantDb; actor: CatalogActor; now?: Date; writable?: boolean };

/** Bilingual in-app template, created in an organization the first time it is needed. */
export const CHANGE_TEMPLATE_TEXT = {
  subjectEn: "Entry requirements changed: {{program}}",
  subjectAr: "تغيّرت متطلبات القبول: {{program}}",
  bodyEn: "{{university}}: {{summaryEn}}. {{count}} of your school's students have this programme on a shortlist, plan or application. Decide whether to tell them.",
  bodyAr: "{{university}}: {{summaryAr}}. لدى {{count}} من طلاب المدرسة هذا البرنامج في قائمة مختصرة أو خطة أو طلب. قرّر ما إذا كنت ستبلغهم.",
};

async function ensureTemplate(tx: Prisma.TransactionClient, orgId: string) {
  for (const channel of ["EMAIL", "IN_APP"] as const) {
    await tx.messageTemplate.upsert({
      where: { orgId_key_channel: { orgId, key: CHANGE_TEMPLATE, channel } },
      create: { orgId, key: CHANGE_TEMPLATE, channel, ...CHANGE_TEMPLATE_TEXT },
      update: {},
    });
  }
}

export type AffectedOrg = { orgId: string; studentIds: Set<string>; counselorIds: Set<string> };

/** Platform query: which schools have students with this program in play (counts only leave this module). */
export async function affectedOrgs(platform: PrismaClient, programId: string): Promise<AffectedOrg[]> {
  const [short, plans, apps] = await Promise.all([
    platform.shortlistEntry.findMany({ where: { programId }, select: { orgId: true, studentId: true } }),
    platform.studentCoursePlan.findMany({ where: { targetProgramIds: { has: programId }, status: { not: "ARCHIVED" } }, select: { orgId: true, studentId: true, approvedById: true, proposedById: true } }),
    platform.application.findMany({ where: { programId }, select: { orgId: true, studentId: true, counselorId: true } }),
  ]);
  const by = new Map<string, AffectedOrg>();
  const get = (orgId: string) => {
    let a = by.get(orgId);
    if (!a) by.set(orgId, (a = { orgId, studentIds: new Set(), counselorIds: new Set() }));
    return a;
  };
  for (const s of short) get(s.orgId).studentIds.add(s.studentId);
  for (const p of plans) {
    const a = get(p.orgId);
    a.studentIds.add(p.studentId);
    if (p.approvedById) a.counselorIds.add(p.approvedById);
    if (p.proposedById) a.counselorIds.add(p.proposedById);
  }
  for (const x of apps) {
    const a = get(x.orgId);
    a.studentIds.add(x.studentId);
    if (x.counselorId) a.counselorIds.add(x.counselorId);
  }
  return [...by.values()];
}

/** Notify advising staff in one school. Idempotent per (change, recipient). Returns how many were notified. */
export async function notifyOrgStaff(orgId: string, change: { id: string; programId: string; summaryEn: string; summaryAr: string }, affected: AffectedOrg, now = new Date()) {
  return tenantTx(orgId, async (tx) => {
    const program = await tx.universityProgram.findUnique({ where: { id: change.programId }, select: { nameEn: true, nameAr: true, universityId: true } });
    if (!program) return 0;
    const uni = await tx.university.findUnique({ where: { id: program.universityId }, select: { nameEn: true, nameAr: true } });
    // Advising staff only: named counselors plus members whose roles plan or manage pathways.
    const staff = await tx.membership.findMany({
      where: {
        status: "ACTIVE",
        roles: { some: { role: { permissions: { hasSome: STAFF_PERMS } } } },
      },
      select: { id: true },
    });
    const staffIds = new Set(staff.map((s) => s.id));
    const recipients = [...new Set([...affected.counselorIds].filter((id) => staffIds.has(id)).concat([...staffIds]))];
    if (!recipients.length) return 0;
    const keyOf = (m: string) => `catalog.change:${change.id}:${m}`;
    const claimed: string[] = [];
    for (const m of recipients) {
      const res = await tx.jobRun.createMany({ data: [{ orgId, queue: "catalog", name: "change.notify", idempotencyKey: keyOf(m), status: "COMPLETED", finishedAt: now }], skipDuplicates: true });
      if (res.count === 1) claimed.push(m);
    }
    if (!claimed.length) return 0;
    await ensureTemplate(tx, orgId);
    const ec = execCtx(tx, orgId, { now, quiet: true });
    await notify(ec, {
      recipients: claimed,
      templateKey: CHANGE_TEMPLATE,
      kind: CHANGE_TEMPLATE,
      vars: {
        program: { en: program.nameEn, ar: program.nameAr },
        university: { en: uni?.nameEn ?? "", ar: uni?.nameAr ?? uni?.nameEn ?? "" },
        summaryEn: change.summaryEn,
        summaryAr: change.summaryAr,
        count: String(affected.studentIds.size),
      },
      href: `/career/catalog/changes?change=${change.id}`,
      channels: ["IN_APP"],
      idempotencyBase: `catalog.change:${change.id}`,
    });
    return claimed.length;
  });
}

export type ReviewResult = ({ ok: true; notified: number }) | { ok: false; error: "forbidden" | "not_platform_reviewer" | "no_owner_url" | "not_found" | "already_reviewed" };

export async function reviewChange(deps: ChangeDeps, input: { changeId: string; outcome: "REVIEWED" | "DISMISSED"; note?: string | null }): Promise<ReviewResult> {
  try {
    assertCatalogWrite(deps.actor, { writable: deps.writable });
  } catch (e) {
    if (e instanceof CatalogAccessError) return { ok: false, error: e.code };
    throw e;
  }
  const now = deps.now ?? new Date();
  const change = await deps.catalog.requirementChange.findUnique({ where: { id: input.changeId } });
  if (!change || (change.orgId !== null && change.orgId !== deps.actor.orgId)) return { ok: false, error: "not_found" };
  if (change.status !== "NEEDS_REVIEW") return { ok: false, error: "already_reviewed" };
  const diff = (change.diff ?? {}) as unknown as ChangeDiff;
  const review = { outcome: input.outcome, note: input.note?.trim().slice(0, 1000) || null, at: now.toISOString(), byUserId: deps.actor.userId };
  // Conditional update: two reviewers at once cannot both notify.
  const claimed = await deps.catalog.requirementChange.updateMany({ where: { id: change.id, status: "NEEDS_REVIEW" }, data: { status: "ACKNOWLEDGED", reviewedById: deps.actor.userId, diff: { ...diff, review } as unknown as Prisma.InputJsonValue } });
  if (claimed.count !== 1) return { ok: false, error: "already_reviewed" };

  let notified = 0;
  if (input.outcome === "REVIEWED") {
    const orgs = await affectedOrgs(deps.catalog, change.programId);
    for (const a of orgs) {
      // A school-owned program only concerns that school.
      if (change.orgId !== null && a.orgId !== change.orgId) continue;
      notified += await notifyOrgStaff(a.orgId, { id: change.id, programId: change.programId, summaryEn: change.summaryEn, summaryAr: diff.summaryAr ?? change.summaryEn }, a, now);
    }
    await deps.catalog.requirementChange.update({ where: { id: change.id }, data: { diff: { ...diff, review: { ...review, notified } } as unknown as Prisma.InputJsonValue } });
  }
  await audit(deps.tenant, deps.actor.orgId, {
    actorId: deps.actor.membershipId,
    actorUserId: deps.actor.userId,
    action: input.outcome === "REVIEWED" ? "catalog.change.review" : "catalog.change.dismiss",
    entityType: "RequirementChange",
    entityId: change.id,
    reason: review.note,
    meta: { programId: change.programId, severity: diff.severity ?? null, notified },
  });
  return { ok: true, notified };
}
