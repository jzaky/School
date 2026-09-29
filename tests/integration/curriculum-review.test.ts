// Lesson plan submission and review against real Postgres through the RLS-restricted app role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import { execCtx, type Effect } from "@/server/db";
import { PlanError, reviewPlan, submitPlan } from "@/server/curriculum/review";
import { ownerClient, uid } from "./helpers";
import { wipeTenant } from "../../prisma/seed/lib";

let owner: PrismaClient;
let orgId: string;
let teacher: string;
let hod: string;
let otherHead: string;
let planId: string;
const effects: Effect[] = [];

async function member(name: string) {
  const user = await owner.user.create({ data: { email: `${uid(name)}@curriculum.test`, nameEn: name, nameAr: `${name} ع` } });
  const m = await owner.membership.create({ data: { orgId, userId: user.id } });
  return m.id;
}

const run = <T>(fn: (ec: ReturnType<typeof execCtx>) => Promise<T>, now = new Date()) =>
  tenantTx(orgId, (tx) => fn(execCtx(tx, orgId, { effects, now })));

const notifications = (recipientId: string, kind: string) => owner.notification.count({ where: { orgId, recipientId, kind } });

beforeAll(async () => {
  owner = ownerClient();
  const org = await owner.organization.create({ data: { slug: uid("curriculum-itest"), nameEn: "Curriculum Test School", nameAr: "مدرسة اختبار المنهج" } });
  orgId = org.id;
  teacher = await member("Teacher");
  hod = await member("Head");
  otherHead = await member("OtherHead");
  const dept = await owner.department.create({ data: { orgId, key: "computing", nameEn: "Computing", nameAr: "الحوسبة", headMembershipId: hod } });
  const subject = await owner.subject.create({ data: { orgId, code: "CS", nameEn: "Computer Science", nameAr: "علوم الحاسوب", departmentId: dept.id } });
  const fw = await owner.curriculumFramework.create({ data: { orgId, key: "cs-g9", nameEn: "Grade 9 Computing", nameAr: "الحوسبة", subjectId: subject.id, gradeLevel: 9 } });
  const s = await owner.curriculumStandard.create({ data: { orgId, frameworkId: fw.id, code: "CS9.1", strandEn: "Algorithms", strandAr: "الخوارزميات", descEn: "Decompose problems", descAr: "تجزئة المشكلات" } });
  const plan = await owner.lessonPlan.create({ data: { orgId, subjectId: subject.id, gradeLevel: 9, titleEn: "Decomposition", titleAr: "التجزئة", authorId: teacher } });
  planId = plan.id;
  await owner.lessonPlanStandard.create({ data: { orgId, lessonPlanId: plan.id, standardId: s.id } });
});

afterAll(async () => {
  if (orgId) {
    const users = (await owner.membership.findMany({ where: { orgId } })).map((m) => m.userId);
    await wipeTenant(owner, orgId);
    await owner.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await owner.user.deleteMany({ where: { id: { in: users } } });
  }
  await owner?.$disconnect();
});

describe("lesson plan review", () => {
  it("only the author can submit, and a plan needs standards", async () => {
    await expect(run((ec) => submitPlan(ec, { planId, actorId: hod }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const empty = await owner.lessonPlan.create({ data: { orgId, subjectId: (await owner.lessonPlan.findUniqueOrThrow({ where: { id: planId } })).subjectId, gradeLevel: 9, titleEn: "Empty", titleAr: "فارغة", authorId: teacher } });
    await expect(run((ec) => submitPlan(ec, { planId: empty.id, actorId: teacher }))).rejects.toBeInstanceOf(PlanError);
  });

  it("submitting notifies the head of department once, even when repeated", async () => {
    const first = await run((ec) => submitPlan(ec, { planId, actorId: teacher }));
    expect(first.changed).toBe(true);
    const again = await run((ec) => submitPlan(ec, { planId, actorId: teacher }));
    expect(again.changed).toBe(false);
    expect((await owner.lessonPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe("SUBMITTED");
    expect(await notifications(hod, "lesson_plan_submitted")).toBe(1);
    const n = await owner.notification.findFirstOrThrow({ where: { orgId, recipientId: hod, kind: "lesson_plan_submitted" } });
    expect(n.titleEn).toBe("Lesson plan to review: Decomposition");
    expect(n.titleAr).toContain("التجزئة");
    expect(await owner.auditEvent.count({ where: { orgId, entityId: planId, action: "lesson_plan.submit" } })).toBe(1);
  });

  it("reviewers outside the department, and authors, cannot review", async () => {
    await expect(run((ec) => reviewPlan(ec, { planId, reviewerId: otherHead, decision: "APPROVED", allowed: () => false }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run((ec) => reviewPlan(ec, { planId, reviewerId: teacher, decision: "APPROVED", allowed: () => true }))).rejects.toMatchObject({ code: "OWN_PLAN" });
  });

  it("asking for changes needs a comment and notifies the teacher once", async () => {
    await expect(run((ec) => reviewPlan(ec, { planId, reviewerId: hod, decision: "CHANGES_REQUESTED", comment: " ", allowed: () => true }))).rejects.toMatchObject({ code: "COMMENT_REQUIRED" });
    const r = await run((ec) => reviewPlan(ec, { planId, reviewerId: hod, decision: "CHANGES_REQUESTED", comment: "Add an unplugged starter.", allowed: () => true }));
    expect(r.changed).toBe(true);
    const repeat = await run((ec) => reviewPlan(ec, { planId, reviewerId: hod, decision: "CHANGES_REQUESTED", comment: "Add an unplugged starter.", allowed: () => true }));
    expect(repeat.changed).toBe(false);
    const plan = await owner.lessonPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(plan).toMatchObject({ status: "CHANGES_REQUESTED", reviewerId: hod, reviewComment: "Add an unplugged starter." });
    expect(await notifications(teacher, "lesson_plan_changes")).toBe(1);
    const n = await owner.notification.findFirstOrThrow({ where: { orgId, recipientId: teacher, kind: "lesson_plan_changes" } });
    expect(n.bodyEn).toContain("Add an unplugged starter.");
  });

  it("resubmitting and approving notifies both people again, and history is kept in audit events", async () => {
    await run((ec) => submitPlan(ec, { planId, actorId: teacher }));
    expect(await notifications(hod, "lesson_plan_submitted")).toBe(2);
    await run((ec) => reviewPlan(ec, { planId, reviewerId: hod, decision: "APPROVED", comment: "Great.", allowed: () => true }));
    expect(await notifications(teacher, "lesson_plan_approved")).toBe(1);
    await expect(run((ec) => reviewPlan(ec, { planId, reviewerId: hod, decision: "CHANGES_REQUESTED", comment: "late", allowed: () => true }))).rejects.toMatchObject({ code: "STATUS" });
    const actions = (await owner.auditEvent.findMany({ where: { orgId, entityId: planId }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["lesson_plan.submit", "lesson_plan.request_changes", "lesson_plan.submit", "lesson_plan.approve"]);
    // Email side effects carry unique idempotency keys.
    const outbound = await owner.outboundMessage.findMany({ where: { orgId } });
    expect(outbound.length).toBe(4);
    expect(new Set(outbound.map((o) => o.idempotencyKey)).size).toBe(4);
    expect(effects.length).toBe(4);
  });
});
