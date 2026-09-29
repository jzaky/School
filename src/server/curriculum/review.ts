// Lesson plan submission and review. Runs inside a tenant transaction (ExecCtx) so it can be tested directly.
// Each status change is a guarded update: repeating the same call changes nothing and notifies nobody twice.
import type { ExecCtx, Tx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { notify } from "@/server/notify/notify";

export const PLAN_TEMPLATES = [
  {
    key: "lesson_plan_submitted",
    subject: { en: "Lesson plan to review: {{title}}", ar: "خطة درس بانتظار المراجعة: {{title}}" },
    body: { en: "{{teacher}} submitted \"{{title}}\" for your review.", ar: "أرسل {{teacher}} خطة الدرس \"{{title}}\" لمراجعتك." },
  },
  {
    key: "lesson_plan_approved",
    subject: { en: "Lesson plan approved: {{title}}", ar: "تم اعتماد خطة الدرس: {{title}}" },
    body: { en: "{{reviewer}} approved \"{{title}}\". {{comment}}", ar: "اعتمد {{reviewer}} خطة الدرس \"{{title}}\". {{comment}}" },
  },
  {
    key: "lesson_plan_changes",
    subject: { en: "Changes requested: {{title}}", ar: "مطلوب تعديلات: {{title}}" },
    body: { en: "{{reviewer}} asked for changes to \"{{title}}\": {{comment}}", ar: "طلب {{reviewer}} تعديلات على خطة الدرس \"{{title}}\": {{comment}}" },
  },
] as const;

/** Make sure the notification templates this module uses exist for the organization. */
export async function ensurePlanTemplates(tx: Tx, orgId: string) {
  const have = await tx.messageTemplate.findMany({ where: { orgId, key: { in: PLAN_TEMPLATES.map((t) => t.key) }, channel: "EMAIL" }, select: { key: true } });
  const missing = PLAN_TEMPLATES.filter((t) => !have.some((h) => h.key === t.key));
  if (!missing.length) return;
  await tx.messageTemplate.createMany({
    data: missing.map((t) => ({ orgId, key: t.key, channel: "EMAIL" as const, subjectEn: t.subject.en, subjectAr: t.subject.ar, bodyEn: t.body.en, bodyAr: t.body.ar })),
    skipDuplicates: true,
  });
}

export class PlanError extends Error {
  constructor(public code: "NOT_FOUND" | "FORBIDDEN" | "STATUS" | "NO_STANDARDS" | "COMMENT_REQUIRED" | "OWN_PLAN") {
    super(code);
  }
}

/** Who reviews plans for a subject: the head of its department. */
export async function reviewersFor(tx: Tx, subjectId: string): Promise<string[]> {
  const subject = await tx.subject.findUnique({ where: { id: subjectId }, include: { department: true } });
  return subject?.department?.headMembershipId ? [subject.department.headMembershipId] : [];
}

async function names(tx: Tx, membershipId: string) {
  const m = await tx.membership.findUnique({ where: { id: membershipId }, include: { user: true } });
  return { en: m?.user.nameEn ?? "", ar: m?.user.nameAr || m?.user.nameEn || "" };
}

export async function submitPlan(ec: ExecCtx, input: { planId: string; actorId: string; actorUserId?: string | null }) {
  const { tx, orgId } = ec;
  const plan = await tx.lessonPlan.findUnique({ where: { id: input.planId }, include: { _count: { select: { standards: true } } } });
  if (!plan) throw new PlanError("NOT_FOUND");
  if (plan.authorId !== input.actorId) throw new PlanError("FORBIDDEN");
  if (plan.status === "SUBMITTED") return { changed: false as const, plan };
  if (plan.status !== "DRAFT" && plan.status !== "CHANGES_REQUESTED") throw new PlanError("STATUS");
  if (plan._count.standards === 0) throw new PlanError("NO_STANDARDS");
  const res = await tx.lessonPlan.updateMany({ where: { id: plan.id, status: plan.status }, data: { status: "SUBMITTED", reviewedAt: null } });
  if (res.count === 0) return { changed: false as const, plan };
  await audit(tx, orgId, { actorId: input.actorId, actorUserId: input.actorUserId, action: "lesson_plan.submit", entityType: "LessonPlan", entityId: plan.id, meta: { from: plan.status } });
  await ensurePlanTemplates(tx, orgId);
  const reviewers = (await reviewersFor(tx, plan.subjectId)).filter((r) => r !== input.actorId);
  const submissions = await tx.auditEvent.count({ where: { orgId, entityType: "LessonPlan", entityId: plan.id, action: "lesson_plan.submit" } });
  await notify(ec, {
    recipients: reviewers,
    templateKey: "lesson_plan_submitted",
    vars: { title: { en: plan.titleEn, ar: plan.titleAr }, teacher: await names(tx, input.actorId) },
    href: `/curriculum/plans/${plan.id}`,
    idempotencyBase: `lesson-plan:${plan.id}:submitted:${submissions}`,
  });
  return { changed: true as const, plan };
}

export async function reviewPlan(
  ec: ExecCtx,
  input: { planId: string; reviewerId: string; reviewerUserId?: string | null; decision: "APPROVED" | "CHANGES_REQUESTED"; comment?: string | null; allowed: (subjectId: string) => boolean },
) {
  const { tx, orgId } = ec;
  const plan = await tx.lessonPlan.findUnique({ where: { id: input.planId } });
  if (!plan) throw new PlanError("NOT_FOUND");
  if (!input.allowed(plan.subjectId)) throw new PlanError("FORBIDDEN");
  if (plan.authorId === input.reviewerId) throw new PlanError("OWN_PLAN");
  const comment = input.comment?.trim() || null;
  if (input.decision === "CHANGES_REQUESTED" && !comment) throw new PlanError("COMMENT_REQUIRED");
  if (plan.status !== "SUBMITTED") {
    if (plan.status === input.decision) return { changed: false as const, plan };
    throw new PlanError("STATUS");
  }
  const reviewedAt = ec.now;
  const res = await tx.lessonPlan.updateMany({
    where: { id: plan.id, status: "SUBMITTED" },
    data: { status: input.decision, reviewerId: input.reviewerId, reviewComment: comment, reviewedAt },
  });
  if (res.count === 0) return { changed: false as const, plan };
  await audit(tx, orgId, {
    actorId: input.reviewerId,
    actorUserId: input.reviewerUserId,
    action: input.decision === "APPROVED" ? "lesson_plan.approve" : "lesson_plan.request_changes",
    entityType: "LessonPlan",
    entityId: plan.id,
    reason: comment,
  });
  await ensurePlanTemplates(tx, orgId);
  await notify(ec, {
    recipients: [plan.authorId],
    templateKey: input.decision === "APPROVED" ? "lesson_plan_approved" : "lesson_plan_changes",
    vars: { title: { en: plan.titleEn, ar: plan.titleAr }, reviewer: await names(tx, input.reviewerId), comment: comment ?? "" },
    href: `/curriculum/plans/${plan.id}`,
    idempotencyBase: `lesson-plan:${plan.id}:${input.decision}:${reviewedAt.getTime()}`,
  });
  return { changed: true as const, plan: { ...plan, status: input.decision, reviewComment: comment, reviewedAt } };
}
